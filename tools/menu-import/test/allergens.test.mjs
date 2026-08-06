import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAllergenCell, ALLERGEN_CODES, ALLERGEN_SYNONYMS, UNCODED_ALLERGENS } from '../src/allergens.mjs'

const codesOf = (cell) => parseAllergenCell(cell).tags.map((t) => t.code)

test('splits a simple comma-separated cell', () => {
  assert.deepEqual(codesOf('Milk, Gluten'), ['milk', 'gluten'])
})

test('accepts the separators a human actually types', () => {
  for (const cell of ['Milk; Gluten', 'Milk / Gluten', 'Milk & Gluten', 'Milk and Gluten', 'Milk|Gluten']) {
    assert.deepEqual(codesOf(cell), ['milk', 'gluten'], cell)
  }
})

test('strips a leading "Contains:" prefix', () => {
  assert.deepEqual(codesOf('Contains: Milk, Egg'), ['milk', 'egg'])
  assert.deepEqual(codesOf('Allergens - Milk'), ['milk'])
})

test('tags are ordered by the seed list, not by cell word order', () => {
  assert.deepEqual(codesOf('Gluten, Milk'), codesOf('Milk, Gluten'))
})

test('kitchen vocabulary maps to the seeded codes', () => {
  assert.deepEqual(codesOf('Paneer'), ['milk'])
  assert.deepEqual(codesOf('Maida'), ['gluten'])
  assert.deepEqual(codesOf('Til'), ['sesame'])
  assert.deepEqual(codesOf('Kaju, Badam'), ['tree_nut'])
  assert.deepEqual(codesOf('Sarson'), ['mustard'])
})

test('peanut is never folded into tree_nut — they are different allergies', () => {
  assert.deepEqual(codesOf('Groundnut'), ['peanut'])
  assert.deepEqual(codesOf('Peanut, Cashew'), ['peanut', 'tree_nut'])
})

test('an explicit "none" is distinguished from a blank cell', () => {
  for (const none of ['None', 'NIL', 'N/A', '-', 'No allergens']) {
    const result = parseAllergenCell(none)
    assert.equal(result.declaredNone, true, none)
    assert.equal(result.blank, false, none)
    assert.deepEqual(result.tags, [])
  }
  const blank = parseAllergenCell('')
  assert.equal(blank.blank, true)
  assert.equal(blank.declaredNone, false)
  assert.equal(parseAllergenCell(null).blank, true)
})

test('"may contain" is sticky and applies to the rest of the cell', () => {
  const result = parseAllergenCell('Contains milk, may contain traces of peanut, tree nut')
  assert.deepEqual(result.tags, [
    { code: 'peanut', presence: 'may_contain' },
    { code: 'tree_nut', presence: 'may_contain' },
    { code: 'milk', presence: 'contains' },
  ].sort((a, b) => ALLERGEN_CODES.indexOf(a.code) - ALLERGEN_CODES.indexOf(b.code)))
})

test('an explicit "contains" switches stickiness back', () => {
  const result = parseAllergenCell('May contain nuts, contains milk')
  const byCode = Object.fromEntries(result.tags.map((t) => [t.code, t.presence]))
  assert.equal(byCode.tree_nut, 'may_contain')
  assert.equal(byCode.milk, 'contains')
})

test('contains beats may_contain when a cell says both, and reports the conflict', () => {
  const result = parseAllergenCell('Milk, may contain milk')
  assert.deepEqual(result.tags, [{ code: 'milk', presence: 'contains' }])
  assert.deepEqual(result.conflicts, ['milk'])
})

test('the same allergen twice collapses to one tag', () => {
  assert.deepEqual(codesOf('Milk, Dairy, Cheese'), ['milk'])
})

test('recognised-but-uncoded allergens are reported separately from unknown text', () => {
  const shellfish = parseAllergenCell('Shellfish')
  assert.deepEqual(shellfish.tags, [])
  assert.deepEqual(shellfish.uncoded, [{ text: 'Shellfish', family: 'mollusc' }])
  assert.deepEqual(shellfish.unknown, [])

  const nonsense = parseAllergenCell('Ask the chef')
  assert.deepEqual(nonsense.tags, [])
  assert.deepEqual(nonsense.uncoded, [])
  assert.deepEqual(nonsense.unknown, ['Ask the chef'])
})

test('coconut is uncoded rather than silently called a tree nut', () => {
  // FDA says tree nut, EU and FSSAI say not. Resolving that quietly is not the
  // importer's call — see [MI-02] in docs/open-questions.md.
  const result = parseAllergenCell('Coconut')
  assert.deepEqual(result.tags, [])
  assert.deepEqual(result.uncoded, [{ text: 'Coconut', family: 'coconut' }])
})

test('case, spacing and punctuation do not matter', () => {
  assert.deepEqual(codesOf('  MILK  ,   gluten '), codesOf('Milk,Gluten'))
  assert.deepEqual(codesOf('Sesame seeds'), ['sesame'])
  assert.deepEqual(codesOf('Egg (whole)'), ['egg'])
})

test('a qualifier that is not an allergen does not become an unknown token', () => {
  assert.deepEqual(parseAllergenCell('Contains milk products').unknown, [])
  assert.deepEqual(codesOf('Contains milk products'), ['milk'])
})

test('every synonym resolves to a code that exists in the seed list', () => {
  for (const [token, code] of ALLERGEN_SYNONYMS) {
    assert.ok(ALLERGEN_CODES.includes(code), `"${token}" maps to unknown code "${code}"`)
  }
})

test('no token is claimed by both the synonym map and the uncoded map', () => {
  for (const token of UNCODED_ALLERGENS.keys()) {
    assert.ok(!ALLERGEN_SYNONYMS.has(token), `"${token}" is in both maps`)
  }
})

test('every synonym parses back to its own code standing alone', () => {
  for (const [token, code] of ALLERGEN_SYNONYMS) {
    assert.deepEqual(codesOf(token), [code], `"${token}" did not round-trip`)
  }
})
