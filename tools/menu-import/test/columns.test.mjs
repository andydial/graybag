import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectColumns, normaliseHeader } from '../src/columns.mjs'
import { HEADER } from './sample-menu.mjs'

test('normalises header labels to a comparable key', () => {
  assert.equal(normaliseHeader('Item No.'), 'item no')
  assert.equal(normaliseHeader('  Portion/Weight  '), 'portion weight')
  assert.equal(normaliseHeader('Category - ORIG'), 'category orig')
  assert.equal(normaliseHeader(null), '')
})

test('finds the documented header and maps every column', () => {
  const result = detectColumns([HEADER])
  assert.equal(result.headerRowIndex, 0)
  assert.deepEqual(result.mapped, {
    item_no: 0, name: 1, description: 2, ingredients: 3, calories: 4,
    portion: 5, allergens: 6, category: 7, price: 9,
  })
  assert.deepEqual(result.missingRequired, [])
})

test('drops Category - ORIG deliberately rather than ignoring it silently (E04-05)', () => {
  const result = detectColumns([HEADER])
  assert.equal('category_orig' in result.mapped, false)
  assert.deepEqual(result.ignored.map((c) => c.field), ['category_orig'])
})

test('skips a title row above the real header', () => {
  const result = detectColumns([['GrayBag Menu — Term 1'], [], HEADER])
  assert.equal(result.headerRowIndex, 2)
  assert.equal(result.mapped.name, 1)
})

test('matches renamed columns by alias and in any order', () => {
  const result = detectColumns([['Price (INR)', 'Dish Name', 'Section', 'Allergies']])
  assert.deepEqual(result.mapped, { price: 0, name: 1, category: 2, allergens: 3 })
  assert.deepEqual(result.missingRequired, [])
})

test('reports unrecognised columns instead of dropping them quietly', () => {
  const result = detectColumns([['Menu Item', 'Price', 'Category', 'Kitchen Notes']])
  assert.deepEqual(result.unknown, [{ label: 'Kitchen Notes', columnIndex: 3 }])
})

test('names the optional columns this sheet does not have', () => {
  const result = detectColumns([HEADER])
  assert.deepEqual(result.missingOptional.sort(), ['available_days', 'image_filename'])
})

test('flags a duplicate header rather than silently taking the first', () => {
  const result = detectColumns([['Menu Item', 'Category', 'Price', 'Rate']])
  assert.deepEqual(result.duplicates, [{ field: 'price', columnIndexes: [2, 3] }])
})

test('reports which required columns are missing', () => {
  const result = detectColumns([['Menu Item', 'Description']])
  assert.deepEqual(result.missingRequired, ['price', 'category'])
})

test('throws when nothing in the search window looks like a header', () => {
  assert.throws(
    () => detectColumns([['a', 'b'], ['c', 'd']]),
    /no header row found/,
  )
})
