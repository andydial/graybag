#!/usr/bin/env node
/**
 * The kitchen's 7am lists, from the terminal — `E09-01`, `E09-02`, `E09-03`, `E09-11a`.
 *
 *     npm run kitchen -- --date 2026-08-13
 *     npm run kitchen -- --date 2026-08-13 --csv production > production.csv
 *
 * ## Why a script and not a screen
 *
 * `E09`'s screens belong in `apps/web`, which is currently one `index.ts` — a stub. A web
 * app is not something to start and half-finish inside a three-hour run, and a kitchen
 * cannot use half of one.
 *
 * This is not a stand-in for the screens; it is the thing `E09-11a` asks for in its own
 * right: **the kitchen must be able to work at 7am even if the app or their network is
 * down.** A terminal command against the database, and a CSV that opens in Excel, is
 * exactly that path. The screens still need building, and `E09-04`/`E09-05` are still open.
 *
 * ## Where the logic lives
 *
 * All of it is in `packages/shared/src/kitchen/lists.ts` and unit-tested there against
 * fixtures. This file fetches rows and prints them. If the two ever disagree, this one is
 * wrong.
 *
 * ## PII
 *
 * The packing list names children, because staff hand food to a named child. It is printed
 * only when asked for, it is never logged, and the CSV carries a warning in its first row.
 * See `E09-14` for the retention question, which is Andy's.
 */
import { createClient } from '@supabase/supabase-js';

import { kitchen } from '../packages/shared/src/index.ts';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
};

const serviceDate = flag('date');
const csvKind = flag('csv');

if (!serviceDate || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
  console.error('usage: npm run kitchen -- --date YYYY-MM-DD [--csv production|per-school|packing]');
  process.exit(2);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n' +
      'This reads orders, which is tier-P data — it needs the service role and must never\n' +
      'be run with credentials that live in a client bundle.',
  );
  process.exit(2);
}

const supabase = createClient(url, key);

// Only orders that are actually going to be made. A pending_payment order is a cart
// somebody has not paid for, and cooking against one is exactly what L5 forbids.
const COOKABLE = ['paid', 'preparing'];

const { data, error } = await supabase
  .from('order')
  .select(
    'id, school_id, school_name_snapshot, break_time_id, break_label_snapshot, ' +
      'recipient_name_snapshot, class_label_snapshot, section_label_snapshot, pickup_code, ' +
      'status, order_line(dish_id, dish_name_snapshot, quantity)',
  )
  .eq('service_date', serviceDate)
  .in('status', COOKABLE);

if (error) {
  console.error(`Could not read orders: ${error.message}`);
  process.exit(1);
}

/** Flatten to the shape the domain expects. One entry per order line. */
const lines = (data ?? []).flatMap((order) =>
  (order.order_line ?? []).map((line) => ({
    orderId: order.id,
    schoolId: order.school_id,
    schoolName: order.school_name_snapshot,
    breakId: order.break_time_id,
    breakLabel: order.break_label_snapshot,
    dishId: line.dish_id,
    dishName: line.dish_name_snapshot,
    quantity: line.quantity,
    recipientName: order.recipient_name_snapshot,
    classLabel: order.class_label_snapshot,
    sectionLabel: order.section_label_snapshot,
    pickupCode: order.pickup_code,
  })),
);

if (csvKind) {
  const render = {
    production: kitchen.productionCsv,
    'per-school': kitchen.perSchoolCsv,
    packing: kitchen.packingCsv,
  }[csvKind];
  if (!render) {
    console.error(`--csv must be production, per-school or packing`);
    process.exit(2);
  }
  process.stdout.write(render(lines));
  process.exit(0);
}

if (lines.length === 0) {
  console.log(`No paid orders for ${serviceDate}.`);
  console.log(
    'If you expected some: an order sits at pending_payment until it is paid for, and\n' +
      'this list deliberately shows only what is going to be cooked (L5).',
  );
  process.exit(0);
}

console.log(`\n═══ PRODUCTION — ${serviceDate} ═══`);
for (const dish of kitchen.productionTotals(lines)) {
  console.log(`  ${String(dish.quantity).padStart(4)} × ${dish.dishName}`);
}

console.log(`\n═══ PER SCHOOL ═══`);
for (const school of kitchen.perSchoolTotals(lines)) {
  console.log(`\n  ${school.schoolName}  (${school.totalItems} items)`);
  for (const dish of school.dishes) {
    console.log(`    ${String(dish.quantity).padStart(4)} × ${dish.dishName}`);
  }
}

console.log(`\n═══ PACKING — contains children's names ═══`);
for (const group of kitchen.packingList(lines)) {
  const where = [group.schoolName, group.breakLabel, group.classLabel, group.sectionLabel]
    .filter(Boolean)
    .join(' · ');
  console.log(`\n  ${where}`);
  for (const entry of group.entries) {
    const dishes = entry.dishes.map((d) => `${d.quantity} × ${d.dishName}`).join(', ');
    const code = entry.pickupCode ? ` [${entry.pickupCode}]` : '';
    console.log(`    ${entry.recipientName}${code}: ${dishes}`);
  }
}
console.log('');
