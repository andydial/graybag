#!/usr/bin/env node
// What is production missing before it can take a real order? — `E17-52`.
//
//     set -a; . ~/.graybag-secrets/prod.env; set +a
//     npm run check:launch
//
// One command, plain output, no flags to remember on the morning it matters. Reads only — it
// never writes anything and never needs to.
//
// Exit 0 when there are no blockers (warnings do not fail it), 1 when there are, 2 when it could
// not look.
//
// ## Which environment it reads
//
// Whichever `prod.env` or `.secrets.staging.env` you sourced. It prints the project ref it is
// talking to before anything else, because the one way to misread this report is to run it
// against staging and believe it about production.
//
// The decisions are in `scripts/lib/launch-checks.mjs` and are unit-tested against object
// literals; this file fetches and prints.

import { createClient } from '@supabase/supabase-js';

import { BLOCKER, findings, ranked, summarise } from './lib/launch-checks.mjs';

const env = process.env;

// `prod.env` names things `SUPABASE_PROD_*`; the staging file uses the bare names. Accepting both
// is not sloppiness — it is what stops somebody exporting the wrong pair by hand and getting a
// clean report about the wrong database.
const URL = env.SUPABASE_PROD_URL ?? env.SUPABASE_URL;
const KEY = env.SUPABASE_PROD_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error(
    'No Supabase credentials in the environment.\n\n' +
      '  set -a; . ~/.graybag-secrets/prod.env; set +a     # production\n' +
      '  set -a; . ./.secrets.staging.env; set +a          # staging\n',
  );
  process.exit(2);
}

const db = createClient(URL, KEY, { auth: { persistSession: false } });

const rows = async (query, what) => {
  const { data, error } = await query;
  if (error) throw new Error(`reading ${what}: ${error.message}`);
  return data ?? [];
};

const today = new Date().toISOString().slice(0, 10);

let snapshot;
try {
  const [schools, configs, dishes, menus, menuItems, assignments, breakTimes, platform] =
    await Promise.all([
      rows(db.from('school').select('id,code,name,is_active,onboarded_at'), 'schools'),
      rows(db.from('school_config').select('school_id,service_days'), 'school config'),
      rows(db.from('dish').select('id,name,food_type,is_active'), 'dishes'),
      rows(db.from('menu').select('id,name,status'), 'menus'),
      rows(db.from('menu_item').select('menu_id,dish_id,is_active'), 'menu items'),
      rows(db.from('menu_assignment').select('school_id,menu_id,valid_from,valid_to,revoked_at'), 'assignments'),
      rows(db.from('break_time').select('school_id,label,is_active'), 'break times'),
      rows(db.from('platform_config').select('price_is_tax_inclusive').eq('id', 1), 'platform config'),
    ]);

  const serviceDaysBySchool = new Map(configs.map((c) => [c.school_id, c.service_days ?? null]));

  snapshot = {
    schools: schools.map((x) => ({
      id: x.id,
      code: x.code,
      name: x.name,
      isActive: x.is_active !== false,
      onboardedAt: x.onboarded_at ?? null,
      serviceDays: serviceDaysBySchool.get(x.id) ?? null,
    })),
    dishes: dishes.map((d) => ({
      id: d.id, name: d.name, foodType: d.food_type ?? null, isActive: d.is_active !== false,
    })),
    menus: menus.map((m) => ({ id: m.id, name: m.name, status: m.status })),
    menuItems: menuItems.map((i) => ({
      menuId: i.menu_id, dishId: i.dish_id, isActive: i.is_active !== false,
    })),
    // "Live" means: not revoked, started, and not yet ended. `valid_to` is EXCLUSIVE.
    assignments: assignments.map((a) => ({
      schoolId: a.school_id,
      menuId: a.menu_id,
      isLive:
        a.revoked_at === null &&
        a.valid_from <= today &&
        (a.valid_to === null || a.valid_to > today),
    })),
    breakTimes: breakTimes.map((b) => ({
      schoolId: b.school_id, label: b.label ?? '', isActive: b.is_active !== false,
    })),
    platformConfig: { priceIsTaxInclusive: platform[0]?.price_is_tax_inclusive ?? null },
    missingSecrets: [],
  };
} catch (cause) {
  console.error(cause.message);
  process.exit(2);
}

// Secrets are checked from the environment rather than the database — they are not in it, and a
// launch report that silently omitted them would be the most misleading kind of green.
for (const [name, why, fix] of [
  ['RAZORPAY_LIVE_KEY_ID', 'No payment can be taken without it.', 'It is in ~/.graybag-secrets/prod.env; set it as an Edge Function secret.'],
  ['RAZORPAY_WEBHOOK_SECRET', 'Captures would never be confirmed, so paid orders would sit unpaid.', 'Set it as an Edge Function secret and in the Razorpay dashboard.'],
  ['RESEND_API_KEY', 'No confirmation or invoice email would be sent.', 'Set it as an Edge Function secret.'],
]) {
  if (!env[name]) snapshot.missingSecrets.push({ name, why, fix });
}

// ---------------------------------------------------------------------------- print

// Named capture rather than a sparse-array fallback: `[, '?']` is a hole in an array literal,
// which `no-sparse-arrays` rightly refuses — it is indistinguishable from a typo.
const ref = URL.match(/https:\/\/(?<ref>[a-z0-9]+)\./)?.groups?.ref ?? '(unknown project)';
const results = ranked(findings(snapshot));
const { blockers, warnings, ready } = summarise(results);

console.log('');
console.log(`GrayBag launch check — project ${ref}`);
console.log(`${snapshot.schools.length} schools · ${snapshot.dishes.length} dishes · ` +
  `${snapshot.menus.length} menus · ${snapshot.menuItems.length} menu items`);
console.log('');

if (results.length === 0) {
  console.log('Nothing is missing. This environment can take an order.');
  process.exit(0);
}

for (const f of results) {
  console.log(`${f.level === BLOCKER ? 'BLOCKER' : 'warning'}  ${f.title}`);
  console.log(`         ${f.detail}`);
  if (f.names.length > 0) {
    console.log(`         ${f.names.join(', ')}${f.more > 0 ? ` … and ${f.more} more` : ''}`);
  }
  console.log(`         FIX: ${f.fix}`);
  console.log('');
}

console.log(
  ready
    ? `No blockers. ${warnings} warning(s) — read them, then this environment can take an order.`
    : `${blockers} blocker(s) and ${warnings} warning(s). A parent cannot order until the blockers are cleared.`,
);
process.exit(ready ? 0 : 1);
