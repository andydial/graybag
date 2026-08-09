/**
 * A reader for Android's binary XML (AXML) — the form `AndroidManifest.xml` takes once it is
 * inside an APK.
 *
 * ## Why this exists rather than a dependency or `aapt2`
 *
 * `E06-32` has to assert something about the manifest **of the artefact we are about to
 * ship**, because the thing it is guarding against is precisely the case where the source
 * config and the built output disagree: a config plugin that silently stopped applying, or a
 * transitive AAR that changed its own manifest under a floating version (`E19-08`). Reading
 * `app.json` proves nothing about any of that.
 *
 * `aapt2` would do the job, but it lives in the Android SDK build-tools, which the CI runner
 * and Andy's laptop do not have — only `adb`, from the platform-tools cask. Requiring a
 * multi-gigabyte SDK install to run one assertion would mean the assertion does not get run.
 * An npm APK parser would mean a dependency in the payment build-integrity path, which is
 * the one place where "some unmaintained package decodes this for us" is the least
 * attractive answer available.
 *
 * So: the format itself. It is a chunked, length-prefixed structure that has not changed
 * since 2009, and the subset needed to walk elements and attributes is small.
 *
 * ## What it does not do
 *
 * No styles, no CDATA, no namespace-prefix resolution beyond recording the URI, and typed
 * attribute values are returned in their raw form for everything except strings, booleans
 * and integers. Enough to answer "is there a `<queries>` element containing an `<intent>`
 * whose `<data>` has `android:scheme="upi"`", which is the entire brief.
 */

const CHUNK_STRING_POOL = 0x0001
const CHUNK_XML = 0x0003
const CHUNK_XML_START_ELEMENT = 0x0102
const CHUNK_XML_END_ELEMENT = 0x0103

const UTF8_FLAG = 1 << 8

const TYPE_REFERENCE = 0x01
const TYPE_STRING = 0x03
const TYPE_INT_DEC = 0x10
const TYPE_INT_HEX = 0x11
const TYPE_INT_BOOLEAN = 0x12

export const ANDROID_NS = 'http://schemas.android.com/apk/res/android'

/**
 * Read one length value from a string-pool entry. Both encodings use a high-bit
 * continuation scheme, but UTF-8 counts in bytes and UTF-16 in 16-bit units.
 */
function readLength(buf, offset, utf8) {
  if (utf8) {
    let value = buf.readUInt8(offset)
    if (value & 0x80) {
      value = ((value & 0x7f) << 8) | buf.readUInt8(offset + 1)
      return { value, size: 2 }
    }
    return { value, size: 1 }
  }
  let value = buf.readUInt16LE(offset)
  if (value & 0x8000) {
    value = ((value & 0x7fff) << 16) | buf.readUInt16LE(offset + 2)
    return { value, size: 4 }
  }
  return { value, size: 2 }
}

/** Decode the string pool chunk starting at `start`. Returns an array of strings. */
function parseStringPool(buf, start) {
  const stringCount = buf.readUInt32LE(start + 8)
  const flags = buf.readUInt32LE(start + 16)
  const stringsStart = buf.readUInt32LE(start + 20)
  const utf8 = (flags & UTF8_FLAG) !== 0

  const strings = []
  for (let i = 0; i < stringCount; i++) {
    const offset = start + stringsStart + buf.readUInt32LE(start + 28 + i * 4)
    if (utf8) {
      // UTF-8 entries carry the character count first, then the byte count. Only the
      // second is useful — the first disagrees with it for anything outside the BMP.
      const chars = readLength(buf, offset, true)
      const bytes = readLength(buf, offset + chars.size, true)
      const from = offset + chars.size + bytes.size
      strings.push(buf.subarray(from, from + bytes.value).toString('utf8'))
    } else {
      const len = readLength(buf, offset, false)
      const from = offset + len.size
      strings.push(buf.subarray(from, from + len.value * 2).toString('utf16le'))
    }
  }
  return strings
}

/** Resolve an index into the string pool, tolerating the -1 that means "absent". */
function str(strings, index) {
  if (index === 0xffffffff || index === -1) return null
  return strings[index] ?? null
}

/** Render a typed attribute value the way `aapt2 dump xmltree` would, near enough. */
function typedValue(strings, rawIndex, dataType, data) {
  const raw = str(strings, rawIndex)
  if (raw !== null) return raw
  switch (dataType) {
    case TYPE_STRING:
      return str(strings, data)
    case TYPE_INT_BOOLEAN:
      return data !== 0
    case TYPE_INT_DEC:
      return data
    case TYPE_INT_HEX:
      return `0x${data.toString(16)}`
    case TYPE_REFERENCE:
      return `@${data.toString(16)}`
    default:
      return data
  }
}

/**
 * Parse a binary `AndroidManifest.xml`.
 *
 * Returns the root element as `{ name, ns, attributes, children }`, where each attribute is
 * `{ ns, name, value }`. Throws if the buffer is not AXML — a plain-text manifest reaching
 * this function means something upstream handed over the wrong file, and guessing would turn
 * a build-integrity assertion into a coin toss.
 */
export function parseAxml(buf) {
  if (buf.length < 8 || buf.readUInt16LE(0) !== CHUNK_XML) {
    throw new Error(
      'Not binary AndroidManifest.xml (no 0x0003 chunk header). ' +
        'A source-tree manifest is plain text and is not what this asserts against.',
    )
  }

  let strings = []
  let cursor = buf.readUInt16LE(2) // headerSize

  const root = { name: '#document', ns: null, attributes: [], children: [] }
  const stack = [root]

  while (cursor < buf.length) {
    const chunkType = buf.readUInt16LE(cursor)
    const chunkSize = buf.readUInt32LE(cursor + 4)
    if (chunkSize <= 0) throw new Error(`Zero-length chunk at byte ${cursor}`)

    if (chunkType === CHUNK_STRING_POOL) {
      strings = parseStringPool(buf, cursor)
    } else if (chunkType === CHUNK_XML_START_ELEMENT) {
      const ns = str(strings, buf.readUInt32LE(cursor + 16))
      const name = str(strings, buf.readUInt32LE(cursor + 20))
      const attrStart = buf.readUInt16LE(cursor + 24)
      const attrSize = buf.readUInt16LE(cursor + 26)
      const attrCount = buf.readUInt16LE(cursor + 28)

      // `attributeStart` is an offset from the start of `ResXMLTree_attrExt`, which begins
      // after the 8-byte chunk header and the 8 bytes of lineNumber+comment — NOT from the
      // start of the chunk. Getting this wrong shifts every attribute by 16 bytes and still
      // parses, producing plausible-looking nonsense rather than an error.
      const attributes = []
      const attrBase = cursor + 16 + attrStart
      for (let i = 0; i < attrCount; i++) {
        const a = attrBase + i * attrSize
        attributes.push({
          ns: str(strings, buf.readUInt32LE(a)),
          name: str(strings, buf.readUInt32LE(a + 4)),
          value: typedValue(
            strings,
            buf.readUInt32LE(a + 8),
            buf.readUInt8(a + 15),
            buf.readUInt32LE(a + 16),
          ),
        })
      }

      const element = { name, ns, attributes, children: [] }
      stack[stack.length - 1].children.push(element)
      stack.push(element)
    } else if (chunkType === CHUNK_XML_END_ELEMENT) {
      if (stack.length > 1) stack.pop()
    }

    cursor += chunkSize
  }

  if (root.children.length !== 1) {
    throw new Error(`Expected exactly one root element, found ${root.children.length}`)
  }
  return root.children[0]
}

/** Every descendant element with the given tag name, in document order. */
export function findElements(node, name) {
  const found = []
  for (const child of node.children) {
    if (child.name === name) found.push(child)
    found.push(...findElements(child, name))
  }
  return found
}

/** The value of an `android:`-namespaced attribute, or `null`. */
export function androidAttr(element, name) {
  const attr = element.attributes.find((a) => a.name === name && a.ns === ANDROID_NS)
  return attr ? attr.value : null
}
