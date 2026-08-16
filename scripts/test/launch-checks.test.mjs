import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BLOCKER, WARNING, findings, ranked, summarise } from '../lib/launch-checks.mjs';

/** A snapshot with nothing wrong. Each test breaks exactly one thing. */
const clean = (over = {}) => ({
  schools: [
    { id: 's-1', code: 'amity', name: 'Amity', isActive: true, onboardedAt: '2026-08-01', serviceDays: [1, 2, 3, 4, 5] },
  ],
  dishes: [{ id: 'd-1', name: 'Veg Sandwich', foodType: 'veg', isActive: true, ingredientsText: 'Capsicum, corn', description: null }],
  menus: [{ id: 'm-1', name: 'Term 1', status: 'active' }],
  menuItems: [{ menuId: 'm-1', dishId: 'd-1', isActive: true }],
  assignments: [{ schoolId: 's-1', menuId: 'm-1', isLive: true }],
  breakTimes: [{ schoolId: 's-1', isActive: true }],
  platformConfig: { priceIsTaxInclusive: false },
  allergens: [{ code: 'milk', isActive: true }],
  dishAllergens: [{ dishId: 'd-1' }],
  declaredNone: [],
  missingSecrets: [],
  ...over,
});

const titles = (s) => findings(s).map((f) => f.title).join(' | ');

test('a healthy environment reports nothing at all', () => {
  // The property that makes this worth running: a clean report has to be genuinely empty, or
  // nobody reads it on the morning it matters.
  assert.deepEqual(findings(clean()), []);
  assert.equal(summarise(findings(clean())).ready, true);
});

// ---------------------------------------------------------------------------- food type

test('an unmarked dish ON A LIVE MENU is a blocker', () => {
  // The case that was actually true in production: 79 of 79 unmarked, 83 of them offered.
  const f = findings(clean({ dishes: [{ id: 'd-1', name: 'Veg Sandwich', foodType: null, isActive: true }] }));
  assert.equal(f[0].level, BLOCKER);
  assert.match(f[0].title, /no veg \/ non-veg \/ egg marking/);
  assert.match(f[0].detail, /on a live menu right now/);
});

test('an unmarked dish that is NOT on a menu is only a warning', () => {
  // Nothing is being offered unmarked, so nobody is affected — but it will refuse the moment
  // somebody tries to publish it, which is worth knowing before they do.
  const f = findings(clean({
    dishes: [{ id: 'd-9', name: 'Draft Dish', foodType: null, isActive: true }],
    menuItems: [],
    menus: [{ id: 'm-1', name: 'Term 1', status: 'active' }],
  }));
  const mark = f.find((x) => /marking/.test(x.title));
  assert.equal(mark.level, WARNING);
});

test('an unmarked dish parked inactive on a menu is not offered, so only a warning', () => {
  const f = findings(clean({
    dishes: [{ id: 'd-1', name: 'Veg Sandwich', foodType: null, isActive: true }],
    menuItems: [{ menuId: 'm-1', dishId: 'd-1', isActive: false }],
  }));
  assert.equal(f.find((x) => /marking/.test(x.title)).level, WARNING);
});

test('a retired dish with no food type is not reported at all', () => {
  // It cannot be ordered and cannot be published, so it is not a launch problem. Reporting it
  // would be the noise that makes somebody skim the list.
  const f = findings(clean({ dishes: [{ id: 'd-1', name: 'Old', foodType: null, isActive: false }], menuItems: [] }));
  assert.equal(f.filter((x) => /marking/.test(x.title)).length, 0);
});

test('names a few offenders and says how many more, rather than listing 79', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `d-${i}`, name: `Dish ${i}`, foodType: null, isActive: true }));
  const f = findings(clean({ dishes: many, menuItems: [] }));
  const mark = f.find((x) => /marking/.test(x.title));
  assert.equal(mark.names.length, 8);
  assert.equal(mark.more, 4);
});

// ---------------------------------------------------------------------------- schools

test('an active school with no live menu is a blocker', () => {
  assert.match(titles(clean({ assignments: [] })), /no menu today/);
});

test('an assignment that has been revoked does not count as a menu', () => {
  assert.match(titles(clean({ assignments: [{ schoolId: 's-1', menuId: 'm-1', isLive: false }] })), /no menu today/);
});

test('an onboarded school with no break windows is a blocker', () => {
  // P19: a school with no windows cannot be ordered from at all.
  assert.match(titles(clean({ breakTimes: [] })), /no break windows/);
});

test('a school that was never onboarded is a blocker, because it is invisible', () => {
  // P1. Invisible in the picker looks identical to the school not existing.
  const s = clean();
  s.schools[0].onboardedAt = null;
  assert.match(titles(s), /never onboarded/);
});

test('an inactive school is ignored entirely', () => {
  // Deactivating a school is a decision, not a gap. `catalogue.sql` does it deliberately to the
  // synthetic ones, and reporting them every run is how a report gets ignored.
  const s = clean({ assignments: [], breakTimes: [] });
  s.schools[0].isActive = false;
  assert.deepEqual(findings(s), []);
});

test('missing service days is a WARNING, not a blocker', () => {
  // Null means inherit and the platform default is all seven days, so ordering works. It is worth
  // saying because "we do not serve Saturdays" is the commonest thing assumed but not configured.
  const s = clean();
  s.schools[0].serviceDays = null;
  const f = findings(s).find((x) => /service days/.test(x.title));
  assert.equal(f.level, WARNING);
});

// ---------------------------------------------------------------------------- money and menus

test('an unanswered price_is_tax_inclusive is a blocker', () => {
  // [DM-14]. The tax calculation refuses to run, so no checkout can complete.
  assert.match(titles(clean({ platformConfig: { priceIsTaxInclusive: null } })), /price_is_tax_inclusive/);
});

test('false is an answer, and is not reported', () => {
  // The failure a falsy check would produce: `false` is the CORRECT value here — prices are
  // GST-exclusive — and reporting it would send somebody to "fix" a setting that is right.
  assert.equal(findings(clean({ platformConfig: { priceIsTaxInclusive: false } })).length, 0);
});

test('a menu with no active items is a blocker', () => {
  assert.match(titles(clean({ menuItems: [{ menuId: 'm-1', dishId: 'd-1', isActive: false }] })), /no dishes on offer/);
});

test('a missing secret is a blocker and carries its own reason', () => {
  const f = findings(clean({
    missingSecrets: [{ name: 'RAZORPAY_LIVE_KEY_ID', why: 'No payment can be taken.', fix: 'Set it.' }],
  }));
  assert.equal(f[0].level, BLOCKER);
  assert.match(f[0].title, /RAZORPAY_LIVE_KEY_ID/);
});

// ---------------------------------------------------------------------------- shape

test('every finding carries a fix, not just a fault', () => {
  // On the 17th the person reading this is alone. "3 schools have no menu" without the command
  // is half an answer.
  const f = findings(clean({ assignments: [], breakTimes: [], platformConfig: { priceIsTaxInclusive: null } }));
  assert.ok(f.length >= 3);
  for (const item of f) {
    assert.ok(item.fix && item.fix.length > 10, `${item.title} has no usable fix`);
    assert.ok(item.detail && item.detail.length > 10, `${item.title} has no detail`);
  }
});

test('blockers rank above warnings', () => {
  const s = clean({ assignments: [] });
  s.schools[0].serviceDays = null;
  const order = ranked(findings(s)).map((f) => f.level);
  assert.equal(order[0], BLOCKER);
  assert.equal(order[order.length - 1], WARNING);
});

test('warnings alone do not make it unready', () => {
  // Exit 0 on warnings is what stops the check being ignored: a report that fails on things you
  // have decided to accept is a report you stop running.
  const s = clean();
  s.schools[0].serviceDays = null;
  assert.equal(summarise(findings(s)).ready, true);
});

test('a break window labelled with its own time range is a warning', () => {
  // P20 / E05-30: the picker shows the label with the times underneath, so this renders the time
  // twice. Production really is in this state — Amity's two windows are labelled "10:40AM -
  // 11:15AM" and "11:15AM - 11:40AM".
  const f = findings(clean({
    breakTimes: [{ schoolId: 's-1', label: '10:40AM - 11:15AM', isActive: true }],
  }));
  const label = f.find((x) => /labelled with its own time range/.test(x.title));
  assert.equal(label.level, WARNING);
  assert.deepEqual(label.names, ['10:40AM - 11:15AM']);
});

test('a friendly break label is not reported', () => {
  const f = findings(clean({ breakTimes: [{ schoolId: 's-1', label: 'Morning break', isActive: true }] }));
  assert.equal(f.filter((x) => /labelled/.test(x.title)).length, 0);
});

test('a label that merely mentions a time is not reported', () => {
  // "Lunch 12:30" is a fine label. The rule targets a label that IS a range, not one containing
  // a number — over-matching here would send somebody to rename labels that are already good.
  const f = findings(clean({ breakTimes: [{ schoolId: 's-1', label: 'Lunch 12:30', isActive: true }] }));
  assert.equal(f.filter((x) => /labelled/.test(x.title)).length, 0);
});

// -------------------------------------------------------------------- the allergen vocabulary

test('an empty allergen table is a blocker, and it leads the report', () => {
  // Production had exactly this and nothing anywhere said so. It is first in the output because
  // it is the only finding that fails on a safety path *quietly* — every screen degrades to
  // "no allergens recorded", which is indistinguishable from a dish that has none.
  const found = findings(clean({ allergens: [] }));
  assert.equal(found[0].level, BLOCKER);
  assert.match(found[0].title, /no allergens exist/);
});

test('a healthy vocabulary reports nothing', () => {
  assert.equal(findings(clean()).length, 0);
});

test('a vocabulary that exists but is entirely deactivated still blocks', () => {
  // `is_active` false on every row reaches the same place by a different route, and an inactive
  // allergen cannot be attached to anything.
  const found = findings(clean({ allergens: [{ code: 'milk', isActive: false }] }));
  assert.match(found[0].title, /no allergens exist/);
});

test('a snapshot with no allergens key at all does not throw', () => {
  // Defensive: an older caller, or a partial snapshot in a test, must not crash the whole report.
  assert.doesNotThrow(() => findings({ ...clean(), allergens: undefined }));
});

// ------------------------------------------------------------------ allergen tagging (`E10-33`)

test('a dish neither tagged nor declared is a blocker while it is on a menu', () => {
  // `MI1`'s third state. It looks identical to "contains none" on a menu, and the absence reads as
  // reassurance — which is why it is a blocker rather than a note, exactly like `food_type`.
  const found = findings(clean({ dishAllergens: [], declaredNone: [] }));
  const f = found.find((x) => /nobody has checked/.test(x.title));
  assert.ok(f, 'expected an allergen-checking finding');
  assert.equal(f.level, BLOCKER);
});

test('a tagged dish is not reported', () => {
  assert.equal(findings(clean({ dishAllergens: [{ dishId: 'd-1' }], declaredNone: [] })).length, 0);
});

test('a dish explicitly declared to contain none is not reported either', () => {
  // The whole point of `allergens_declared_none`: "we checked, there are none" is a finished dish.
  assert.equal(findings(clean({ dishAllergens: [], declaredNone: ['d-1'] })).length, 0);
});

test('with no allergen vocabulary at all, only the vocabulary is reported', () => {
  // Otherwise the report says "tag your dishes" while tagging is impossible, which sends somebody
  // to a screen that cannot help them.
  const found = findings(clean({ allergens: [], dishAllergens: [], declaredNone: [] }));
  assert.equal(found.filter((f) => /nobody has checked/.test(f.title)).length, 0);
  assert.match(found[0].title, /no allergens exist/);
});

// --------------------------------------------------- the label contradicting the ingredients

test('a dish marked veg whose ingredients name egg is a blocker', () => {
  // The error an unmarked-dish check cannot see: the dish IS marked, the count is complete, and
  // the report is otherwise green. Six production dishes were in this state, including
  // "Boiled Eggs (3 pcs)" with ingredients "Eggs, salt".
  const found = findings(clean({
    dishes: [{ id: 'd-1', name: 'Boiled Eggs (3 pcs)', foodType: 'veg', isActive: true,
               ingredientsText: 'Eggs, salt', description: null }],
  }));
  const f = found.find((x) => /ingredients say otherwise/.test(x.title));
  assert.ok(f, 'expected a contradiction finding');
  assert.equal(f.level, BLOCKER);
  assert.match(f.names[0], /Boiled Eggs/);
});

test('a correctly marked egg dish is not reported', () => {
  assert.equal(findings(clean({
    dishes: [{ id: 'd-1', name: 'Boiled Eggs', foodType: 'egg', isActive: true,
               ingredientsText: 'Eggs, salt', description: null }],
  })).filter((f) => /ingredients say otherwise/.test(f.title)).length, 0);
});

test('a low-confidence disagreement is NOT reported', () => {
  // Mayonnaise is the caveated case: the classifier proposes veg but says to ask. Reporting it
  // here would put a judgement call in a list of factual contradictions, and a blocker list with
  // arguable entries stops being read.
  assert.equal(findings(clean({
    dishes: [{ id: 'd-1', name: 'Veg Sandwich', foodType: 'veg', isActive: true,
               ingredientsText: 'Capsicum, Corn, Mayo', description: null }],
  })).filter((f) => /ingredients say otherwise/.test(f.title)).length, 0);
});

test('over-caution is not a blocker', () => {
  // A dish marked `egg` whose list reads vegetarian is the safe direction. Only the misleading
  // one is reported.
  assert.equal(findings(clean({
    dishes: [{ id: 'd-1', name: 'Fruit Bowl', foodType: 'egg', isActive: true,
               ingredientsText: 'Seasonal fruit', description: null }],
  })).filter((f) => /ingredients say otherwise/.test(f.title)).length, 0);
});
