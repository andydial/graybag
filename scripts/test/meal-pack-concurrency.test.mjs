/**
 * Meal pack items cannot be over-spent by a race. `E21-72`, rebuilt from `E21-25`.
 *
 * Andy, 2026-09-16: *"Two devices checking out simultaneously must not both succeed against the
 * same last item."* And, on the original: *"The 10-connections-against-3-meals test is the one
 * that matters; a mechanism that happens to work for two proves nothing."*
 *
 * ## What changed from the old file, and why it is the same test
 *
 * The old design raced `spend_meal_pack_meals()` — the decrement. The rebuild does not decrement
 * at checkout at all; it **reserves**, and the balance moves only when the payment webhook
 * confirms. So the contended statement moved, and this file follows it:
 *
 *     update meal_pack set items_reserved = items_reserved + n
 *      where id = ... and valued_remaining + bonus_remaining - items_reserved >= n
 *
 * **That is where the race actually is.** Two devices checking out at the same moment are both
 * at reserve; only one webhook can ever arrive for a given order group, so the confirm is never
 * contended. Racing the confirm would be testing a lock nobody contends for.
 *
 * The assertions are therefore about `items_reserved`, and there is one more of them than before:
 * after a race, `valued_remaining` must be **untouched**. That is the requirement Andy stated —
 * the parent's balance is not changed by a checkout that has not been paid for — and it is the
 * assertion that would fail if somebody "simplified" the reservation back into a decrement.
 *
 * ## Why this is not a pgTAP test
 *
 * pgTAP runs inside ONE transaction and rolls back, so it cannot observe two transactions racing —
 * the thing under test is invisible to it by construction. This spawns N genuinely separate `psql`
 * processes, which is also the repo's existing way of talking to Postgres, so it needs no driver
 * dependency that CI would have to grow.
 *
 * ## The barrier, and why the test is worthless without one
 *
 * Firing N queries in a loop does not produce contention: the first finishes before the last
 * starts, and the test passes without ever testing anything.
 *
 * So a **gate** process opens a transaction, takes an EXCLUSIVE `pg_advisory_xact_lock(K)` and
 * sleeps. Every racer asks for a SHARED lock on the same key and parks behind it. When the gate
 * commits, every racer acquires at once — shared locks are compatible with each other — and they
 * contend for the pack for real.
 *
 * **The shared/exclusive distinction is the whole barrier, and getting it wrong is silent.** The
 * first version of the original had the racers take the EXCLUSIVE lock too, so they queued and ran
 * strictly one at a time. Every assertion passed. It also passed with the concurrency guard
 * removed, and again with the `>= 0` constraint dropped as well — a test with nothing left to
 * protect it, still green. Only mutating the code it claimed to cover revealed it had never
 * produced contention at all. That lesson is why this file is adapted rather than rewritten.
 *
 * Writes, so: local or staging only. Never production (non-negotiable #8).
 */
import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const BARRIER = 918_273_646;

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

/**
 * A racer: parks on the barrier, then tries to RESERVE. Resolves `took`, `refused` or `aborted`.
 *
 * The statement is the one from `reserve_meal_pack_items`, verbatim rather than through the
 * function, because the function walks a whole order group and this test is about the single
 * contended write.
 *
 * ## Three outcomes, not two, and the third is the whole point
 *
 * A first version resolved a boolean and **passed with the guard removed**, which is this file's
 * own header warning coming true a second time. The reason: `meal_pack_reserved_within_balance`
 * is a CHECK constraint, so an over-reservation cannot commit either way. Take the guard out and
 * the same number of racers succeed — the excess are killed by the constraint instead of the
 * WHERE clause, and a boolean cannot tell those apart.
 *
 * They are completely different events. A `refused` racer updated zero rows and its transaction
 * is fine: inside `reserve_meal_pack_items` that means "this pack is full, try the next one" and
 * the parent pays cash for the rest. An `aborted` racer hit the constraint, which **rolls back
 * the whole checkout** — every order, every line, for a parent who did nothing wrong.
 *
 * So the constraint is a backstop and the WHERE clause is the mechanism, exactly as `0085` says,
 * and `aborted === 0` is the assertion that holds the difference. `23514` is check_violation;
 * `P0001` raised below is the clean zero-rows path.
 */
function racer(packId, take) {
  return new Promise((resolve) => {
    let stderr = '';
    const child = spawn('psql', [URL, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c',
      `begin;
       select pg_advisory_xact_lock_shared(${BARRIER});
       do $$
       declare v_left int;
       begin
         update meal_pack
            set items_reserved = items_reserved + ${take}
          where id = '${packId}'::uuid
            and status = 'active'
            and expires_at > now()
            and valued_remaining + bonus_remaining - items_reserved >= ${take}
         returning valued_remaining + bonus_remaining - items_reserved into v_left;
         if not found then
           raise exception 'refused' using errcode = 'P0001';
         end if;
       end $$;
       commit;`], { stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      if (code === 0) return resolve('took');
      if (/refused/.test(stderr)) return resolve('refused');
      return resolve('aborted');
    });
  });
}

/** Build an active pack with exactly `items` spendable, and everything it needs to exist. */
function seedPack(items) {
  const row = sql(`
    with c as (select id from city limit 1),
         s as (select id from school where is_active limit 1),
         au as (insert into auth.users (id, email, instance_id, aud, role)
                values (gen_random_uuid(), 'e21-race-' || gen_random_uuid() || '@example.test',
                        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
                returning id),
         u as (insert into app_user (id, locale) select id, 'en-IN' from au returning id),
         o as (insert into meal_pack_offer
                 (name, net_price_paise, items_count, bonus_items_count, bonus_window_days,
                  validity_days, is_active)
               values ('E21 race pack', 100000, ${items}, 0, 0, 60, true)
               returning id),
         -- A real pack purchase group: kind = meal_pack_purchase, totals equal the pack's, and no
         -- member orders. assert_order_group_totals enforces all three at COMMIT.
         og as (insert into order_group
                  (customer_user_id, idempotency_key, status, city_id, kind,
                   subtotal_paise, tax_total_paise, payable_paise)
                select u.id, 'e21-race-' || gen_random_uuid(), 'paid', c.id, 'meal_pack_purchase',
                       100000, 5000, 105000 from u, c
                returning id, customer_user_id)
    insert into meal_pack
      (customer_user_id, school_id, offer_id, order_group_id, name_snapshot,
       price_paid_paise, cgst_paise, sgst_paise, items_original, valued_remaining,
       bonus_items, bonus_window_ends_at, expires_at, status, correlation_id)
    select og.customer_user_id, s.id, o.id, og.id, 'E21 race pack',
           100000, 2500, 2500, ${items}, ${items},
           0, now(), now() + interval '60 days', 'active', gen_random_uuid()
      from og, o, s
    returning id || ' ' || customer_user_id`);
  const [packId, userId] = row.split(' ');
  return { packId, userId };
}

async function race({ items, attempts, take }) {
  const { packId } = seedPack(items);

  // The gate holds the lock for 1.5s; every racer queues behind it and is released together.
  const gate = spawn('psql', [URL, '-X', '-q', '-A', '-t', '-c',
    `begin; select pg_advisory_xact_lock(${BARRIER}); select pg_sleep(1.5); commit;`],
    { stdio: ['ignore', 'ignore', 'ignore'] });

  // Give the gate time to actually take the lock before the racers ask for it. Without this a
  // racer can win the lock first and the barrier does nothing.
  await new Promise((r) => setTimeout(r, 400));

  const results = await Promise.all(
    Array.from({ length: attempts }, () => racer(packId, take)),
  );
  gate.kill();

  const after = sql(`select items_reserved || ' ' || valued_remaining || ' ' || items_remaining
                       from meal_pack where id = '${packId}'::uuid`);
  const [reserved, valued, remaining] = after.split(' ').map(Number);

  /**
   * Clean up. **This test must COMMIT to race real transactions**, so unlike every pgTAP file it
   * cannot roll back — and what it leaves behind is visible to everything that runs afterwards.
   *
   * `meal_packs.test.sql` asserts the deferred-revenue invariant over every live pack, and
   * committed packs from earlier runs of this file made it false before that test wrote a line.
   * The failure looked like a redemption bug and was this file's litter.
   *
   * Deleted in FK order, and only rows this run created.
   */
  sql(`delete from meal_pack_redemption where meal_pack_id = '${packId}'::uuid;
       delete from meal_pack where id = '${packId}'::uuid;
       delete from order_group og where og.id not in (select order_group_id from meal_pack)
         and og.idempotency_key like 'e21-race-%';
       delete from meal_pack_offer o where o.name = 'E21 race pack'
         and not exists (select 1 from meal_pack m where m.offer_id = o.id);`);

  return {
    succeeded: results.filter((r) => r === 'took').length,
    refused: results.filter((r) => r === 'refused').length,
    aborted: results.filter((r) => r === 'aborted').length,
    reserved,
    valued,
    remaining,
  };
}

test('two devices cannot reserve the same last item',
  { skip: HAVE_DB ? false : 'no database' }, async () => {
    const r = await race({ items: 1, attempts: 2, take: 1 });
    assert.equal(r.succeeded, 1, 'exactly one device may hold the last item');
    assert.equal(r.refused, 1);
    assert.equal(r.aborted, 0,
      'THE MECHANISM, NOT THE BACKSTOP. The loser was refused by the WHERE clause — zero rows, ' +
      'transaction intact — rather than killed by the check constraint, which would roll back ' +
      'the whole checkout. Remove the guard and this is the assertion that fails.');
    assert.equal(r.reserved, 1, 'and exactly one hold exists');
    assert.equal(r.valued, 1,
      'THE BALANCE IS UNTOUCHED. Neither device has paid, so the parent still owns the item — ' +
      'this is the assertion that fails if the reservation is ever "simplified" into a decrement.');
  });

test('ten connections against a three-item pack reserve exactly three',
  { skip: HAVE_DB ? false : 'no database' }, async () => {
    // The test Andy singled out. Two callers can serialise by luck of timing; ten cannot.
    const r = await race({ items: 3, attempts: 10, take: 1 });
    assert.equal(r.succeeded, 3, 'exactly three items may be held');
    assert.equal(r.refused, 7);
    assert.equal(r.aborted, 0, 'all seven losers were refused cleanly, none aborted');
    assert.equal(r.reserved, 3);
    assert.equal(r.valued, 3, 'and none of the balance has moved');
  });

test('a multi-item cart is all or nothing under contention',
  { skip: HAVE_DB ? false : 'no database' }, async () => {
    // Four racers each want 2 items from a 5-item pack. Two fit; the rest must be refused
    // OUTRIGHT rather than partially served — a half-applied hold is worse than a refusal,
    // because the parent cannot see which half.
    const r = await race({ items: 5, attempts: 4, take: 2 });
    assert.equal(r.succeeded, 2, 'two carts of two fit; a third would overdraw');
    assert.equal(r.aborted, 0, 'and the two that did not fit were refused, not aborted');
    assert.equal(r.reserved, 4, 'and the odd item is left whole, not half-held');
  });

test('reservations never exceed the balance',
  { skip: HAVE_DB ? false : 'no database' }, async () => {
    const r = await race({ items: 2, attempts: 8, take: 1 });
    assert.equal(r.succeeded, 2);
    assert.equal(r.aborted, 0);
    assert.ok(r.reserved <= r.remaining,
      'items_reserved must never exceed what the pack holds — the check constraint is a backstop ' +
      'and would have aborted the write, so this asserts the mechanism rather than the backstop');
    assert.equal(r.reserved, 2);
  });
