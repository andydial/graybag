import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importMenuWorkbook, importRows } from '../src/import.mjs'
import { renderReport } from '../src/report.mjs'
import { makeWorkbook } from './make-workbook.mjs'
import { HEADER, SAMPLE_ROWS } from './sample-menu.mjs'

const sample = () => importRows(SAMPLE_ROWS, { sourceName: 'sample-menu.mjs', sheetName: 'Menu' })

const rowsWith = (...dataRows) => [HEADER, ...dataRows]
const dishRow = (overrides = {}) => {
  const base = {
    item_no: 1, name: 'Test Dish', description: 'd', ingredients: 'i', calories: '300',
    portion: '100 g', allergens: 'None', category: 'Meals', category_orig: 'x', price: 60,
  }
  const merged = { ...base, ...overrides }
  return [
    merged.item_no, merged.name, merged.description, merged.ingredients, merged.calories,
    merged.portion, merged.allergens, merged.category, merged.category_orig, merged.price,
  ]
}

const firstErrorCodes = (result) => result.rejected.flatMap((r) => r.errors.map((e) => e.code))

test('reads a real .xlsx end to end', () => {
  const buf = makeWorkbook([{ name: 'Menu', rows: SAMPLE_ROWS }])
  const result = importMenuWorkbook(buf, { sourceName: 'sample.xlsx' })
  assert.equal(result.meta.sheet, 'Menu')
  assert.equal(result.meta.source_file, 'sample.xlsx')
  assert.ok(result.dishes.length > 0)
})

test('every row below the header is accounted for — nothing is silently dropped', () => {
  const result = sample()
  assert.equal(
    result.meta.accepted + result.meta.rejected + result.meta.skipped,
    result.meta.rows_below_header,
  )
})

test('a valid row becomes a dish in the target schema shape', () => {
  const result = importRows(rowsWith(dishRow({
    name: 'Veg Sandwich', allergens: 'Gluten, Milk', category: 'Sandwich', price: 60, calories: '320',
  })))
  assert.deepEqual(result.rejected, [])
  assert.deepEqual(result.dishes[0], {
    row: 2,
    item_no: '1',
    name: 'Veg Sandwich',
    description: 'd',
    ingredients_text: 'i',
    calories_kcal: 320,
    portion_text: '100 g',
    category_code: 'sandwich',
    food_type: null,
    price_paise: 6000,
    allergens: [{ code: 'milk', presence: 'contains' }, { code: 'gluten', presence: 'contains' }],
    allergens_declared_none: false,
    allergens_raw: 'Gluten, Milk',
    image_filename: null,
    available_days: null,
  })
})

test('prices land as integer paise and nothing else', () => {
  const result = importRows(rowsWith(dishRow({ price: 75.5 }), dishRow({ item_no: 2, name: 'B', price: '₹110.05' })))
  for (const dish of result.dishes) assert.ok(Number.isSafeInteger(dish.price_paise))
  assert.deepEqual(result.dishes.map((d) => d.price_paise), [7550, 11005])
})

test('food_type is null on every dish and the file says why ([DM-17])', () => {
  const result = sample()
  for (const dish of result.dishes) assert.equal(dish.food_type, null)
  assert.ok(result.file_issues.some((i) => i.code === 'food_type_absent'))
})

test('the settled tax question is not re-opened per dish (SC2 closed [DM-20])', () => {
  // SC2 closed [DM-20] on 2026-08-07: prices are GST-EXCLUSIVE and that is platform
  // config (0003), not a per-dish field. The importer must not re-open a settled
  // question by emitting a null that reads as "undecided".
  for (const dish of sample().dishes) {
    assert.ok(!('price_is_tax_inclusive' in dish), 'per-dish tax-inclusive flag is stale — SC2/0003')
  }
})

test('reports every kind of row failure, and reports them per row', () => {
  const result = sample()
  const codes = new Set(firstErrorCodes(result))
  for (const expected of [
    'price_missing', 'name_missing', 'price_unparseable', 'price_not_positive',
    'category_unknown', 'category_not_migratable', 'allergen_uncoded', 'allergen_unknown',
    'duplicate_name', 'price_sub_paisa',
  ]) {
    assert.ok(codes.has(expected), `expected a ${expected} rejection`)
  }
  for (const row of result.rejected) {
    assert.ok(Number.isInteger(row.row) && row.row > 0)
    assert.ok(row.errors.length > 0)
    assert.ok(row.errors.every((e) => e.code && e.field && e.message))
  }
})

test('a blank allergen cell warns but does not fail the row', () => {
  const result = importRows(rowsWith(dishRow({ allergens: null })))
  assert.deepEqual(result.rejected, [])
  assert.deepEqual(result.dishes[0].allergens, [])
  assert.equal(result.dishes[0].allergens_declared_none, false)
  const warning = result.warnings.find((w) => w.code === 'allergens_blank')
  assert.ok(warning, 'expected an allergens_blank warning')
  assert.match(warning.message, /not as "none"/)
})

test('an explicit "None" records that the kitchen checked', () => {
  const result = importRows(rowsWith(dishRow({ allergens: 'None' })))
  assert.equal(result.dishes[0].allergens_declared_none, true)
  assert.equal(result.warnings.filter((w) => w.code === 'allergens_blank').length, 0)
})

test('an allergen with no seeded code fails the row rather than importing unwarned', () => {
  const result = importRows(rowsWith(dishRow({ allergens: 'Gluten, Shellfish' })))
  assert.equal(result.dishes.length, 0)
  assert.deepEqual(result.rejected[0].errors.map((e) => e.code), ['allergen_uncoded'])
  assert.match(result.rejected[0].errors[0].message, /DM-13/)
})

test('unparseable calories become null with a warning, never a guess', () => {
  const result = importRows(rowsWith(
    dishRow({ calories: '300-400' }),
    dishRow({ item_no: 2, name: 'B', calories: 'approx' }),
    dishRow({ item_no: 3, name: 'C', calories: '99999' }),
  ))
  assert.deepEqual(result.dishes.map((d) => d.calories_kcal), [null, null, null])
  assert.deepEqual(
    result.warnings.map((w) => w.code),
    ['calories_range', 'calories_unparseable', 'calories_implausible'],
  )
})

test('duplicate names and item numbers are rejected against the (kitchen, lower(name)) unique', () => {
  const result = importRows(rowsWith(
    dishRow({ item_no: 1, name: 'Veg Sandwich' }),
    dishRow({ item_no: 2, name: 'VEG SANDWICH' }),
    dishRow({ item_no: 1, name: 'Other Dish' }),
  ))
  assert.equal(result.dishes.length, 1)
  assert.deepEqual(result.rejected.map((r) => r.errors[0].code), ['duplicate_name', 'duplicate_item_no'])
  assert.match(result.rejected[0].errors[0].message, /row 2/)
})

test('--allow-new-categories downgrades an unseeded category to a warning', () => {
  const strict = importRows(rowsWith(dishRow({ category: 'Tiffin' })))
  assert.equal(strict.rejected[0].errors[0].code, 'category_unknown')

  const lenient = importRows(rowsWith(dishRow({ category: 'Tiffin' })), { allowNewCategories: true })
  assert.deepEqual(lenient.rejected, [])
  assert.equal(lenient.dishes[0].category_code, 'tiffin')
  assert.equal(lenient.warnings[0].code, 'category_new')
})

test('"All" is never accepted as a category, even leniently', () => {
  const result = importRows(rowsWith(dishRow({ category: 'All' })), { allowNewCategories: true })
  assert.equal(result.rejected[0].errors[0].code, 'category_not_migratable')
})

test('a row that looks like a section heading fails, but says so', () => {
  const result = importRows(rowsWith([null, 'Drinks', null, null, null, null, null, null, null, null]))
  const rejection = result.rejected[0]
  assert.ok(rejection.errors.some((e) => e.code === 'price_missing'))
  assert.match(rejection.hints.join(' '), /section heading/)
})

test('blank rows are skipped and counted, not treated as failures', () => {
  const result = importRows(rowsWith(dishRow(), [], [null, null, null]))
  assert.equal(result.meta.accepted, 1)
  assert.equal(result.meta.rejected, 0)
  assert.equal(result.meta.skipped, 2)
})

test('the allergen report is the [DM-13] deliverable', () => {
  const report = sample().allergen_report
  assert.ok(report.blank_cells >= 1)
  assert.ok(report.declared_none >= 1)
  assert.ok(report.codes_used.some((c) => c.code === 'milk'))
  assert.ok(report.codes_unused.includes('celery'))
  assert.deepEqual(report.uncoded, [{ token: 'Shellfish (mollusc)', count: 1 }])
  assert.deepEqual(report.unmapped, [{ token: 'Ask the chef', count: 1 }])
  assert.ok(report.fragments.some((f) => f.fragment === 'milk' && f.code === 'milk'))
  assert.ok(report.distinct_cell_values.some((v) => v.value === 'Gluten, Milk'))
})

test('a missing required column is fatal and names what was found', () => {
  assert.throws(
    () => importRows([['Menu Item', 'Description'], ['Veg Sandwich', 'd']]),
    /missing required column\(s\): price, category/,
  )
})

test('an ambiguous duplicate header is fatal rather than guessed', () => {
  assert.throws(
    () => importRows([['Menu Item', 'Category', 'Price', 'Rate'], ['A', 'Meals', 60, 70]]),
    /ambiguous headers/,
  )
})

test('optional E04-05 columns are read when present', () => {
  const rows = [
    [...HEADER, 'Image Filename', 'Available Days'],
    [...dishRow(), 'veg-sandwich.jpg', 'Mon, Tue, Fri'],
  ]
  const result = importRows(rows)
  assert.equal(result.dishes[0].image_filename, 'veg-sandwich.jpg')
  assert.deepEqual(result.dishes[0].available_days, ['mon', 'tue', 'fri'])
})

test('the result is JSON-serialisable and stable across runs', () => {
  const once = JSON.stringify(sample())
  const twice = JSON.stringify(sample())
  assert.equal(once, twice)
  assert.deepEqual(JSON.parse(once).meta.accepted, sample().meta.accepted)
})

test('the text report lists every rejected row', () => {
  const result = sample()
  const text = renderReport(result)
  for (const row of result.rejected) assert.match(text, new RegExp(`row ${row.row}:`))
  assert.match(text, /row\(s\) need fixing/)
})
