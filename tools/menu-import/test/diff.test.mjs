import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildPlan, matchKey, planBlockers } from '../src/diff.mjs'

const stored = (over = {}) => ({
  id: 'dish-1',
  name: 'Veg Sandwich',
  description: 'Grilled',
  ingredients_text: 'bread, paneer',
  calories_kcal: 320,
  portion_text: '150g',
  category_code: 'quick_bites',
  price_paise: 12_500,
  image_filename: null,
  available_days: [1, 2, 3, 4, 5],
  allergens: [{ code: 'milk' }, { code: 'gluten' }],
  allergens_declared_none: false,
  is_active: true,
  ...over,
})

const incoming = (over = {}) => ({
  name: 'Veg Sandwich',
  description: 'Grilled',
  ingredients_text: 'bread, paneer',
  calories_kcal: 320,
  portion_text: '150g',
  category_code: 'quick_bites',
  price_paise: 12_500,
  image_filename: null,
  available_days: [1, 2, 3, 4, 5],
  allergens: [{ code: 'milk' }, { code: 'gluten' }],
  allergens_declared_none: false,
  ...over,
})

test('matchKey is case- and whitespace-insensitive, matching uq_dish_kitchen_name', () => {
  assert.equal(matchKey('  Veg Sandwich '), 'veg sandwich')
  assert.equal(matchKey('VEG SANDWICH'), matchKey('veg sandwich'))
})

test('an identical row is unchanged, not an update', () => {
  const plan = buildPlan([incoming()], [stored()])
  assert.equal(plan.summary.unchanged, 1)
  assert.equal(plan.summary.update, 0)
})

test('allergen order is not a change — the tags are a set', () => {
  // Reporting a diff every time the source cell listed the same allergens in a different
  // order would make every re-import look like a safety change, and an operator who sees
  // 50 spurious allergen diffs stops reading them.
  const plan = buildPlan(
    [incoming({ allergens: [{ code: 'gluten' }, { code: 'milk' }] })],
    [stored()],
  )
  assert.equal(plan.summary.unchanged, 1)
})

test('a new dish is a create', () => {
  const plan = buildPlan([incoming({ name: 'Cold Coffee' })], [stored()])
  assert.equal(plan.summary.create, 1)
  assert.equal(plan.create[0].name, 'Cold Coffee')
})

test('a changed price is an update, and is counted as a money change', () => {
  const plan = buildPlan([incoming({ price_paise: 13_000 })], [stored()])
  assert.equal(plan.summary.update, 1)
  assert.equal(plan.summary.money_changes, 1)
  assert.deepEqual(plan.update[0].changes, [
    { field: 'price_paise', before: 12_500, after: 13_000 },
  ])
})

test('a changed allergen list is counted as a safety change', () => {
  // The number an operator scanning a 50-row diff must not be able to miss. MI2's question
  // — could being wrong hurt someone — is what puts this in its own count.
  const plan = buildPlan([incoming({ allergens: [{ code: 'peanut' }] })], [stored()])
  assert.equal(plan.summary.safety_changes, 1)
})

test('a dish going from declared-none to unknown is a safety change', () => {
  const plan = buildPlan(
    [incoming({ allergens: [], allergens_declared_none: false })],
    [stored({ allergens: [], allergens_declared_none: true })],
  )
  assert.equal(plan.summary.safety_changes, 1)
})

test('a dish absent from the sheet is reported but NOT deactivated by default', () => {
  // The ordinary case is a kitchen sending the ten dishes that changed. Treating absence
  // as deletion turns that into an emptied menu.
  const plan = buildPlan([], [stored()])
  assert.equal(plan.summary.missing, 1)
  assert.equal(plan.summary.deactivate, 0)
  assert.deepEqual(plan.deactivate, [])
})

test('absence deactivates only when asked', () => {
  const plan = buildPlan([], [stored()], { deactivateMissing: true })
  assert.equal(plan.summary.deactivate, 1)
})

test('an inactive dish returning in the sheet is a reactivation, not a silent update', () => {
  // Bringing a withdrawn dish back to sale is a decision. It must appear in the plan even
  // when no field moved, which it would not if reactivation were folded into "unchanged".
  const plan = buildPlan([incoming()], [stored({ is_active: false })])
  assert.equal(plan.summary.reactivate, 1)
  assert.equal(plan.summary.unchanged, 0)
})

test('an inactive dish absent from the sheet is not reported as missing', () => {
  // It is already off sale. Listing it every run trains the operator to skip the section.
  const plan = buildPlan([], [stored({ is_active: false })])
  assert.equal(plan.summary.missing, 0)
})

test('empty string and null are the same absence', () => {
  const plan = buildPlan([incoming({ description: '   ' })], [stored({ description: null })])
  assert.equal(plan.summary.unchanged, 1)
})

test('every change carries both before and after', () => {
  // "Never silently overwrite" means the operator can see what is being replaced, not just
  // what it becomes. A plan that showed only the new value would be a plan you cannot review.
  const plan = buildPlan([incoming({ portion_text: '200g' })], [stored()])
  const change = plan.update[0].changes[0]
  assert.equal(change.before, '150g')
  assert.equal(change.after, '200g')
})

test('mass deactivation blocks', () => {
  const snapshot = Array.from({ length: 10 }, (_, i) =>
    stored({ id: `d${i}`, name: `Dish ${i}` }),
  )
  const plan = buildPlan([incoming({ name: 'Dish 0' })], snapshot, { deactivateMissing: true })
  const blockers = planBlockers(plan, snapshot)
  assert.ok(blockers.some((b) => b.code === 'mass_deactivation'), JSON.stringify(blockers))
})

test('a proportionate deactivation does not block', () => {
  const snapshot = Array.from({ length: 10 }, (_, i) =>
    stored({ id: `d${i}`, name: `Dish ${i}` }),
  )
  const dishes = snapshot.slice(0, 9).map((row) => incoming({ name: row.name }))
  const plan = buildPlan(dishes, snapshot, { deactivateMissing: true })
  assert.deepEqual(planBlockers(plan, snapshot), [])
})

test('a sheet that changes nothing against a live menu blocks', () => {
  // Almost always the wrong sheet name or a missed header row. "No changes" and "I read
  // the wrong tab" are indistinguishable from the outside, and one of them is a no-op.
  const snapshot = [stored()]
  const plan = buildPlan([], snapshot)
  const blockers = planBlockers(plan, snapshot)
  assert.ok(blockers.some((b) => b.code === 'no_changes_but_menu_exists'))
})

test('a first import into an empty menu does not block', () => {
  const plan = buildPlan([incoming()], [])
  assert.deepEqual(planBlockers(plan, []), [])
  assert.equal(plan.summary.create, 1)
})
