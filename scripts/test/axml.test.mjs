/**
 * Tests for the binary-XML and ZIP readers behind `E06-32`, and for the UPI assertion built
 * on top of them.
 *
 * **These build their own binary fixtures rather than checking an APK into the repository.**
 * An APK is forty to a hundred and forty megabytes, it is a build output rather than source,
 * and a fixture that large gets replaced by whatever was lying around the next time it needs
 * updating. Encoding the handful of AXML chunks the parser understands is about eighty lines
 * and has a second benefit: writing the encoder is what forces the layout to be stated
 * explicitly, which is how the `attributeStart` base offset — the one bug this parser had —
 * gets caught rather than assumed.
 *
 * The parser is separately known to work against a real artefact: it decodes the `E19-01`
 * spike APK's manifest, including `com.razorpay:standard-core`'s `<queries>` block. That
 * check cannot live in CI, because it needs a 140 MB download.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'

import { readEntry, listEntries } from '../lib/zip.mjs'
import { parseAxml, findElements, androidAttr, ANDROID_NS } from '../lib/axml.mjs'
import { inspectManifest, REQUIRED_PSP_PACKAGES } from '../verify-apk-upi-queries.mjs'

// ---------------------------------------------------------------------------
// A minimal AXML encoder, for fixtures only.
// ---------------------------------------------------------------------------

const CHUNK_XML = 0x0003
const CHUNK_STRING_POOL = 0x0001
const CHUNK_START_ELEMENT = 0x0102
const CHUNK_END_ELEMENT = 0x0103
const UTF8_FLAG = 1 << 8
const TYPE_STRING = 0x03
const NO_ENTRY = 0xffffffff

/** Encode the UTF-8 string pool: per entry, charLen, byteLen, bytes, NUL. */
function encodeStringPool(strings) {
  const entries = strings.map((s) => {
    const bytes = Buffer.from(s, 'utf8')
    assert.ok(bytes.length < 0x80, `fixture string too long to encode simply: ${s}`)
    return Buffer.concat([Buffer.from([bytes.length, bytes.length]), bytes, Buffer.from([0])])
  })

  const offsets = Buffer.alloc(strings.length * 4)
  let running = 0
  entries.forEach((e, i) => {
    offsets.writeUInt32LE(running, i * 4)
    running += e.length
  })

  const data = Buffer.concat(entries)
  const headerSize = 28
  const stringsStart = headerSize + offsets.length
  const size = stringsStart + data.length

  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(CHUNK_STRING_POOL, 0)
  header.writeUInt16LE(headerSize, 2)
  header.writeUInt32LE(size, 4)
  header.writeUInt32LE(strings.length, 8)
  header.writeUInt32LE(0, 12) // styleCount
  header.writeUInt32LE(UTF8_FLAG, 16)
  header.writeUInt32LE(stringsStart, 20)
  header.writeUInt32LE(0, 24) // stylesStart

  return Buffer.concat([header, offsets, data])
}

/**
 * Encode a tree of `{ name, attrs: [[ns, name, value]], children }` as AXML.
 * `ns` of `null` means no namespace; anything else is used as the URI verbatim.
 */
function buildAxml(root) {
  const pool = []
  const intern = (s) => {
    if (s === null || s === undefined) return NO_ENTRY
    const at = pool.indexOf(s)
    return at === -1 ? pool.push(s) - 1 : at
  }

  // Intern in document order so the pool is populated before any chunk references it.
  const walkStrings = (node) => {
    intern(node.name)
    for (const [ns, name, value] of node.attrs ?? []) {
      if (ns !== null) intern(ns)
      intern(name)
      intern(String(value))
    }
    for (const child of node.children ?? []) walkStrings(child)
  }
  walkStrings(root)

  const chunks = []
  const emit = (node) => {
    const attrs = node.attrs ?? []
    const attrSize = 20
    const size = 36 + attrs.length * attrSize
    const buf = Buffer.alloc(size)
    buf.writeUInt16LE(CHUNK_START_ELEMENT, 0)
    buf.writeUInt16LE(16, 2) // headerSize — attrExt starts here
    buf.writeUInt32LE(size, 4)
    buf.writeUInt32LE(0, 8) // lineNumber
    buf.writeUInt32LE(NO_ENTRY, 12) // comment
    buf.writeUInt32LE(NO_ENTRY, 16) // element ns
    buf.writeUInt32LE(intern(node.name), 20)
    buf.writeUInt16LE(20, 24) // attributeStart, from the start of attrExt (byte 16)
    buf.writeUInt16LE(attrSize, 26)
    buf.writeUInt16LE(attrs.length, 28)
    buf.writeUInt16LE(0, 30) // idIndex
    buf.writeUInt16LE(0, 32) // classIndex
    buf.writeUInt16LE(0, 34) // styleIndex

    attrs.forEach(([ns, name, value], i) => {
      const a = 36 + i * attrSize
      buf.writeUInt32LE(ns === null ? NO_ENTRY : intern(ns), a)
      buf.writeUInt32LE(intern(name), a + 4)
      buf.writeUInt32LE(intern(String(value)), a + 8)
      buf.writeUInt16LE(8, a + 12) // Res_value.size
      buf.writeUInt8(0, a + 14) // res0
      buf.writeUInt8(TYPE_STRING, a + 15)
      buf.writeUInt32LE(intern(String(value)), a + 16)
    })
    chunks.push(buf)

    for (const child of node.children ?? []) emit(child)

    const end = Buffer.alloc(24)
    end.writeUInt16LE(CHUNK_END_ELEMENT, 0)
    end.writeUInt16LE(16, 2)
    end.writeUInt32LE(24, 4)
    end.writeUInt32LE(0, 8)
    end.writeUInt32LE(NO_ENTRY, 12)
    end.writeUInt32LE(NO_ENTRY, 16)
    end.writeUInt32LE(intern(node.name), 20)
    chunks.push(end)
  }
  emit(root)

  const stringPool = encodeStringPool(pool)
  const body = Buffer.concat([stringPool, ...chunks])
  const header = Buffer.alloc(8)
  header.writeUInt16LE(CHUNK_XML, 0)
  header.writeUInt16LE(8, 2)
  header.writeUInt32LE(8 + body.length, 4)
  return Buffer.concat([header, body])
}

/** A manifest shaped like a real merged one, parameterised by what it declares. */
function manifestFixture({ upiScheme = true, packages = REQUIRED_PSP_PACKAGES } = {}) {
  const intents = [
    {
      name: 'intent',
      children: [
        { name: 'action', attrs: [[ANDROID_NS, 'name', 'android.intent.action.VIEW']] },
        { name: 'data', attrs: [[ANDROID_NS, 'scheme', 'https']] },
      ],
    },
  ]
  if (upiScheme) {
    intents.push({
      name: 'intent',
      children: [
        { name: 'action', attrs: [[ANDROID_NS, 'name', 'android.intent.action.VIEW']] },
        {
          name: 'data',
          attrs: [
            [ANDROID_NS, 'scheme', 'upi'],
            [ANDROID_NS, 'host', 'pay'],
          ],
        },
      ],
    })
  }

  return buildAxml({
    name: 'manifest',
    attrs: [
      [ANDROID_NS, 'versionCode', '1'],
      [null, 'package', 'com.Gracord.Graybag'],
    ],
    children: [
      {
        name: 'queries',
        children: [
          ...intents,
          ...packages.map((p) => ({ name: 'package', attrs: [[ANDROID_NS, 'name', p]] })),
        ],
      },
      { name: 'application', children: [] },
    ],
  })
}

// ---------------------------------------------------------------------------
// The AXML parser
// ---------------------------------------------------------------------------

test('parses element structure, names and namespaced attributes', () => {
  const manifest = parseAxml(manifestFixture())

  assert.equal(manifest.name, 'manifest')
  assert.equal(androidAttr(manifest, 'versionCode'), '1')
  // `package` carries no namespace, so the android-namespaced lookup must not find it.
  assert.equal(androidAttr(manifest, 'package'), null)
  assert.equal(
    manifest.attributes.find((a) => a.name === 'package' && a.ns === null).value,
    'com.Gracord.Graybag',
  )
  assert.equal(findElements(manifest, 'queries').length, 1)
  assert.equal(findElements(manifest, 'application').length, 1)
})

test('finds descendants at any depth, in document order', () => {
  const manifest = parseAxml(manifestFixture())
  const schemes = findElements(manifest, 'data').map((d) => androidAttr(d, 'scheme'))
  assert.deepEqual(schemes, ['https', 'upi'])
})

test('rejects a plain-text manifest instead of guessing', () => {
  const text = Buffer.from('<?xml version="1.0"?><manifest package="x"/>', 'utf8')
  assert.throws(() => parseAxml(text), /Not binary AndroidManifest\.xml/)
})

test('attribute offsets are read from attrExt, not from the chunk header', () => {
  // Regression test for a real bug: using the chunk start as the base shifts every
  // attribute by 16 bytes, which still parses and yields plausible nonsense — namespaces
  // that look like element names, values that look like labels — rather than throwing.
  // The only defence is asserting a known attribute decodes to its known value.
  const manifest = parseAxml(manifestFixture())
  const upi = findElements(manifest, 'data').find((d) => androidAttr(d, 'scheme') === 'upi')
  assert.ok(upi, 'the upi data element must be found by its android:scheme attribute')
  assert.equal(androidAttr(upi, 'host'), 'pay')
})

// ---------------------------------------------------------------------------
// The UPI assertion
// ---------------------------------------------------------------------------

test('passes a manifest declaring the scheme and every PSP package', () => {
  const result = inspectManifest(parseAxml(manifestFixture()))
  assert.equal(result.hasQueriesElement, true)
  assert.equal(result.hasUpiScheme, true)
  assert.deepEqual(result.missingPackages, [])
})

test('fails when the upi scheme is absent — checkout would degrade silently', () => {
  const result = inspectManifest(parseAxml(manifestFixture({ upiScheme: false })))
  assert.equal(result.hasQueriesElement, true)
  assert.equal(result.hasUpiScheme, false)
})

test('fails when our plugin did not apply, even though upstream still supplies the scheme', () => {
  // This is the spike APK's exact shape: com.razorpay:standard-core contributes the upi
  // scheme, and nothing contributes the explicit package list. It is the case the assertion
  // exists to catch, because upstream masking it is a floating dependency (E19-08).
  const result = inspectManifest(parseAxml(manifestFixture({ packages: [] })))
  assert.equal(result.hasUpiScheme, true)
  assert.deepEqual(result.missingPackages, REQUIRED_PSP_PACKAGES)
})

test('reports exactly which packages are missing, not just that some are', () => {
  const partial = REQUIRED_PSP_PACKAGES.slice(0, 4)
  const result = inspectManifest(parseAxml(manifestFixture({ packages: partial })))
  assert.deepEqual(result.missingPackages, REQUIRED_PSP_PACKAGES.slice(4))
})

test('a manifest with no queries element at all fails on both counts', () => {
  const bare = buildAxml({
    name: 'manifest',
    attrs: [[null, 'package', 'com.Gracord.Graybag']],
    children: [{ name: 'application', children: [] }],
  })
  const result = inspectManifest(parseAxml(bare))
  assert.equal(result.hasQueriesElement, false)
  assert.equal(result.hasUpiScheme, false)
  assert.deepEqual(result.missingPackages, REQUIRED_PSP_PACKAGES)
})

// ---------------------------------------------------------------------------
// The ZIP reader
// ---------------------------------------------------------------------------

/** Build a single-entry ZIP, stored or deflated. */
function buildZip(name, contents, { deflate = false } = {}) {
  const nameBuf = Buffer.from(name, 'utf8')
  const data = deflate ? deflateRawSync(contents) : contents
  const method = deflate ? 8 : 0

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(method, 8)
  local.writeUInt32LE(0, 14) // crc32 — not checked by the reader
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(contents.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  local.writeUInt16LE(0, 28)

  const localRecord = Buffer.concat([local, nameBuf, data])

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(method, 10)
  central.writeUInt32LE(0, 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(contents.length, 24)
  central.writeUInt16LE(nameBuf.length, 28)
  central.writeUInt32LE(0, 42) // local header offset
  const centralRecord = Buffer.concat([central, nameBuf])

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(centralRecord.length, 12)
  eocd.writeUInt32LE(localRecord.length, 16)

  return Buffer.concat([localRecord, centralRecord, eocd])
}

test('reads a stored entry', () => {
  const payload = Buffer.from('hello', 'utf8')
  const zip = buildZip('AndroidManifest.xml', payload)
  assert.deepEqual(readEntry(zip, 'AndroidManifest.xml'), payload)
})

test('reads a deflated entry', () => {
  const payload = manifestFixture()
  const zip = buildZip('AndroidManifest.xml', payload, { deflate: true })
  assert.deepEqual(readEntry(zip, 'AndroidManifest.xml'), payload)
})

test('returns null for an entry the archive does not contain', () => {
  const zip = buildZip('classes.dex', Buffer.from('x'))
  assert.equal(readEntry(zip, 'AndroidManifest.xml'), null)
})

test('lists entries from the central directory', () => {
  const zip = buildZip('AndroidManifest.xml', Buffer.from('x'))
  assert.deepEqual(
    listEntries(zip).map((e) => e.name),
    ['AndroidManifest.xml'],
  )
})

test('rejects a file that is not a ZIP', () => {
  assert.throws(() => readEntry(Buffer.alloc(200), 'AndroidManifest.xml'), /Not a ZIP archive/)
})
