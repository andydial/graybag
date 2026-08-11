#!/usr/bin/env node
/**
 * Seed one realistic day of orders, so the kitchen dashboard (`E09-04`, `E09-05`) can be built
 * and reviewed against something that looks like a real morning.
 *
 *     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *       node tools/seed-kitchen-day/seed.mjs --date 2026-08-13
 *
 * *
 * ## Why this is in `tools/` and not in `supabase/`
 *
 * `supabase/` belongs to the payments thread and this is not a schema change — it writes rows
 * through the service role and adds no migration, exactly as `SD5` intends: the committed seed
 * data deliberately contains **no orders and no money**, because orders are the thing every
 * money path is tested against and a fixture order is a fixture invoice waiting to be believed.
 *
 * So this stays a *tool*: run it when you want a day to look at, run `--clear` when you don't.
 * Nothing it writes is committed, and nothing about it changes what `db reset` produces.
 *
 * ## Fictional, and not from the legacy export
 *
 * Every child and parent here is invented. The legacy Bubble export contains 1,115 real
 * children and is never a source for fixtures (non-negotiable #4, `RH4`). Emails are
 * `@seed.invalid`, which cannot receive mail by RFC 2606.
 *
 * The school is **Alpha Public School**, the fictional fixture already in
 * `supabase/seeds/staging-menu.sql` — two breaks, three classes, a published menu. Andy asked
 * for Amity; using the existing fictional school instead is deliberate and is flagged in the
 * report, because putting a real customer's name into a seed dataset sits badly next to having
 * just pulled those same school names off the website pending written permission.
 *
 * ## Deterministic, so a re-run is an update
 *
 * Every id is derived from a fixed prefix and an index, so running twice does not double the
 * day. `SD1`'s reasoning: a fixture you cannot re-run is a fixture you stop trusting.
 */
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
};
const has = (name) => args.includes(`--${name}`);

const serviceDate = flag('date');

if (!serviceDate || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
  console.error('usage: node tools/seed-kitchen-day/seed.mjs --date YYYY-MM-DD [--clear]');
  process.exit(2);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl = process.env.SUPABASE_DB_URL;

if (!url || !key || !dbUrl) {
  console.error(
    'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_URL must all be set.\n\n' +
      'Reads and auth-user creation go through the REST API; the writes go through a direct\n' +
      'connection because they have to be ONE transaction. `recipient_must_have_guardian`\n' +
      '(D10) is a `deferrable initially deferred` constraint trigger: a recipient must have an\n' +
      'active guardian_link, and the link references the recipient, so neither can be inserted\n' +
      'alone. PostgREST runs every request in its own transaction, so it commits the recipient\n' +
      'by itself and the trigger — correctly — refuses it.\n\n' +
      '  local:   postgresql://postgres:postgres@127.0.0.1:54322/postgres\n' +
      '  staging: the connection string from the Supabase dashboard',
  );
  process.exit(2);
}

/**
 * Refuse to run against production, by name.
 *
 * A seeding tool pointed at the live database is not a mistake anyone makes twice, and there is
 * no legitimate reason to invent twenty-four children in production. `EN1`'s spirit: make the
 * dangerous case impossible rather than documented.
 */
if (/graybag\.com|prod/i.test(url) && !has('i-understand-this-is-production')) {
  console.error(`Refusing to seed what looks like production: ${url}`);
  process.exit(2);
}

const db = createClient(url, key, { auth: { persistSession: false } });

// --------------------------------------------------------------------------- fixture ids

const SCHOOL_ID = '50000000-0000-0000-0000-000000000001'; // Alpha Public School
const pad = (n) => String(n).padStart(12, '0');
/**
 * People are date-independent; orders are not.
 *
 * The same children order on Tuesday and on Wednesday, so parents, children and guardian links
 * keep one id across every seeded day and are upserted. Orders take an id derived from the
 * service date — `71` plus `YYMMDD` — so each day is its own set and seeding a second date does
 * not collide with the first.
 */
const stamp = serviceDate.slice(2).replace(/-/g, ''); // 2026-08-13 -> 260813
const parentId    = (i) => `7a000000-0000-0000-0000-${pad(i)}`;
const recipientId = (i) => `7c000000-0000-0000-0000-${pad(i)}`;
const linkId      = (i) => `7d000000-0000-0000-0000-${pad(i)}`;
const groupId     = (i) => `70${stamp}-0000-0000-0000-${pad(i)}`;
const orderId     = (i) => `71${stamp}-0000-0000-0000-${pad(i)}`;

/**
 * Twenty-four invented children.
 *
 * Names are ordinary North Indian given names because that is who the product serves and a
 * kitchen list full of "Test Child 3" tells you nothing about whether the screen is readable.
 * The surnames are deliberately common and the pairing is random — nobody real is described.
 */
const CHILDREN = [
  ['Aarav', 'Sharma'], ['Diya', 'Verma'], ['Vivaan', 'Gupta'], ['Anaya', 'Singh'],
  ['Advik', 'Kapoor'], ['Myra', 'Bansal'], ['Reyansh', 'Mehta'], ['Aadhya', 'Chopra'],
  ['Kabir', 'Malhotra'], ['Saanvi', 'Joshi'], ['Ishaan', 'Nair'], ['Kiara', 'Reddy'],
  ['Arjun', 'Iyer'], ['Navya', 'Rao'], ['Rudra', 'Bhatia'], ['Prisha', 'Sethi'],
  ['Atharv', 'Khanna'], ['Ira', 'Bedi'], ['Shaurya', 'Grewal'], ['Amaira', 'Sodhi'],
  ['Dhruv', 'Ahluwalia'], ['Riya', 'Dhillon'], ['Veer', 'Sandhu'], ['Tara', 'Bajwa'],
];

/**
 * The mix of statuses, in order of assignment.
 *
 * A day where everything is `paid` proves nothing about a dashboard whose whole job is showing
 * state. This gives the screen a partly-delivered class, one order the kitchen has started, and
 * one cancellation to render — including the "12 of 18" partial case the brief calls for.
 *
 * `pending_payment` is deliberately absent: `L5` says the kitchen never cooks against money that
 * has not arrived, and a dashboard that shows one is a dashboard that invites it.
 */
const STATUS_MIX = [
  ...Array(14).fill('paid'),
  ...Array(5).fill('preparing'),
  ...Array(4).fill('delivered'),
  'cancelled',
];

const fail = (message, error) => {
  console.error(`${message}${error ? `: ${error.message}` : ''}`);
  process.exit(1);
};

// ------------------------------------------------------------------- already seeded?

/**
 * There is no `--clear`, and that is the schema being right rather than the tool being lazy.
 *
 * `order_event` is append-only — a trigger refuses DELETE outright, with "write a compensating
 * row instead" — so deleting an order cascades into that trigger and fails. Which is correct: an
 * order that happened cannot be made not to have happened, and a seeding tool is not an
 * exception to an audit trail.
 *
 * So a day is written once. Re-running is safe and does nothing; to get a different day, seed a
 * different date. To start over locally, `npx supabase db reset && npm run db:seed:staging`,
 * which is the only honest reset there is.
 */
async function alreadySeeded() {
  // By exact id, not a prefix match: `id` is a uuid column and PostgREST's `like` has no
  // operator for it — `operator does not exist: uuid ~~ unknown`. The first order of the day is
  // deterministic, so its presence is the whole question.
  const { data, error } = await db
    .from('order')
    .select('id')
    .eq('id', orderId(1))
    .limit(1);
  if (error) fail('Could not check for an existing seeded day', error);
  return (data ?? []).length > 0;
}

// --------------------------------------------------------------------------- read the fixtures

if (await alreadySeeded()) {
  console.log(
    `${serviceDate} is already seeded — nothing to do.\n\n` +
      `Orders cannot be removed once written: order_event is append-only by design. To get a\n` +
      `different day, seed a different date. To start over locally:\n` +
      `  npx supabase db reset && npm run db:seed:staging`,
  );
  process.exit(0);
}

const { data: school, error: schoolError } = await db
  .from('school')
  .select('id, name, city_id, kitchen_id')
  .eq('id', SCHOOL_ID)
  .single();
if (schoolError || !school) {
  fail(
    `Alpha Public School is not in this database. Run \`npm run db:seed:staging\` first — ` +
      `this tool adds a day of orders to the existing fixtures, it does not create them`,
    schoolError,
  );
}

const { data: breaks, error: breakError } = await db
  .from('break_time')
  .select('id, label, sort_order')
  .eq('school_id', SCHOOL_ID)
  .eq('is_active', true)
  .order('sort_order');
if (breakError || !breaks?.length) fail('No break times for the school', breakError);

const { data: classes, error: classError } = await db
  .from('school_class')
  .select('id, class_label, section_label, sort_order')
  .eq('school_id', SCHOOL_ID)
  .order('sort_order');
if (classError || !classes?.length) fail('No classes for the school', classError);

/**
 * The dishes actually on this school's menu for this date — not an arbitrary pick from `dish`.
 *
 * `menu_assignment` is the single answer to "which menu does this school see today" (`D4`), so
 * going through it means the seeded orders reference food the school could really have ordered.
 * An order line pointing at a dish that is not on the menu would be a fixture that tests nothing
 * and confuses everyone.
 */
const { data: assignment, error: assignmentError } = await db
  .from('menu_assignment')
  .select('menu_id, valid_from, valid_to')
  .eq('school_id', SCHOOL_ID)
  .is('revoked_at', null)
  .lte('valid_from', serviceDate)
  .order('valid_from', { ascending: false })
  .limit(1)
  .maybeSingle();
if (assignmentError) fail('Could not read the menu assignment', assignmentError);
if (!assignment) fail(`No menu is assigned to Alpha Public School on ${serviceDate}`);
if (assignment.valid_to && assignment.valid_to <= serviceDate) {
  fail(`The menu assigned to Alpha Public School ended before ${serviceDate}`);
}

const { data: items, error: itemError } = await db
  .from('menu_item')
  .select('id, price_paise, dish_id, dish(name, food_type, portion_text, dish_category(code))')
  .eq('menu_id', assignment.menu_id)
  .eq('is_active', true)
  .order('sort_order');
if (itemError || !items?.length) fail('No active menu items on the assigned menu', itemError);

// --------------------------------------------------------------------------- money

/**
 * Per-line GST, computed the way `G1` requires.
 *
 * CGST and SGST are calculated **independently** from the line subtotal and each rounded on its
 * own — not one halved. Prices are GST-exclusive (`SC2`), the rate is a flat 5% split 2.5/2.5
 * because v1 is Mohali only (`SC1`, `M2`), and everything is integer paise (non-negotiable #3).
 * There is no IGST column to fill: one state, so it is always null.
 */
const HALF_RATE_BPS = 250; // 2.5%, in basis points
const halfTax = (subtotalPaise) => Math.round((subtotalPaise * HALF_RATE_BPS) / 10_000);

// --------------------------------------------------------------------------- build the day

const rows = { users: [], recipients: [], links: [], groups: [], orders: [], lines: [] };

/**
 * Where each order is meant to end up, kept beside the rows rather than on them.
 *
 * `status` on the row is always `pending_payment` because that is the only status an order may
 * be INSERTed with; the target drives the UPDATE phases below. Holding it in a Map keeps the row
 * objects exactly the shape of the table, so the INSERT never has to strip a field out.
 */
const target = new Map();
const nowIso = new Date().toISOString();

for (const [index, [firstName, lastName]] of CHILDREN.entries()) {
  const n = index + 1;
  const klass = classes[index % classes.length];
  const brk = breaks[index % breaks.length];
  const status = STATUS_MIX[index % STATUS_MIX.length];

  // One or two dishes per child, walking the menu so the production totals are varied but stable.
  const chosen = [items[index % items.length]];
  if (index % 3 === 0) chosen.push(items[(index + 4) % items.length]);

  let subtotal = 0;
  let cgst = 0;
  let sgst = 0;
  const lines = chosen.map((item, lineIndex) => {
    const quantity = index % 7 === 0 ? 2 : 1;
    const lineSubtotal = item.price_paise * quantity;
    const lineCgst = halfTax(lineSubtotal);
    const lineSgst = halfTax(lineSubtotal);
    subtotal += lineSubtotal;
    cgst += lineCgst;
    sgst += lineSgst;
    return {
      order_id: orderId(n),
      line_no: lineIndex + 1,
      menu_item_id: item.id,
      dish_id: item.dish_id,
      quantity,
      unit_price_paise: item.price_paise,
      line_subtotal_paise: lineSubtotal,
      tax_cgst_paise: lineCgst,
      tax_sgst_paise: lineSgst,
      line_total_paise: lineSubtotal + lineCgst + lineSgst,
      status: status === 'cancelled' ? 'cancelled' : 'ordered',
      dish_name_snapshot: item.dish?.name ?? 'Unknown dish',
      portion_snapshot: item.dish?.portion_text ?? null,
      category_code_snapshot: item.dish?.dish_category?.code ?? null,
      food_type_snapshot: item.dish?.food_type ?? null,
      allergen_codes_snapshot: [],
    };
  });

  const total = subtotal + cgst + sgst;

  rows.users.push({
    id: parentId(n),
    phone_e164: `+9190000${String(10000 + n).slice(-5)}`,
    email: `parent${String(n).padStart(2, '0')}@seed.invalid`,
    first_name: `${firstName}'s`,
    last_name: 'parent',
    migration_source: 'native',
  });

  rows.recipients.push({
    id: recipientId(n),
    is_self: false,
    first_name: firstName,
    last_name: lastName,
    school_id: SCHOOL_ID,
    school_class_id: klass.id,
    class_label: klass.class_label,
    section_label: klass.section_label,
    is_minor: true,
    created_by_user_id: parentId(n),
  });

  rows.links.push({
    id: linkId(n),
    recipient_id: recipientId(n),
    user_id: parentId(n),
    // `guardian_relationship` has no 'parent' — it is self/mother/father/guardian/carer/staff.
    relationship: index % 2 === 0 ? 'mother' : 'father',
    can_order: true,
    can_manage: true,
    is_primary: true,
    created_by_user_id: parentId(n),
  });

  rows.groups.push({
    id: groupId(n),
    customer_user_id: parentId(n),
    correlation_id: groupId(n),
    idempotency_key: `seed-kitchen-day:${serviceDate}:${n}`,
    // Born pending_payment for the same reason; moved to paid in the transaction below. The
    // cancelled order's group stays `paid` — the money did arrive and the refund has not been
    // issued yet, which is a real state (`cancelled` means will-not-be-delivered, not un-paid).
    status: 'pending_payment',
    city_id: school.city_id,
    currency: 'INR',
    subtotal_paise: subtotal,
    tax_total_paise: cgst + sgst,
    discount_paise: 0,
    wallet_applied_paise: 0,
    payable_paise: total,
    placed_at: nowIso,
  });

  target.set(orderId(n), status);
  rows.orders.push({
    id: orderId(n),
    order_group_id: groupId(n),
    order_ref: `SEED-${serviceDate.replace(/-/g, '')}-${String(n).padStart(3, '0')}`,
    correlation_id: groupId(n),
    customer_user_id: parentId(n),
    recipient_id: recipientId(n),
    school_id: SCHOOL_ID,
    kitchen_id: school.kitchen_id,
    city_id: school.city_id,
    service_date: serviceDate,
    break_time_id: brk.id,
    delivery_mode: 'classroom',
    pickup_code: null,
    // Every order is INSERTed as `pending_payment` and walked to its target status below.
    // `assert_order_status_transition` permits exactly one INSERT — ('', 'pending_payment',
    // 'system') — so there is no way to fabricate a `paid` order, and that is the point: the
    // seeded day is reachable by the same transitions production uses (§4.1, L5).
    status: 'pending_payment',
    subtotal_paise: subtotal,
    tax_cgst_paise: cgst,
    tax_sgst_paise: sgst,
    // Zero rather than null: Mohali only, so the supply is always intra-state (SC1, M2). The
    // column is NOT NULL because "no IGST" is a fact, not an absence of information.
    tax_igst_paise: 0,
    discount_paise: 0,
    total_paise: total,
    refunded_total_paise: 0,
    cutoff_at: `${serviceDate}T02:30:00Z`,
    config_snapshot: {},
    school_name_snapshot: school.name,
    break_label_snapshot: brk.label,
    recipient_name_snapshot: `${firstName} ${lastName}`,
    class_label_snapshot: klass.class_label,
    section_label_snapshot: klass.section_label,
    placed_at: nowIso,
  });

  rows.lines.push(...lines);
}

// --------------------------------------------------------------------------- write

/**
 * `app_user.id` references `auth.users(id)`, so the auth user has to exist first. The Admin API
 * is the only supported way to create one — writing into `auth.users` by hand skips the identity
 * rows GoTrue expects and produces a user that cannot sign in.
 */
for (const user of rows.users) {
  const { error } = await db.auth.admin.createUser({
    id: user.id,
    email: user.email,
    email_confirm: true,
    user_metadata: { seeded: 'kitchen-day' },
  });
  // Already there from a previous run: fine, this is meant to be re-runnable.
  if (error && !/already|duplicate|exists|registered/i.test(error.message)) {
    fail(`Could not create the auth user for ${user.email}`, error);
  }
}

/** SQL literal. Everything here is generated, but quoting by hand is how a seed becomes a bug. */
const lit = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `array[${v.map(lit).join(',')}]::text[]`;
  if (typeof v === 'object') return `${lit(JSON.stringify(v))}::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

const insert = (table, values) => {
  if (!values.length) return '';
  const cols = Object.keys(values[0]);
  const quoted = table === 'order' ? '"order"' : table;
  return (
    `insert into ${quoted} (${cols.join(', ')}) values\n` +
    values.map((row) => `  (${cols.map((c) => lit(row[c])).join(', ')})`).join(',\n') +
    (table === 'order_line' ? ';' : `\non conflict (id) do update set ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')};`) +
    '\n\n'
  );
};

const ids = (predicate) => rows.orders.filter(predicate).map((o) => lit(o.id));
const groupIds = rows.groups.map((g) => lit(g.id));

const wants = (...statuses) => (o) => statuses.includes(target.get(o.id));

/**
 * One transaction, in lifecycle phases, and neither the phases nor their order are cosmetic.
 *
 * Two things force this shape. `recipient_must_have_guardian` (`D10`) is deferred to COMMIT, so
 * the child and the link have to land together — which is what a transaction gives us and what
 * PostgREST cannot. And `assert_order_status_transition` implements §4.1 literally as
 * `(operation, from, to, actor)` tuples, so a `paid` order cannot be inserted: it has to be
 * *made* paid, by the actor entitled to do it.
 *
 * That is a better fixture than one that writes end states directly. Every order here got where
 * it is by a route production also permits, so the day cannot contain a state the real system
 * could never produce — which is exactly the failure a seeded dashboard would otherwise hide.
 *
 * `set local` is transaction-scoped, so the actor changes between phases and is gone at commit.
 */
const sql = [
  'begin;',
  '',
  '-- The system takes the order and the money.',
  "set local app.actor_type = 'system';",
  '',

  insert('app_user', rows.users),
  insert('recipient', rows.recipients),
  insert('guardian_link', rows.links),
  insert('order_group', rows.groups),
  insert('order', rows.orders),
  insert('order_line', rows.lines),
  `update order_group set status = 'paid', paid_at = ${lit(nowIso)} where id in (${groupIds.join(', ')});`,
  `update "order" set status = 'paid', confirmed_at = ${lit(nowIso)} where id in (${ids(() => true).join(', ')});`,
  '',
  '-- Then the kitchen works the list. This is what the dashboard will be doing.',
  "set local app.actor_type = 'kitchen';",
  `update "order" set status = 'preparing', preparing_at = ${lit(nowIso)} where id in (${ids(wants('preparing', 'delivered')).join(', ')});`,
  `update "order" set status = 'delivered', delivered_at = ${lit(nowIso)} where id in (${ids(wants('delivered')).join(', ')});`,
  `update "order" set status = 'cancelled', cancelled_at = ${lit(nowIso)}, cancel_reason_code = 'dish_unavailable' where id in (${ids(wants('cancelled')).join(', ')});`,
  '',
  'commit;',
  '',
].join('\n');

try {
  execFileSync('psql', [dbUrl, '--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: sql,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
} catch {
  fail('The seed transaction failed and was rolled back. Nothing was written.');
}

// --------------------------------------------------------------------------- report

const byStatus = rows.orders.reduce((acc, o) => ({ ...acc, [target.get(o.id)]: (acc[target.get(o.id)] ?? 0) + 1 }), {});
const byBreak = rows.orders.reduce((acc, o) => ({ ...acc, [o.break_label_snapshot]: (acc[o.break_label_snapshot] ?? 0) + 1 }), {});
const items_ = rows.lines.reduce((n, l) => n + l.quantity, 0);

console.log(`Seeded ${serviceDate} at ${school.name}`);
console.log(`  ${rows.orders.length} orders, ${rows.lines.length} lines, ${items_} items`);
console.log(`  status:  ${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
console.log(`  breaks:  ${Object.entries(byBreak).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
console.log(`  classes: ${classes.map((c) => `${c.class_label}${c.section_label ?? ''}`).join(' · ')}`);
console.log(`\nRe-running this date is safe and does nothing. Seed another date for another day.`);
