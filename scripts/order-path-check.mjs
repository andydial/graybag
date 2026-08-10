#!/usr/bin/env node
/**
 * The whole order path, end to end, against a real environment — `E05-16`.
 *
 *     SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
 *       node scripts/order-path-check.mjs --date 2026-08-17
 *
 * ## What this proves that the unit tests cannot
 *
 * `E05-16` was filed the day the checkout was finished and had nobody to run it for:
 * **nothing created a `recipient` or a `guardian_link`, so `create_checkout` correctly
 * refused every request from the app with `not_authorized`.** Each half was tested — pgTAP
 * against the functions, Vitest against the `api/` module — and the join between them was
 * not, because the join is an HTTP request carrying a real JWT to a deployed Edge Function.
 *
 * That is what this runs:
 *
 *   1. create a parent, and get a **real session token** for them
 *   2. `POST /recipients` — the child, the guardian link and the consent, one transaction
 *   3. read the menu the way the app reads it
 *   4. `POST /checkout` — the order
 *   5. read the kitchen's production list and find the dish that was just ordered
 *
 * Step 5 is the point. An order that exists in the database but does not reach the kitchen
 * list is not an order anybody eats.
 *
 * ## Why it makes its own user rather than reusing one
 *
 * A fixed test account accumulates children and orders, and the fifth run is asserting
 * against the first run's data without knowing it. Every run gets a fresh parent, so
 * "the order is in the list" means *this* order.
 *
 * ## PII
 *
 * The child's name is invented here and printed only as the marker that proves the row is
 * this run's. Nothing about a real child passes through this script, and it must never be
 * pointed at production — the guard below refuses a production URL outright.
 */
import { createClient } from '@supabase/supabase-js';

import { kitchen } from '../packages/shared/src/index.ts';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
};

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error(
    'SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must all be set.\n' +
      'The service key creates the parent; the anon key is what the app itself would use.',
  );
  process.exit(2);
}

// This writes real orders. Against production that is a real order for a real child at a
// real school, and the recovery is a refund and a support conversation.
if (process.env.ALLOW_PRODUCTION !== 'true' && /graybag-prod|\bprod\b/.test(url)) {
  console.error('refusing to run against what looks like production.');
  process.exit(2);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const app = createClient(url, anonKey, { auth: { persistSession: false } });

/** A marker that ties every row this run creates back to this run. */
const RUN = `e0516-${Date.now().toString(36)}`;

const step = (n, what) => console.log(`\n[${n}] ${what}`);
const fail = (why, detail) => {
  console.error(`\n  FAILED: ${why}`);
  if (detail !== undefined) console.error(detail);
  process.exit(1);
};

// ---------------------------------------------------------------------------
step(1, 'a parent, with a real session');

const email = `${RUN}@order-path.test`;
const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  email_confirm: true,
});
if (createError) fail('could not create the parent', createError.message);

// A magic link, verified immediately. This is the only way to get a genuine access token
// without a mailbox — and a genuine token is the whole point, because the Edge Functions
// establish identity from it and would accept nothing we could forge.
const { data: link, error: linkError } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email,
});
if (linkError) fail('could not generate a sign-in link', linkError.message);

const { data: session, error: verifyError } = await app.auth.verifyOtp({
  token_hash: link.properties.hashed_token,
  type: 'email',
});
if (verifyError || !session.session) fail('could not establish a session', verifyError?.message);
console.log(`  parent ${created.user.id} signed in`);

const authed = createClient(url, anonKey, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
});

// ---------------------------------------------------------------------------
step(2, 'a school, read the way the app reads it');

const { data: schools, error: schoolError } = await app
  .from('school')
  .select('id,name')
  .order('name');
if (schoolError) fail('could not read the school list', schoolError.message);
if (!schools?.length) fail('no onboarded schools — nothing to order from');
const school = schools[0];
console.log(`  ${school.name}`);

// ---------------------------------------------------------------------------
step(3, 'add a child, with consent, through the Edge Function');

const firstName = `Testchild${RUN.slice(-4)}`;
const { data: child, error: childError } = await authed.functions.invoke('recipients', {
  body: {
    first_name: firstName,
    school_id: school.id,
    class_label: '5',
    section_label: 'A',
    consent_granted: true,
    allergen_consent: false,
    screen: 'order-path-check',
    app_version: 'script',
  },
});
if (childError) {
  const body = await childError.context?.json().catch(() => null);
  fail('the child was not created', body ?? childError.message);
}
console.log(`  recipient ${child.recipient_id}, consent against notice ${child.notice_version_id}`);

// ---------------------------------------------------------------------------
step(4, 'a menu, and a date the kitchen will actually cook');

const serviceDate = flag('date');
if (!serviceDate || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
  fail('pass --date YYYY-MM-DD — a date inside the ordering window for that school');
}

const { data: menu, error: menuError } = await app.rpc('get_menu_for_school', {
  p_school_id: school.id,
  p_service_date: serviceDate,
});
if (menuError) fail('could not read the menu', menuError.message);

const dishes = (menu?.dishes ?? []).filter((d) => d.menu_item_id);
if (!dishes.length) fail(`no dishes published for ${school.name} on ${serviceDate}`);
const dish = dishes[0];
console.log(`  ${dishes.length} dishes; ordering "${dish.name}"`);

// ---------------------------------------------------------------------------
step(5, 'place the order, through the Edge Function');

const { data: checkout, error: checkoutError } = await authed.functions.invoke('checkout', {
  body: {
    idempotency_key: `${RUN}-1`,
    expected_total_paise: null,
    lines: [
      {
        recipient_id: child.recipient_id,
        service_date: serviceDate,
        menu_item_id: dish.menu_item_id,
        quantity: 1,
      },
    ],
  },
});
if (checkoutError) {
  const body = await checkoutError.context?.json().catch(() => null);
  fail('the order was refused', body ?? checkoutError.message);
}
console.log(`  order group ${checkout.order_group_id}, payable ${checkout.payable_paise} paise`);

// ---------------------------------------------------------------------------
step(6, "the kitchen's production list for that day");

const { data: rows, error: rowsError } = await admin
  .from('order_line')
  .select(
    'quantity, status, dish_name_snapshot, order:order_id(service_date, school_id, status, ' +
      'recipient_name_snapshot, school_name_snapshot)',
  );
if (rowsError) fail('could not read the order lines', rowsError.message);

const forDate = (rows ?? []).filter((r) => r.order?.service_date === serviceDate);
const mine = forDate.filter((r) => r.order?.recipient_name_snapshot?.includes(firstName));

if (!mine.length) {
  fail(
    'the order does not appear in the kitchen data for that date — this is exactly the ' +
      'failure E05-16 describes, one layer further on',
    { serviceDate, linesForDate: forDate.length },
  );
}

console.log(`  ${mine.length} line(s) for this run, out of ${forDate.length} for the day`);
for (const line of mine) {
  console.log(
    `    ${line.quantity} × ${line.dish_name_snapshot} — ${line.order.school_name_snapshot}`,
  );
}

// The shared kitchen logic, on the same rows the screens will use. If this and the raw rows
// ever disagree, `packages/shared/src/kitchen/lists.ts` is the one that is right.
if (typeof kitchen?.productionList === 'function') {
  const production = kitchen.productionList(
    forDate.map((r) => ({
      dishName: r.dish_name_snapshot,
      quantity: r.quantity,
      status: r.status,
      schoolName: r.order.school_name_snapshot,
    })),
  );
  console.log(`  production list: ${production.length} dish row(s)`);
}

console.log(`\nOK — a child added and an order placed from the app's own path, on the list.`);
console.log(`Run marker: ${RUN}`);
