/**
 * Meal packs cannot be over-spent by a race. `E21-25`.
 *
 * Andy, 2026-08-26: *"Two devices confirming plans at the same moment must not spend the same meal
 * twice. Prove it with a concurrent test, not a comment."* And, approving the plan: *"The
 * 10-connections-against-3-meals test is the one that matters; a mechanism that happens to work
 * for two proves nothing."*
 *
 * ## Why this is not a pgTAP test
 *
 * pgTAP runs inside ONE transaction and rolls back, so it cannot observe two transactions racing —
 * the thing under test is invisible to it by construction. This spawns N genuinely separate `psql`
 * processes, which is also the repo's existing way of talking to Postgres (`grant-operator.mjs`),
 * so it needs no driver dependency that CI would have to grow.
 *
 * ## The barrier, and why the test is worthless without one
 *
 * Firing N queries in a loop does not produce contention: the first finishes before the last
 * starts, and the test passes without ever testing anything — a green result that proves nothing,
 * which is the failure mode this repo keeps meeting.
 *
 * So a **gate** process opens a transaction, takes an EXCLUSIVE `pg_advisory_xact_lock(K)` and
 * sleeps. Every racer asks for a SHARED lock on the same key and parks behind it. When the gate
 * commits, every racer acquires at once — shared locks are compatible with each other — and they
 * contend for the pack for real.
 *
 * **The shared/exclusive distinction is the whole barrier, and getting it wrong is silent.** The
 * first version of this test had the racers take the EXCLUSIVE lock too, which meant they queued
 * and ran strictly one at a time. Every assertion passed. It also passed with the concurrency
 * guard removed from the function, and again with the `meals_remaining >= 0` constraint dropped as
 * well — a test with nothing left to protect it, still green. Only mutating the code it claimed to
 * cover revealed that it had never produced contention at all.
 *
 * Writes, so: local or staging only. Never production (non-negotiable #8).
 */
import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const BARRIER = 918_273_645;

if (/bdamkuugbqjajbndjoxn/.test(URL)) {
  throw new Error('Refusing to run a WRITING test against production (non-negotiable #8).');
}

/**
 * Is a database actually reachable?
 *
 * `test:scripts` runs every file in this directory, and the 60-second smoke has no Postgres. A
 * test that cannot run must SKIP LOUDLY rather than fail the build or, worse, pass vacuously —
 * and the skip reason names what is missing, so "0 concurrency tests ran" is never mistaken for
 * "concurrency is proven".
 */
function databaseReachable() {
  const out = spawnSync('psql', [URL, '-X', '-q', '-A', '-t', '-c', 'select 1'],
    { encoding: 'utf8', timeout: 5000 });
  return out.status === 0;
}

const HAVE_DB = databaseReachable();
if (!HAVE_DB) {
  console.log(`# SKIP meal-pack concurrency: no database at ${URL.replace(/:[^:@]*@/, ':***@')}. ` +
    'Run `npm run dev:db` (or set DATABASE_URL to staging) to exercise these.');
}

/** One psql call, synchronously. Returns trimmed stdout; throws on a database error. */
function sql(query) {
  const out = spawnSync('psql', [URL, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query],
    { encoding: 'utf8' });
  if (out.error) throw new Error(`psql could not run: ${out.error.message}`);
  if (out.status !== 0) throw new Error(`psql failed: ${out.stderr || out.stdout}`);
  return out.stdout.trim();
}

/** A racer: parks on the barrier, then tries to spend. Resolves true if it committed. */
function racer(userId, take) {
  return new Promise((resolve) => {
    const child = spawn('psql', [URL, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c',
      `begin;
       select pg_advisory_xact_lock_shared(${BARRIER});
       select * from spend_meal_pack_meals('${userId}'::uuid, ${take});
       commit;`], { stdio: ['ignore', 'ignore', 'ignore'] });
    child.on('close', (code) => resolve(code === 0));
  });
}

/** Build a pack with exactly `meals` left, and everything it needs to exist. */
function seedPack(meals) {
  const row = sql(`
    with c as (select id from city limit 1),
         cat as (select id from dish_category limit 1),
         au as (insert into auth.users (id, email, instance_id, aud, role)
                values (gen_random_uuid(), 'e21-race-' || gen_random_uuid() || '@example.test',
                        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
                returning id),
         u as (insert into app_user (id, locale) select id, 'en-IN' from au returning id),
         o as (insert into meal_pack_offer
                 (name, meals_count, items_per_meal, required_category_id,
                  net_price_paise, alacarte_reference_paise, validity_days, is_active)
               select 'E21 race pack', ${meals}, 2, cat.id, 100000, 120000, 60, true
                 from cat returning id),
         og as (insert into order_group
                  (customer_user_id, idempotency_key, status, city_id,
                   subtotal_paise, tax_total_paise, payable_paise)
                -- Zero totals ON PURPOSE. assert_order_group_totals requires a group's totals to
                -- equal the sum of its member orders, and a pack purchase has no member food
                -- orders. That mismatch is a real design gap (E21-26) and NOT this test's
                -- subject; here the group exists only to satisfy the foreign key.
                select u.id, 'e21-race-' || gen_random_uuid(), 'paid', c.id, 0, 0, 0 from u, c
                returning id, customer_user_id)
    insert into meal_pack
      (customer_user_id, offer_id, order_group_id, meals_total, meals_remaining,
       net_price_paise, tax_total_paise, cgst_paise, sgst_paise, tax_point,
       expires_at, correlation_id)
    select og.customer_user_id, o.id, og.id, ${meals}, ${meals},
           100000, 5000, 2500, 2500, 'sale', now() + interval '60 days', gen_random_uuid()
      from og, o
    returning id || ' ' || customer_user_id`);
  const [packId, userId] = row.split(' ');
  return { packId, userId };
}

async function race({ meals, attempts, take }) {
  const { packId, userId } = seedPack(meals);

  // The gate holds the lock for 1.5s; every racer queues behind it and is released together.
  const gate = spawn('psql', [URL, '-X', '-q', '-A', '-t', '-c',
    `begin; select pg_advisory_xact_lock(${BARRIER}); select pg_sleep(1.5); commit;`],
    { stdio: ['ignore', 'ignore', 'ignore'] });

  // Give the gate time to actually take the lock before the racers ask for it. Without this a
  // racer can win the lock first and the barrier does nothing.
  await new Promise((r) => setTimeout(r, 400));

  const results = await Promise.all(
    Array.from({ length: attempts }, () => racer(userId, take)),
  );
  gate.kill();

  const after = sql(`select meals_remaining from meal_pack where id = '${packId}'::uuid`);
  return {
    succeeded: results.filter(Boolean).length,
    refused: results.filter((r) => !r).length,
    remaining: Number(after),
  };
}

test('two devices cannot spend the same last meal', { skip: HAVE_DB ? false : 'no database' }, async () => {
  const r = await race({ meals: 1, attempts: 2, take: 1 });
  assert.equal(r.succeeded, 1, 'exactly one device may take the last meal');
  assert.equal(r.refused, 1);
  assert.equal(r.remaining, 0, 'and the balance lands on zero, never below');
});

test('ten connections against a three-meal pack spend exactly three', { skip: HAVE_DB ? false : 'no database' }, async () => {
  // The test Andy singled out. Two callers can serialise by luck of timing; ten cannot.
  const r = await race({ meals: 3, attempts: 10, take: 1 });
  assert.equal(r.succeeded, 3, 'exactly three meals may be spent');
  assert.equal(r.refused, 7);
  assert.equal(r.remaining, 0);
});

test('a multi-meal plan is all or nothing under contention', { skip: HAVE_DB ? false : 'no database' }, async () => {
  // Four racers each want 2 meals from a 5-meal pack. Two fit; the rest must be refused
  // OUTRIGHT rather than partially served — a half-applied plan is worse than a refusal,
  // because the parent cannot see which half.
  const r = await race({ meals: 5, attempts: 4, take: 2 });
  assert.equal(r.succeeded, 2, 'two plans of two fit; a third would overdraw');
  assert.equal(r.remaining, 1, 'and the odd meal is left whole, not half-spent');
});

test('the balance never goes negative', { skip: HAVE_DB ? false : 'no database' }, async () => {
  const r = await race({ meals: 2, attempts: 8, take: 1 });
  assert.equal(r.succeeded, 2);
  assert.ok(r.remaining >= 0, 'meals_remaining must never be negative');
  assert.equal(r.remaining, 0);
});
