import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseCsv, toHttps, localName } from '../mirror.mjs'

test('parseCsv handles the quoting Bubble actually emits', () => {
  // A dish name with an embedded comma is real in the legacy data
  // ("Tomato, Cucumber Cheese Sandwich in Brown Bread"), so this is not hypothetical.
  const csv = '"name","photo"\n"Tomato, Cucumber Sandwich","//cdn/f1/a.png"\n"Plain","//cdn/f2/b.jpg"\n'
  const rows = parseCsv(csv)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].name, 'Tomato, Cucumber Sandwich')
  assert.equal(rows[0].photo, '//cdn/f1/a.png')
  assert.equal(rows[1].name, 'Plain')
})

test('parseCsv strips the BOM and ignores trailing blank lines', () => {
  const rows = parseCsv('\uFEFF"name"\n"Tea"\n\n')
  assert.deepEqual(rows, [{ name: 'Tea' }])
})

test('parseCsv keeps escaped quotes', () => {
  assert.equal(parseCsv('"a"\n"say ""hi"""\n')[0].a, 'say "hi"')
})

test('toHttps upgrades the protocol-relative URLs Bubble exports', () => {
  assert.equal(toHttps('//host.cdn.bubble.io/f1/x.png'), 'https://host.cdn.bubble.io/f1/x.png')
  assert.equal(toHttps('http://host/x.png'), 'https://host/x.png')
  assert.equal(toHttps('https://host/x.png'), 'https://host/x.png')
})

test('toHttps returns null rather than guessing at empty or junk values', () => {
  assert.equal(toHttps(''), null)
  assert.equal(toHttps('   '), null)
  assert.equal(toHttps(undefined), null)
  assert.equal(toHttps('not-a-url'), null)
})

test('localName prefixes the Bubble file id so same-named dishes cannot collide', () => {
  const a = localName('//h.cdn.bubble.io/f1754874106249x821/Blueberry%20Muffin.png')
  const b = localName('//h.cdn.bubble.io/f1779450090917x738/Blueberry%20Muffin.png')
  assert.notEqual(a, b)
  assert.equal(a, 'f1754874106249x821__Blueberry-Muffin.png')
})

test('localName decodes %20 and sanitises to a filesystem-safe name', () => {
  const n = localName('//h/f1/Wheat%20jaggery%20cake%20copy.png')
  assert.equal(n, 'f1__Wheat-jaggery-cake-copy.png')
  assert.match(n, /^[A-Za-z0-9._-]+$/)
})

test('the committed manifest matches what the mirror run actually produced', async () => {
  const m = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'))
  assert.equal(m.counts.total, m.images.length)
  assert.equal(m.counts.ok, m.images.filter((i) => i.status === 'ok').length)
  assert.equal(m.counts.failed, m.images.filter((i) => i.status === 'failed').length)
  // Every successful entry must carry the checksum --verify depends on.
  for (const i of m.images.filter((x) => x.status === 'ok')) {
    assert.match(i.sha256, /^[0-9a-f]{64}$/, `${i.file} has no usable checksum`)
    assert.ok(i.bytes > 0, `${i.file} recorded as zero bytes`)
  }
  // Local filenames must be unique, or the mirror silently overwrites.
  const files = m.images.filter((i) => i.file).map((i) => i.file)
  assert.equal(new Set(files).size, files.length, 'duplicate local filenames')
})

test('the manifest records no personal data — dish catalogue fields only', async () => {
  const m = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'))
  const allowed = new Set(['dish', 'id', 'url', 'file', 'bytes', 'contentType', 'sha256', 'status', 'error'])
  for (const i of m.images) {
    for (const k of Object.keys(i)) {
      assert.ok(allowed.has(k), `manifest leaked an unexpected field: ${k}`)
    }
  }
})
