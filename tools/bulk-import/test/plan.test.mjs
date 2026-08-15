import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planBreakTimes, planDishes, planMenus, planSchools } from '../src/plan.mjs';

const snap = (o = {}) => ({
  cities: [{ id: 'city-1', code: 'mohali', name: 'SAS Nagar (Mohali)' }],
  kitchens: [{ id: 'k-1', code: 'k1' }],
  schools: [],
  categories: [{ id: 'cat-1', code: 'quick_bites', name: 'Quick Bites' }],
  allergens: [{ id: 'al-1', code: 'milk' }, { id: 'al-2', code: 'tree_nut' }],
  dishes: [],
  menus: [],
  ...o,
});

const school = (o = {}) => ({
  __row: 2, code: 'amity', name: 'Amity', city: 'mohali', kitchenCode: 'k1',
  institutionType: 'school', addressLine1: null, addressLine2: null, postcode: null,
  contactName: null, contactEmail: null, contactPhone: null,
  serviceDays: null, cutoffTime: null, cutoffDaysBefore: null, ...o,
});

const dish = (o = {}) => ({
  __row: 2, name: 'Veg Sandwich', kitchenCode: 'k1', category: 'quick_bites', foodType: null,
  description: null, ingredientsText: null, caloriesKcal: null, portionText: null,
  allergens: [], imageFile: null, isActive: null, ...o,
});

const item = (o = {}) => ({
  __row: 2, menuCode: 'term1', menuName: 'Term 1', kitchenCode: 'k1', dishName: 'Veg Sandwich',
  pricePaise: 4500, availableDays: [1, 2, 3, 4, 5], schoolCode: null,
  validFrom: null, validTo: null, sortOrder: 0, ...o,
});

// ---------------------------------------------------------------------------- schools

test('a school that does not exist is a create', () => {
  const plan = planSchools([school()], snap());
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.updates.length, 0);
});

test('a school that matches exactly is unchanged, not an update', () => {
  const plan = planSchools([school()], snap({
    schools: [{ id: 's-1', code: 'amity', name: 'Amity', institutionType: 'school' }],
  }));
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.updates.length, 0);
});

test('a changed name is an update naming the field', () => {
  const plan = planSchools([school({ name: 'Amity International' })], snap({
    schools: [{ id: 's-1', code: 'amity', name: 'Amity', institutionType: 'school' }],
  }));
  assert.deepEqual(plan.updates[0].changed, ['name']);
});

test('a column the file omitted does not blank the stored value', () => {
  // The failure this guards: a CSV without a `postcode` column read as "set every postcode to
  // null" quietly empties a field across the catalogue.
  const plan = planSchools([school({ postcode: null })], snap({
    schools: [{ id: 's-1', code: 'amity', name: 'Amity', institutionType: 'school', postcode: '160055' }],
  }));
  assert.equal(plan.unchanged.length, 1);
});

test('config changes are tracked apart from school columns', () => {
  const plan = planSchools([school({ serviceDays: [1, 2, 3, 4, 5] })], snap({
    schools: [{ id: 's-1', code: 'amity', name: 'Amity', institutionType: 'school', serviceDays: null }],
  }));
  assert.deepEqual(plan.updates[0].changed, []);
  assert.deepEqual(plan.updates[0].configChanged, ['service_days']);
});

test('an unknown kitchen is a blocker that lists what does exist', () => {
  const plan = planSchools([school({ kitchenCode: 'nope' })], snap());
  assert.equal(plan.creates.length, 0);
  assert.match(plan.blockers[0].message, /Kitchens are not created by import/);
  assert.match(plan.blockers[0].message, /k1/);
});

test('an unknown city is a blocker', () => {
  const plan = planSchools([school({ city: 'chandigarh' })], snap());
  assert.match(plan.blockers[0].message, /Cities are reference data/);
  assert.match(plan.blockers[0].message, /mohali/);
});

// ---------------------------------------------------------------------------- dishes

test('a dish is matched per kitchen by name, case-insensitively', () => {
  const plan = planDishes([dish({ name: 'VEG SANDWICH' })], snap({
    dishes: [{ id: 'd-1', name: 'Veg Sandwich', kitchenCode: 'k1', allergens: [] }],
  }));
  assert.equal(plan.creates.length, 0);
  assert.equal(plan.unchanged.length, 1);
});

test('the same dish name at another kitchen is a separate dish', () => {
  const plan = planDishes([dish({ kitchenCode: 'k1' })], snap({
    kitchens: [{ id: 'k-1', code: 'k1' }, { id: 'k-2', code: 'k2' }],
    dishes: [{ id: 'd-1', name: 'Veg Sandwich', kitchenCode: 'k2', allergens: [] }],
  }));
  assert.equal(plan.creates.length, 1);
});

test('an unknown allergen code is a BLOCKER, never a warning', () => {
  // The one failure on this tool that could hurt a child: `dish_allergen` and
  // `recipient_allergen` share a vocabulary, so a code matching nothing means the warning
  // silently never fires.
  const plan = planDishes([dish({ allergens: ['peanut'] })], snap());
  assert.equal(plan.creates.length, 0);
  assert.match(plan.blockers[0].message, /silently/);
  assert.match(plan.blockers[0].message, /milk, tree_nut/);
});

test('an unknown category is a blocker rather than a new category', () => {
  const plan = planDishes([dish({ category: 'quick_bytes' })], snap());
  assert.match(plan.blockers[0].message, /Use the code \(quick_bites\), not the display name/);
});

test('a blank allergen column leaves stored allergens alone', () => {
  const plan = planDishes([dish({ allergens: [] })], snap({
    dishes: [{ id: 'd-1', name: 'Veg Sandwich', kitchenCode: 'k1', allergens: ['milk'] }],
  }));
  assert.equal(plan.unchanged.length, 1);
});

test('a different allergen set is an update', () => {
  const plan = planDishes([dish({ allergens: ['milk', 'tree_nut'] })], snap({
    dishes: [{ id: 'd-1', name: 'Veg Sandwich', kitchenCode: 'k1', allergens: ['milk'] }],
  }));
  assert.ok(plan.updates[0].changed.includes('allergens'));
});

test('the same allergen set in a different order is not a change', () => {
  const plan = planDishes([dish({ allergens: ['tree_nut', 'milk'] })], snap({
    dishes: [{ id: 'd-1', name: 'Veg Sandwich', kitchenCode: 'k1', allergens: ['milk', 'tree_nut'] }],
  }));
  assert.equal(plan.unchanged.length, 1);
});

// ---------------------------------------------------------------------------- menus

test('rows are grouped into one menu', () => {
  const { menus } = planMenus(
    [item(), item({ __row: 3, dishName: 'Fruit Bowl' })],
    snap({ dishes: [
      { id: 'd-1', name: 'Veg Sandwich', kitchenCode: 'k1' },
      { id: 'd-2', name: 'Fruit Bowl', kitchenCode: 'k1' },
    ] }),
  );
  assert.equal(menus.length, 1);
  assert.equal(menus[0].items.length, 2);
});

test('a school repeated on every dish row produces ONE assignment', () => {
  // What a spreadsheet naturally produces, and it must not become forty assignments.
  const { menus } = planMenus(
    [
      item({ schoolCode: 'amity', validFrom: '2026-08-17' }),
      item({ __row: 3, dishName: 'Fruit Bowl', schoolCode: 'amity', validFrom: '2026-08-17' }),
    ],
    snap({
      schools: [{ id: 's-1', code: 'amity' }],
      dishes: [
        { id: 'd-1', name: 'Veg Sandwich', kitchenCode: 'k1' },
        { id: 'd-2', name: 'Fruit Bowl', kitchenCode: 'k1' },
      ],
    }),
  );
  assert.equal(menus[0].assignments.size, 1);
});

test('a dish being created in the same run counts as existing', () => {
  // Without this a single file set describing new dishes and the menu they go on always blocks
  // on its own first half.
  const { menus, blockers } = planMenus([item()], snap({
    pendingDishes: [{ name: 'Veg Sandwich', kitchenCode: 'k1' }],
  }));
  assert.equal(blockers.length, 0);
  assert.equal(menus[0].items.length, 1);
});

test('a school being created in the same run counts as existing', () => {
  // The whole point of passing all three files at once: a new school, its dishes and its menu in
  // one command. Without this the menu blocks on a school the same run is about to create.
  const { blockers } = planMenus([item({ schoolCode: 'amity', validFrom: '2026-08-17' })], snap({
    dishes: [{ id: 'd-1', name: 'Veg Sandwich', kitchenCode: 'k1' }],
    pendingSchools: [{ code: 'amity' }],
  }));
  assert.equal(blockers.length, 0);
});

test('a dish that exists nowhere is a blocker that says to import dishes first', () => {
  const { blockers } = planMenus([item()], snap());
  assert.match(blockers[0].message, /Import dishes before menus/);
});

test('an assignment with no valid_from is a blocker', () => {
  const { blockers } = planMenus([item({ schoolCode: 'amity' })], snap({
    schools: [{ id: 's-1', code: 'amity' }],
    dishes: [{ id: 'd-1', name: 'Veg Sandwich', kitchenCode: 'k1' }],
  }));
  assert.match(blockers[0].message, /needs a start date/);
});

test('an unknown school on a menu row is a blocker', () => {
  const { blockers } = planMenus([item({ schoolCode: 'nope', validFrom: '2026-08-17' })], snap({
    dishes: [{ id: 'd-1', name: 'Veg Sandwich', kitchenCode: 'k1' }],
  }));
  assert.match(blockers[0].message, /is not being created by this run/);
});

test('an existing menu is matched on its NAME, not on menu_code', () => {
  // `menu` has no code column, so the name is the only stored handle. Matching on `menu_code`
  // matched nothing, so every run created a fresh menu — and the third run tripped
  // `menu_assignment_no_overlap` with two identical menus assigned to one school.
  const { menus } = planMenus([item({ menuCode: 'term1', menuName: 'Term 1' })], snap({
    dishes: [{ id: 'd-1', name: 'Veg Sandwich', kitchenCode: 'k1' }],
    menus: [{ id: 'm-1', code: 'Term 1', name: 'Term 1', kitchenCode: 'k1' }],
  }));
  assert.equal(menus[0].isNew, false);
  assert.equal(menus[0].id, 'm-1');
});

test('a menu whose stored name differs from menu_code is still matched', () => {
  // The realistic shape: menu_code is a slug, menu_name is what was stored.
  const { menus } = planMenus([item({ menuCode: 'term1_2026', menuName: 'Term 1 2026' })], snap({
    dishes: [{ id: 'd-1', name: 'Veg Sandwich', kitchenCode: 'k1' }],
    menus: [{ id: 'm-9', code: 'Term 1 2026', name: 'Term 1 2026', kitchenCode: 'k1' }],
  }));
  assert.equal(menus[0].isNew, false);
  assert.equal(menus[0].id, 'm-9');
});

// ---------------------------------------------------------------------------- break windows

const breakSnap = (o = {}) => snap({
  schools: [{ id: 's-1', code: 'amity', isActive: true, onboardedAt: '2026-08-01' }],
  breakTimes: [],
  ...o,
});

const window_ = (o = {}) => ({
  __row: 2, schoolCode: 'amity', code: 'morning-break', label: 'Morning break',
  startsAt: '10:40:00', endsAt: '11:15:00', sortOrder: null, isActive: null, ...o,
});

test('a window that does not exist is a create', () => {
  const plan = planBreakTimes([window_()], breakSnap());
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0].schoolId, 's-1');
});

test('an identical window is unchanged, not an update', () => {
  // The property that makes re-running an export safe.
  const plan = planBreakTimes([window_()], breakSnap({
    breakTimes: [{ id: 'b-1', schoolCode: 'amity', code: 'morning-break', label: 'Morning break', startsAt: '10:40:00', endsAt: '11:15:00', sortOrder: 10, isActive: true }],
  }));
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.creates.length, 0);
});

test('a changed time is an update naming the field', () => {
  const plan = planBreakTimes([window_({ startsAt: '10:45:00' })], breakSnap({
    breakTimes: [{ id: 'b-1', schoolCode: 'amity', code: 'morning-break', label: 'Morning break', startsAt: '10:40:00', endsAt: '11:15:00', sortOrder: 10, isActive: true }],
  }));
  assert.deepEqual(plan.updates[0].changed, ['starts_at']);
});

test('an unknown school is a blocker', () => {
  const plan = planBreakTimes([window_({ schoolCode: 'nope' })], breakSnap());
  assert.match(plan.blockers[0].message, /Import schools before their break windows/);
});

test('reports which schools are STILL closed after the file is applied', () => {
  // P19 makes this the headline, not a footnote: an active onboarded school with no window takes
  // no orders at all, and a plan that fixed one school while leaving another shut must say so.
  const plan = planBreakTimes([window_()], breakSnap({
    schools: [
      { id: 's-1', code: 'amity', isActive: true, onboardedAt: '2026-08-01' },
      { id: 's-2', code: 'gem', isActive: true, onboardedAt: '2026-08-01' },
    ],
  }));
  assert.deepEqual(plan.stillClosed, ['gem']);
});

test('a school this file opens is not reported as still closed', () => {
  const plan = planBreakTimes([window_()], breakSnap());
  assert.deepEqual(plan.stillClosed, []);
});

test('an inactive or never-onboarded school is not reported as closed', () => {
  // Deactivating a school is a decision, not a gap.
  const plan = planBreakTimes([], breakSnap({
    schools: [
      { id: 's-2', code: 'off', isActive: false, onboardedAt: '2026-08-01' },
      { id: 's-3', code: 'new', isActive: true, onboardedAt: null },
    ],
  }));
  assert.deepEqual(plan.stillClosed, []);
});

// ------------------------------------------------------------------ what does exist (`E10-29`)

test('a dish naming a missing kitchen is told which kitchens exist', () => {
  // Found by dry-running a real file against production from `/admin/import`. The kitchen code is
  // `sky-bites` while the city is `mohali`, so "kitchen_code mohali does not exist" with no list
  // is a dead end — and guessing the kitchen from the city is the exact mistake being made.
  const plan = planDishes(
    [{ __row: 2, kitchenCode: 'mohali', name: 'X', category: 'bakery' }],
    { kitchens: [{ code: 'sky-bites' }], categories: [{ code: 'bakery' }], dishes: [], allergens: [] },
  );
  assert.equal(plan.blockers.length, 1);
  assert.match(plan.blockers[0].message, /Existing: sky-bites/);
});

test('a menu row naming a missing kitchen says the same thing', () => {
  const plan = planMenus(
    [{ __row: 2, kitchenCode: 'nope', menuName: 'M', dishName: 'D', pricePaise: 100 }],
    { kitchens: [{ code: 'sky-bites' }], dishes: [], menus: [], menuItems: [], schools: [] },
  );
  assert.match(plan.blockers[0].message, /Existing: sky-bites/);
});

test('with no kitchens at all it says so rather than printing an empty list', () => {
  const plan = planDishes(
    [{ __row: 2, kitchenCode: 'anything', name: 'X', category: 'bakery' }],
    { kitchens: [], categories: [{ code: 'bakery' }], dishes: [], allergens: [] },
  );
  assert.match(plan.blockers[0].message, /\(none\)/);
});
