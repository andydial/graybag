import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildPlan } from '../src/diff.mjs'
import { renderPlan } from '../src/plan-report.mjs'

const stored = (over = {}) => ({
  id: 'd1',
  name: 'Veg Sandwich',
  category_code: 'sandwich',
  price_paise: 6_000,
  allergens: [{ code: 'milk' }],
  allergens_declared_none: false,
  available_days: [1, 2, 3, 4, 5],
  is_active: true,
  ...over,
})

const incoming = (over = {}) => ({
  name: 'Veg Sandwich',
  category_code: 'sandwich',
  price_paise: 6_000,
  allergens: [{ code: 'milk' }],
  allergens_declared_none: false,
  available_days: [1, 2, 3, 4, 5],
  ...over,
})

test('allergen changes are printed before price changes', () => {
  // The ordering IS the control. An operator scanning a long diff reads the top; putting
  // safety below forty price rows is the same as not printing it.
  const plan = buildPlan(
    [incoming({ allergens: [{ code: 'peanut' }], price_paise: 6_500 })],
    [stored()],
  )
  const text = renderPlan(plan)
  assert.ok(text.indexOf('ALLERGEN CHANGES') < text.indexOf('PRICE CHANGES'), text)
})

test('prices are rendered in rupees, not raw paise', () => {
  // 6500 on a page is ambiguous between Rs 65 and Rs 6500, and an operator approving a
  // price change has to be able to read it without doing arithmetic.
  const plan = buildPlan([incoming({ price_paise: 6_500 })], [stored()])
  const text = renderPlan(plan)
  assert.match(text, /Rs 60\.00 -> Rs 65\.00/)
})

test('a dish losing its declared-none status renders in words, not as a boolean', () => {
  const plan = buildPlan(
    [incoming({ allergens: [], allergens_declared_none: false })],
    [stored({ allergens: [], allergens_declared_none: true })],
  )
  const text = renderPlan(plan)
  assert.match(text, /declared none -> NOT declared/)
})

test('absent dishes are shown even when nothing will happen to them', () => {
  // "The sheet does not mention these" is the most useful signal that the wrong file was
  // exported, so it is printed whether or not it results in an action.
  const plan = buildPlan([], [stored()])
  const text = renderPlan(plan)
  assert.match(text, /ABSENT FROM THE SHEET \(1\)/)
  assert.match(text, /nothing happens to these/)
})

test('retirement reads differently from mere absence', () => {
  const plan = buildPlan([], [stored()], { deactivateMissing: true })
  const text = renderPlan(plan)
  assert.match(text, /TO BE RETIRED \(1\)/)
  assert.doesNotMatch(text, /nothing happens to these/)
})

test('every report ends by saying nothing was written', () => {
  // The single most important line for an operator who is not sure what just happened.
  const plan = buildPlan([incoming({ name: 'New' })], [stored()])
  assert.match(renderPlan(plan), /Nothing has been written\. This is a plan\.$/)
})

test('blockers are printed under their own heading', () => {
  const snapshot = Array.from({ length: 10 }, (_, i) => stored({ id: `d${i}`, name: `Dish ${i}` }))
  const plan = buildPlan([], snapshot, { deactivateMissing: true })
  plan.blockers = [{ code: 'mass_deactivation', message: 'most of the menu' }]
  const text = renderPlan(plan)
  assert.match(text, /BLOCKED/)
  assert.match(text, /\[mass_deactivation\]/)
})
