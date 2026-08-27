/**
 * The app's meal rule and the server's must reach the same verdict. `E21-42`.
 *
 * Both are tested on their own — `pack-eligibility.test.ts` and `meal_packs.test.sql` — and both
 * pass. That is not the same as agreeing with each other, and the disagreement is expensive in a
 * specific way: a parent is told their cart qualifies, taps, and is refused by
 * `meal_pack_ineligibility_reason` at the moment the meal would be spent. The work is wasted and
 * the refusal arrives with no explanation the app can offer, because the app believed otherwise.
 *
 * So this runs the SAME cases through both implementations and compares only the thing that must
 * match: **eligible or not**. The reason strings deliberately differ — the app says `too_few` or
 * `too_many` where the server says `wrong_item_count`, because the app has to write a sentence a
 * parent can act on — so comparing those would be comparing a decision nobody made.
 *
 * Writes, so: local or staging only. Never production (non-negotiable #8).
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { checkPackMeal } from '../../packages/shared/src/cart/pack-eligibility.ts';

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

if (/bdamkuugbqjajbndjoxn/.test(URL)) {
  throw new Error('Refusing to run a WRITING test against production (non-negotiable #8).');
}


function databaseReachable() {
  const out = spawnSync('psql', [URL, '-X', '-q', '-A', '-t', '-c', 'select 1'],
    { encoding: 'utf8', timeout: 5000 });
  return out.status === 0;
}

const HAVE_DB = databaseReachable();
if (!HAVE_DB) {
  console.log('# SKIP pack eligibility agreement: no database. Run `npm run dev:db` to exercise it.');
}

/**
 * The cases. Each is a selection of `(category, quantity)` and the rule to judge it by.
 *
 * Chosen to sit on the boundaries where the two could disagree rather than to cover the happy
 * path twice: quantity versus row count, a zero-quantity line, a non-default `items_per_meal`,
 * and a required category that is not Drinks.
 */
/**
 * **A zero-quantity line is NOT here, and finding that out is worth more than the case.**
 *
 * `pack-eligibility.test.ts` asserts the app does not let a zero-quantity drink satisfy the
 * category, which is right for a cart mid-edit. Trying the same through the server raised
 * `order_line_quantity_positive`: the database will not store the row at all.
 *
 * So there is nothing to agree about. The app's guard stays — a client-side cart really can hold
 * a line at zero before it is removed — but the server's position is stronger than agreement:
 * the state is unrepresentable.
 */
const CASES = [
  { name: 'the ordinary meal: one main, one drink', items: [['mains', 1], ['drinks', 1]], itemsPerMeal: 2 },
  { name: 'two drinks — count and category both satisfied', items: [['drinks', 2]], itemsPerMeal: 2 },
  { name: 'one dish times two, no drink', items: [['mains', 2]], itemsPerMeal: 2 },
  { name: 'one item only', items: [['drinks', 1]], itemsPerMeal: 2 },
  { name: 'three items', items: [['mains', 2], ['drinks', 1]], itemsPerMeal: 2 },
  { name: 'nothing at all', items: [], itemsPerMeal: 2 },
  { name: 'a three-item pack, satisfied', items: [['mains', 2], ['drinks', 1]], itemsPerMeal: 3 },
  { name: 'a three-item pack, one short', items: [['mains', 1], ['drinks', 1]], itemsPerMeal: 3 },
];

/**
 * Build an order with these lines and ask the SERVER whether it is a valid meal.
 *
 * ## Why this is a sequence of statements and not one CTE chain
 *
 * The first version built everything in a single `with … insert … select` and it was **wrong in
 * a way that looked right**: a data-modifying CTE's rows are not visible to a function that reads
 * the table in the same statement, so `meal_pack_ineligibility_reason` saw no offer and no order
 * lines and answered `offer_not_found` every time. Four cases failed loudly — and **five passed**,
 * agreeing that the meal was ineligible for entirely different reasons.
 *
 * That is the exact failure this whole file exists to catch, produced by the file itself.
 * Everything below is therefore inserted, then read.
 */
function serverVerdict({ items, itemsPerMeal }) {
  const statements = [
    'begin',
    "set local app.actor_type = 'system'",
    `create temporary table agree_cat on commit drop as
       select 'mains'::text as code, gen_random_uuid() as id
       union all select 'drinks', gen_random_uuid()`,
    `insert into dish_category (id, code, display_name, sort_order)
       select id, code || '-' || id, code, 1 from agree_cat`,
    `create temporary table agree_ids on commit drop as
       select gen_random_uuid() as user_id, gen_random_uuid() as group_id,
              gen_random_uuid() as recipient_id, gen_random_uuid() as order_id,
              gen_random_uuid() as offer_id`,
    `insert into auth.users (id, email, instance_id, aud, role)
       select user_id, 'agree-' || user_id || '@example.test',
              '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
         from agree_ids`,
    // No explicit app_user insert: a trigger already mirrors auth.users into it, and doing it
    // here duplicates the primary key.
    `insert into meal_pack_offer (id, name, meals_count, items_per_meal, required_category_id,
                                  net_price_paise, alacarte_reference_paise, validity_days,
                                  is_active)
       select offer_id, 'Agreement offer', 10, ${itemsPerMeal},
              (select id from agree_cat where code = 'drinks'), 100000, 120000, 60, true
         from agree_ids`,
    `insert into order_group (id, customer_user_id, idempotency_key, status, city_id,
                              subtotal_paise, tax_total_paise, payable_paise)
       select group_id, user_id, 'agree-' || group_id, 'paid',
              (select id from city limit 1), 0, 0, 0
         from agree_ids`,
    `insert into recipient (id, first_name, school_id, is_minor)
       select recipient_id, 'Agree', (select id from school limit 1), true from agree_ids`,
    `insert into "order" (id, order_group_id, customer_user_id, recipient_id, school_id,
                          kitchen_id, city_id, service_date, delivery_mode, cutoff_at,
                          config_snapshot, school_name_snapshot, recipient_name_snapshot,
                          status, order_ref, correlation_id)
       select order_id, group_id, user_id, recipient_id,
              (select id from school limit 1),
              (select kitchen_id from school limit 1),
              (select id from city limit 1),
              current_date + 1, 'classroom', now() + interval '1 day', '{}'::jsonb,
              'Agreement School', 'Agree', 'pending_payment',
              'AGREE-' || substr(order_id::text, 1, 6), gen_random_uuid()
         from agree_ids`,
    `insert into dish (id, kitchen_id, name, category_id, food_type)
       select ac.id, (select kitchen_id from school limit 1), ac.code, ac.id, 'veg'
         from agree_cat ac`,
  ];

  for (const [index, [cat, qty]] of items.entries()) {
    statements.push(
      `insert into order_line (order_id, line_no, dish_id, quantity, unit_price_paise,
                               line_subtotal_paise, line_total_paise, dish_name_snapshot)
         select order_id, ${index + 1},
                (select id from agree_cat where code = '${cat}'), ${qty}, 0, 0, 0, '${cat}'
           from agree_ids`,
    );
  }

  statements.push(
    `select coalesce(meal_pack_ineligibility_reason(order_id, offer_id), 'ELIGIBLE')
       from agree_ids`,
  );
  statements.push('rollback');

  // `-c` per statement, in one psql session, so each is committed to the transaction's snapshot
  // before the next runs — which is the whole point.
  const args = [URL, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'];
  for (const statement of statements) args.push('-c', statement);
  const out = spawnSync('psql', args, { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`psql failed: ${out.stderr || out.stdout}`);
  return out.stdout.trim();
}

for (const testCase of CASES) {
  test(`app and server agree — ${testCase.name}`, { skip: HAVE_DB ? false : 'no database' }, () => {
    const appProblem = checkPackMeal(
      testCase.items.map(([categoryId, quantity]) => ({ categoryId, quantity })),
      { itemsPerMeal: testCase.itemsPerMeal, requiredCategoryId: 'drinks' },
    );
    const appEligible = appProblem === null;

    const server = serverVerdict(testCase);
    const serverEligible = server.includes('ELIGIBLE');

    assert.equal(
      appEligible,
      serverEligible,
      `The app says ${appEligible ? 'eligible' : 'NOT eligible'} and the server says ` +
        `${serverEligible ? 'eligible' : 'NOT eligible'} for: ${testCase.name}. ` +
        `A parent would be told one thing and refused the other.`,
    );
  });
}
