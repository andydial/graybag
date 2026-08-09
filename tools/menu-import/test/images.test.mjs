import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  imageBlockers,
  imageKey,
  isSupportedImage,
  matchImages,
  readImageFolder,
  renderImageReport,
} from '../src/images.mjs'

/** A fake folder, so the tests do not touch disk. */
function folderOf(entries) {
  const names = Object.keys(entries)
  return {
    readDir: () => names,
    stat: (full) => {
      const name = full.split('/').pop()
      const e = entries[name]
      return { isDirectory: () => e.dir === true, size: e.size ?? 1000 }
    },
  }
}

const dish = (name, image_filename = null) => ({ name, image_filename })

test('imageKey normalises case, punctuation and extension', () => {
  // Two humans, two machines. A matcher that says these differ makes the operator rename
  // fifty files by hand, inconsistently, and the next import breaks differently.
  const key = imageKey('Veg Sandwich.JPG')
  assert.equal(imageKey('veg-sandwich.jpg'), key)
  assert.equal(imageKey('veg_sandwich.jpeg'), key)
  assert.equal(imageKey('  Veg   Sandwich .png'), key)
})

test('imageKey keeps a duplicate marker rather than eating it', () => {
  // `(1)` is usually a duplicate download. Treating it as the original is how the wrong
  // photo ships.
  assert.notEqual(imageKey('veg-sandwich (1).jpg'), imageKey('veg-sandwich.jpg'))
})

test('imageKey strips diacritics', () => {
  assert.equal(imageKey('Jalapeño Poppers.jpg'), imageKey('jalapeno-poppers.jpg'))
})

test('isSupportedImage accepts what a browser renders and rejects the rest', () => {
  for (const ok of ['a.jpg', 'a.JPEG', 'a.png', 'a.webp', 'a.avif', 'a.heic']) {
    assert.ok(isSupportedImage(ok), ok)
  }
  for (const no of ['a.pdf', 'a.xlsx', 'a', 'a.txt']) {
    assert.equal(isSupportedImage(no), false, no)
  }
})

test('readImageFolder ignores dotfiles, including macOS resource forks', () => {
  // `._Veg Sandwich.jpg` HAS an image extension and normalises to something close to a real
  // dish, so it would otherwise match.
  const { files, ignored } = readImageFolder('/photos', folderOf({
    'veg-sandwich.jpg': {},
    '.DS_Store': {},
    '._veg-sandwich.jpg': {},
  }))
  assert.deepEqual(files.map((f) => f.name), ['veg-sandwich.jpg'])
  assert.equal(ignored.length, 2)
})

test('readImageFolder does not descend into folders', () => {
  // A `.thumbnails/` directory holds files with the same names and the wrong contents.
  const { files, ignored } = readImageFolder('/photos', folderOf({
    'a.jpg': {},
    thumbnails: { dir: true },
  }))
  assert.deepEqual(files.map((f) => f.name), ['a.jpg'])
  assert.equal(ignored[0].reason, 'directory (folders are not searched)')
})

test('readImageFolder reports an unsupported file rather than dropping it', () => {
  const { ignored } = readImageFolder('/photos', folderOf({ 'notes.txt': {} }))
  assert.match(ignored[0].reason, /unsupported extension/)
})

test('matches a dish to its named file across naming styles', () => {
  const folder = readImageFolder('/photos', folderOf({ 'veg-sandwich.jpg': { size: 2048 } }))
  const match = matchImages([dish('Veg Sandwich', 'Veg Sandwich.JPG')], folder)
  assert.equal(match.summary.matched, 1)
  assert.equal(match.matched[0].file, 'veg-sandwich.jpg')
  assert.equal(match.summary.total_bytes, 2048)
})

/**
 * The refusal that matters. A dish called "Veg Sandwich" and a file called
 * `veg-sandwich.jpg` look like a pair — and matching on dish name means a sheet with no
 * `image_filename` column silently acquires images by coincidence, including wrong ones, on
 * a menu where the picture sits next to allergen information.
 */
test('never matches on dish name — only on what the sheet names', () => {
  const folder = readImageFolder('/photos', folderOf({ 'veg-sandwich.jpg': {} }))
  const match = matchImages([dish('Veg Sandwich', null)], folder)
  assert.equal(match.summary.matched, 0)
  assert.equal(match.summary.no_image_named, 1)
  assert.equal(match.summary.orphans, 1)
})

test('every dish and every file lands in exactly one bucket', () => {
  // MI3's accounting rule, applied to images: an importer that quietly drops the four files
  // it did not understand produces a menu that is almost illustrated.
  const folder = readImageFolder('/photos', folderOf({
    'a.jpg': {},
    'orphan.jpg': {},
  }))
  const dishes = [dish('A', 'a.jpg'), dish('B', 'b.jpg'), dish('C', null)]
  const m = matchImages(dishes, folder)

  assert.equal(m.summary.matched + m.summary.missing + m.summary.no_image_named, dishes.length)
  assert.equal(m.summary.matched + m.summary.orphans, folder.files.length)
})

test('reports a named file that is not in the folder', () => {
  const folder = readImageFolder('/photos', folderOf({}))
  const m = matchImages([dish('Veg Sandwich', 'veg.jpg')], folder)
  assert.deepEqual(m.missing, [{ dish: 'Veg Sandwich', named: 'veg.jpg' }])
})

test('reports a file nothing references', () => {
  const folder = readImageFolder('/photos', folderOf({ 'spare.png': {} }))
  const m = matchImages([], folder)
  assert.deepEqual(m.orphans, [{ file: 'spare.png', bytes: 1000 }])
})

/**
 * Two files normalising to one key are NOT resolved by picking one. `veg-sandwich.jpg` and
 * `Veg Sandwich.png` are two different photos, and only the operator knows which is current.
 */
test('two files with one normalised name are ambiguous, and block', () => {
  const folder = readImageFolder('/photos', folderOf({
    'veg-sandwich.jpg': {},
    'Veg Sandwich.png': {},
  }))
  const m = matchImages([dish('Veg Sandwich', 'veg-sandwich.jpg')], folder)
  assert.equal(m.summary.ambiguous, 1)
  assert.ok(imageBlockers(m).some((b) => b.code === 'ambiguous_filenames'))
})

test('most images missing blocks — usually the wrong folder', () => {
  const folder = readImageFolder('/photos', folderOf({ 'a.jpg': {} }))
  const dishes = [dish('A', 'a.jpg'), dish('B', 'b.jpg'), dish('C', 'c.jpg'), dish('D', 'd.jpg')]
  const m = matchImages(dishes, folder)
  assert.ok(imageBlockers(m).some((b) => b.code === 'most_images_missing'))
})

test('a complete folder does not block', () => {
  const folder = readImageFolder('/photos', folderOf({ 'a.jpg': {}, 'b.jpg': {} }))
  const m = matchImages([dish('A', 'a.jpg'), dish('B', 'b.jpg')], folder)
  assert.deepEqual(imageBlockers(m), [])
})

test('a sheet naming no images at all does not block', () => {
  // Nothing is named, so nothing is missing. Dividing by a zero denominator would either
  // throw or produce NaN > 0.5 === false by luck; this asserts it is by design.
  const folder = readImageFolder('/photos', folderOf({ 'a.jpg': {} }))
  const m = matchImages([dish('A', null)], folder)
  assert.deepEqual(imageBlockers(m), [])
})

test('the report ends by saying nothing was uploaded', () => {
  const folder = readImageFolder('/photos', folderOf({ 'a.jpg': {} }))
  const m = matchImages([dish('A', 'a.jpg')], folder)
  assert.match(renderImageReport(m, '/photos'), /Nothing has been uploaded\. This is a plan\.$/)
})

test('the report names every unmatched file and dish', () => {
  const folder = readImageFolder('/photos', folderOf({ 'spare.png': {} }))
  const m = matchImages([dish('A', 'missing.jpg')], folder)
  const text = renderImageReport(m, '/photos')
  assert.match(text, /NAMED BUT NOT FOUND/)
  assert.match(text, /A -> missing\.jpg/)
  assert.match(text, /REFERENCED BY NOTHING/)
  assert.match(text, /spare\.png/)
})
