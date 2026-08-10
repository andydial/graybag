import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { matchDishes, readDimensions } from '../upload.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const img = (id, dish, file = `${id}.png`) => ({ id, dish, file, key: `dishes/${file}` })

// -----------------------------------------------------------------------------
// matchDishes
// -----------------------------------------------------------------------------

test('legacy_bubble_id wins over a name that would match something else', () => {
  const images = [img('bub-1', 'Cold Coffee'), img('bub-2', 'Tea')]
  const dishes = [{ id: 'd1', name: 'Tea', legacy_bubble_id: 'bub-1', image_asset_id: null }]

  const { matched } = matchDishes(dishes, images)
  assert.equal(matched.length, 1)
  assert.equal(matched[0].image.id, 'bub-1')
  assert.equal(matched[0].how, 'legacy_bubble_id')
})

test('name matching ignores case and collapsed whitespace, but is never fuzzy', () => {
  const images = [img('bub-1', 'Paneer  Wrap ')]
  const dishes = [
    { id: 'd1', name: 'paneer wrap', legacy_bubble_id: null, image_asset_id: null },
    { id: 'd2', name: 'Paneer Wraps', legacy_bubble_id: null, image_asset_id: null },
  ]

  const { matched, unmatched } = matchDishes(dishes, images)
  assert.deepEqual(matched.map((m) => m.dish.id), ['d1'])
  // "Paneer Wraps" is one character away and is deliberately NOT matched — a wrong photo
  // on a dish is worse than no photo, and this is where a fuzzy matcher would produce one.
  assert.deepEqual(unmatched.map((d) => d.id), ['d2'])
})

test('a duplicated legacy name is reported and resolved deterministically', () => {
  // Five names really are duplicated in the manifest, because the legacy app had two
  // dish records for the same dish. A re-run must pick the same one every time or it
  // would rewrite image_asset_id on every pass and bump the menu version each time.
  const images = [img('bub-9', 'Cold Coffee'), img('bub-2', 'Cold Coffee')]
  const dishes = [{ id: 'd1', name: 'Cold Coffee', legacy_bubble_id: null, image_asset_id: null }]

  const first = matchDishes(dishes, images)
  const second = matchDishes(dishes, [...images].reverse())

  assert.equal(first.ambiguous.length, 1)
  assert.equal(first.ambiguous[0].count, 2)
  assert.equal(first.matched[0].image.id, 'bub-2')
  assert.equal(second.matched[0].image.id, 'bub-2', 'input order must not change the choice')
})

test('fixture aliases are opt-in', () => {
  const images = [img('bub-1', 'Veg Sandwich In Brown Bread')]
  const dishes = [{ id: 'd1', name: 'Veg Sandwich', legacy_bubble_id: null, image_asset_id: null }]

  assert.equal(matchDishes(dishes, images).matched.length, 0)
  const on = matchDishes(dishes, images, { useAliases: true })
  assert.equal(on.matched[0].how, 'fixture-alias')
  assert.equal(on.matched[0].image.id, 'bub-1')
})

test('a dish with no image is reported rather than silently dropped', () => {
  const dishes = [{ id: 'd1', name: 'Nothing Like This', legacy_bubble_id: null, image_asset_id: null }]
  const { matched, unmatched } = matchDishes(dishes, [img('bub-1', 'Tea')], { useAliases: true })
  assert.equal(matched.length, 0)
  assert.deepEqual(unmatched.map((d) => d.name), ['Nothing Like This'])
})

// -----------------------------------------------------------------------------
// readDimensions
// -----------------------------------------------------------------------------

test('readDimensions reads PNG and JPEG headers, and gives up rather than guessing', () => {
  const png = Buffer.alloc(32)
  png.writeUInt32BE(0x89504e47, 0)
  png.writeUInt32BE(640, 16)
  png.writeUInt32BE(480, 20)
  assert.deepEqual(readDimensions(png), { width: 640, height: 480 })

  // SOI, then a minimal SOF0 segment: length, precision, height, width.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03])
  assert.deepEqual(readDimensions(jpeg), { width: 400, height: 300 })

  assert.equal(readDimensions(Buffer.from('not an image at all')), null)
})

// -----------------------------------------------------------------------------
// The manifest this tool is pointed at
// -----------------------------------------------------------------------------

test('every uploadable manifest entry has the fields the upload needs', async () => {
  const manifest = JSON.parse(await readFile(join(REPO, 'tools', 'mirror-dish-images', 'manifest.json'), 'utf8'))
  const ok = manifest.images.filter((i) => i.status === 'ok')

  assert.equal(ok.length, 82, 'E16-28 mirrored 82; the other 3 are a permanent 403 at source')

  for (const i of ok) {
    assert.match(i.sha256, /^[0-9a-f]{64}$/, `${i.file} has no usable checksum`)
    assert.ok(i.bytes > 0, `${i.file} has no size`)
    assert.match(i.contentType, /^image\//, `${i.file} is not an image`)
    assert.ok(!i.file.includes('/'), `${i.file} must be a bare filename — it becomes a storage key`)
  }

  // Storage keys must be unique or one upload would overwrite another's bytes.
  assert.equal(new Set(ok.map((i) => i.file)).size, ok.length, 'duplicate filenames would collide in the bucket')
})
