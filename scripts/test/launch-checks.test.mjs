import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BLOCKER, WARNING, findings, ranked, summarise } from '../lib/launch-checks.mjs';

/** A snapshot with nothing wrong. Each test breaks exactly one thing. */
const clean = (over = {}) => ({
  schools: [
    { id: 's-1', code: 'amity', name: 'Amity', isActive: true, onboardedAt: '2026-08-01', serviceDays: [1, 2, 3, 4, 5] },
  ],
  dishes: [{ id: 'd-1', name: 'Veg Sandwich', foodType: 'veg', isActive: true }],
  menus: [{ id: 'm-1', name: 'Term 1', status: 'active' }],
  menuItems: [{ menuId: 'm-1', dishId: 'd-1', isActive: true }],
  assignments: [{ schoolId: 's-1', menuId: 'm-1', isLive: true }],
  breakTimes: [{ schoolId: 's-1', isActive: true }],
  platformConfig: { priceIsTaxInclusive: false },
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
