import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateBreakTimes, validateDishes, validateMenuItems, validateSchools,
} from '../src/validate.mjs';

const row = (o) => ({ __row: 2, ...o });

const school = (o = {}) =>
  row({ code: 'amity', name: 'Amity International', city_code: 'mohali', kitchen_code: 'k1', ...o });

const dish = (o = {}) =>
  row({ name: 'Veg Sandwich', kitchen_code: 'k1', category: 'quick_bites', ...o });

const menuItem = (o = {}) =>
  row({ menu_code: 'term1', dish_name: 'Veg Sandwich', kitchen_code: 'k1', price_paise: '4500', ...o });

const messages = (errors) => errors.map((e) => e.message).join(' | ');

// ---------------------------------------------------------------------------- schools

test('accepts a minimal school', () => {
  const { records, errors } = validateSchools([school()]);
  assert.equal(errors.length, 0);
  assert.equal(records[0].code, 'amity');
  assert.equal(records[0].institutionType, 'school');
});

test('lower-cases the code, because it is the re-run match key', () => {
  const { records } = validateSchools([school({ code: 'AMITY' })]);
  assert.equal(records[0].code, 'amity');
});

test('refuses a code with characters that would not survive a round trip', () => {
  const { errors } = validateSchools([school({ code: 'Amity School!' })]);
  assert.match(messages(errors), /matches this row to an existing record/);
});

test('refuses two rows sharing a code, naming the other row', () => {
  // The database would accept the first and reject the second with a constraint name, halfway
  // through a write.
  const { errors } = validateSchools([school(), { ...school(), __row: 3 }]);
  assert.match(messages(errors), /also used on row 2/);
});

test('reports a blank required field by name', () => {
  const { errors } = validateSchools([school({ name: '' })]);
  assert.match(messages(errors), /name is required and is blank/);
});

test('accepts weekday names as well as numbers, and normalises to ISO', () => {
  assert.deepEqual(validateSchools([school({ service_days: 'Mon,Tue,Wed' })]).records[0].serviceDays, [1, 2, 3]);
  assert.deepEqual(validateSchools([school({ service_days: '1,2,3' })]).records[0].serviceDays, [1, 2, 3]);
});

test('sorts and de-duplicates weekdays so two spellings cannot mean different things', () => {
  assert.deepEqual(validateSchools([school({ service_days: 'Fri,Mon,Mon' })]).records[0].serviceDays, [1, 5]);
});

test('calls out weekday 0 specifically, because it is Sunday in the other encoding', () => {
  const { errors } = validateSchools([school({ service_days: '0,1' })]);
  assert.match(messages(errors), /Monday as 1, so Sunday is 7/);
});

test('accepts a 24-hour cutoff and rejects a 12-hour one', () => {
  assert.equal(validateSchools([school({ order_cutoff_time: '13:30' })]).records[0].cutoffTime, '13:30:00');
  const { errors } = validateSchools([school({ order_cutoff_time: '1:30 PM' })]);
  assert.match(messages(errors), /1:30 PM is 13:30/);
});

test('midnight is accepted rather than read as blank', () => {
  // The platform default cutoff IS midnight. A falsy check on "00:00" would reject the one
  // value most likely to be written.
  assert.equal(validateSchools([school({ order_cutoff_time: '00:00' })]).records[0].cutoffTime, '00:00:00');
});

// ---------------------------------------------------------------------------- dishes

test('accepts a dish with no food type, because the source has no such column', () => {
  const { records, errors } = validateDishes([dish()]);
  assert.equal(errors.length, 0);
  assert.equal(records[0].foodType, null);
});

test('refuses an unrecognised food type rather than leaving it null', () => {
  const { errors } = validateDishes([dish({ food_type: 'vegetarian' })]);
  assert.match(messages(errors), /must be one of: veg, non_veg, egg/);
});

test('normalises food type spelling', () => {
  assert.equal(validateDishes([dish({ food_type: 'Non-Veg' })]).records[0].foodType, 'non_veg');
});

test('splits allergen codes and normalises them', () => {
  assert.deepEqual(
    validateDishes([dish({ allergens: 'milk; tree nut ,Peanut' })]).records[0].allergens,
    ['milk', 'tree_nut', 'peanut'],
  );
});

test('refuses two dishes with the same name at the same kitchen', () => {
  const { errors } = validateDishes([dish(), { ...dish(), __row: 3 }]);
  assert.match(messages(errors), /already appears on row 2/);
});

test('allows the same dish name at different kitchens', () => {
  const { errors } = validateDishes([dish(), { ...dish(), __row: 3, kitchen_code: 'k2' }]);
  assert.equal(errors.length, 0);
});

// ---------------------------------------------------------------------------- money

test('refuses a price written as rupees, and says what to write instead', () => {
  // The single most dangerous field in the file: accepting "45.00" as paise is a menu priced at
  // 45 paise, and accepting it as rupees is a guess about money.
  const { errors } = validateMenuItems([menuItem({ price_paise: '45.00' })]);
  assert.match(messages(errors), /₹45\.00 is 4500/);
});

test('refuses a price with a currency symbol or a thousands separator', () => {
  assert.match(messages(validateMenuItems([menuItem({ price_paise: '₹45' })]).errors), /no symbol and no separators/);
  assert.match(messages(validateMenuItems([menuItem({ price_paise: '4,500' })]).errors), /no symbol and no separators/);
});

test('accepts a zero price — a free item is a real thing', () => {
  const { records, errors } = validateMenuItems([menuItem({ price_paise: '0' })]);
  assert.equal(errors.length, 0);
  assert.equal(records[0].pricePaise, 0);
});

// ---------------------------------------------------------------------------- menu items

test('defaults available days to Monday-to-Saturday, matching the column default', () => {
  assert.deepEqual(validateMenuItems([menuItem()]).records[0].availableDays, [1, 2, 3, 4, 5, 6]);
});

test('refuses a date that is not YYYY-MM-DD', () => {
  const { errors } = validateMenuItems([menuItem({ valid_from: '17/08/2026' })]);
  assert.match(messages(errors), /2026-08-17 is not/);
});

test('refuses a date that does not exist', () => {
  assert.match(messages(validateMenuItems([menuItem({ valid_from: '2026-02-30' })]).errors), /not a real date/);
});

test('refuses valid_to on or before valid_from, and explains that valid_to is exclusive', () => {
  const { errors } = validateMenuItems([menuItem({ valid_from: '2026-08-17', valid_to: '2026-08-17' })]);
  assert.match(messages(errors), /valid_to is EXCLUSIVE/);
});

test('accepts an open-ended assignment', () => {
  const { errors } = validateMenuItems([menuItem({ valid_from: '2026-08-17', school_code: 'amity' })]);
  assert.equal(errors.length, 0);
});

test('refuses the same dish twice on one menu', () => {
  const { errors } = validateMenuItems([menuItem(), { ...menuItem(), __row: 3 }]);
  assert.match(messages(errors), /use available_days if it varies by day/);
});

test('a row with several problems reports all of them, not just the first', () => {
  // An import day is a loop of fix-and-rerun. Reporting one problem per row per run turns a
  // three-column mistake into three round trips.
  const { errors } = validateMenuItems([menuItem({ price_paise: 'free', valid_from: 'yesterday' })]);
  assert.ok(errors.length >= 2, `expected several errors, got ${errors.length}`);
});

// ---------------------------------------------------------------------------- break windows

const breakRow = (o = {}) =>
  row({ school_code: 'amity', label: 'Morning break', starts_at: '10:40', ends_at: '11:15', ...o });

test('accepts a break window and normalises the times', () => {
  const { records, errors } = validateBreakTimes([breakRow()]);
  assert.equal(errors.length, 0);
  assert.equal(records[0].startsAt, '10:40:00');
  assert.equal(records[0].endsAt, '11:15:00');
});

test('derives a code from the label when none is given', () => {
  // A template row. An operator typing "Morning break" should not also have to invent `break-1`.
  assert.equal(validateBreakTimes([breakRow()]).records[0].code, 'morning-break');
});

test('an explicit code WINS over the derived one', () => {
  // The round trip depends on this. Production stores `break-1` with the label
  // "10:40AM - 11:15AM"; deriving from that label matched nothing, so re-importing an untouched
  // export created duplicate windows.
  const { records } = validateBreakTimes([breakRow({ code: 'break-1', label: '10:40AM - 11:15AM' })]);
  assert.equal(records[0].code, 'break-1');
});

test('refuses a blank time rather than inventing one', () => {
  // The template ships with times blank on purpose. Copying another school's would publish a
  // time nobody agreed to — the same refusal `catalogue.sql` makes about the legacy option set.
  const { errors } = validateBreakTimes([breakRow({ starts_at: '', ends_at: '' })]);
  assert.equal(errors.length, 2);
  assert.match(messages(errors), /required and is blank/);
});

test('refuses a window that ends before it starts', () => {
  const { errors } = validateBreakTimes([breakRow({ starts_at: '11:15', ends_at: '10:40' })]);
  assert.match(messages(errors), /not a window/);
});

test('refuses two windows with the same name at one school', () => {
  const { errors } = validateBreakTimes([breakRow(), { ...breakRow(), __row: 3 }]);
  assert.match(messages(errors), /one window typed twice/);
});

test('allows the same window name at different schools', () => {
  const { errors } = validateBreakTimes([breakRow(), { ...breakRow(), __row: 3, school_code: 'gem' }]);
  assert.equal(errors.length, 0);
});
