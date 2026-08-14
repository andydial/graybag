#!/usr/bin/env node
/**
 * `E19-07` rows 4, 6 and 7 — the questions a webhook cannot answer.
 *
 *   node scripts/probe-razorpay.mjs            # read-only
 *   node scripts/probe-razorpay.mjs --refund   # also answers row 4, which needs a real refund
 *
 * Reads `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` from the environment. **Test keys only** — it
 * refuses an `rzp_live_` key outright, because every question here is a protocol fact and none of
 * them is worth asking against real money.
 *
 * This is an instrument, not payment code. It posts to no ledger and writes to no table. Its
 * whole output is "here is what Razorpay actually returned", so that `docs/payments-design.md`
 * §12 records observations rather than readings of documentation — which is the distinction that
 * made row 5 worth answering at all (the docs implied `authorized` where a real UPI intent gives
 * `captured`).
 */
const BASE = 'https://api.razorpay.com/v1';

const keyId = process.env.RAZORPAY_KEY_ID ?? '';
const keySecret = process.env.RAZORPAY_KEY_SECRET ?? '';
const doRefund = process.argv.includes('--refund');

if (!keyId || !keySecret) {
  console.error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set.');
  process.exit(1);
}
if (keyId.startsWith('rzp_live_')) {
  console.error('That is a LIVE key. This probe is test-mode only — refusing.');
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: auth, 'content-type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, ok: res.ok, json, headers: res.headers };
}

const line = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
const say = (k, v) => console.log(`  ${k.padEnd(34)} ${v}`);

// ---------------------------------------------------------------------------- row 7
//
// Tier-2 daily reconciliation (`E06-11`) reads this endpoint every night. If the window is
// exclusive at one end, or resolved in a timezone we did not expect, the day's total is wrong by
// however many payments fell in the boundary hour — and the report still looks correct, which is
// the failure that matters.
line('ROW 7 — payments list: from/to semantics, and the page-size cap');

const now = Math.floor(Date.now() / 1000);
const dayAgo = now - 24 * 60 * 60;

const asked = 200; // deliberately above Razorpay's documented maximum, to observe the real cap
const capProbe = await call(`/payments?count=${asked}&from=${dayAgo}&to=${now}`);
say('count= asked for', asked);
say('HTTP', capProbe.status);
if (capProbe.ok) {
  say('items returned', capProbe.json.count ?? capProbe.json.items?.length ?? '?');
  say('entity', capProbe.json.entity ?? '—');
} else {
  say('error', JSON.stringify(capProbe.json?.error ?? capProbe.json).slice(0, 220));
  const retry = await call(`/payments?count=100&from=${dayAgo}&to=${now}`);
  say('retry at count=100 → HTTP', retry.status);
  say('items returned', retry.json.count ?? retry.json.items?.length ?? '?');
}

// Inclusivity, asked directly: pin `from` and `to` to a known payment's own created_at. If the
// payment comes back when the window is exactly its own timestamp, both ends are inclusive.
const recent = await call(`/payments?count=10`);
const sample = recent.json.items?.[0];
if (sample) {
  say('sample payment', `${sample.id} created_at=${sample.created_at}`);
  const exact = await call(`/payments?from=${sample.created_at}&to=${sample.created_at}&count=10`);
  const found = exact.json.items?.some((p) => p.id === sample.id);
  say('from=to=created_at contains it', found ? 'YES — both ends inclusive' : 'no');

  const openLeft = await call(`/payments?from=${sample.created_at + 1}&to=${now}&count=10`);
  say('from=created_at+1 excludes it', openLeft.json.items?.some((p) => p.id === sample.id) ? 'no' : 'YES');
  say('created_at is', 'epoch SECONDS (unix), UTC — compare against our IST day boundaries');
}

// ---------------------------------------------------------------------------- row 6
//
// Tier-3 settlement reconciliation (`E06-27`). Test-mode accounts usually have no settlements at
// all, in which case the honest answer is "shape unknown from here" rather than a guess.
line('ROW 6 — settlements and the recon report');

const settlements = await call('/settlements?count=10');
say('GET /settlements → HTTP', settlements.status);
say('settlements found', settlements.json.count ?? settlements.json.items?.length ?? '0');
if (settlements.json.items?.length) {
  say('first settlement keys', Object.keys(settlements.json.items[0]).join(', '));
}

const d = new Date();
const recon = await call(
  `/settlements/recon/combined?year=${d.getUTCFullYear()}&month=${d.getUTCMonth() + 1}&day=${d.getUTCDate()}`,
);
say('GET /settlements/recon/combined → HTTP', recon.status);
if (recon.ok) {
  const first = recon.json.items?.[0];
  say('recon rows today', recon.json.count ?? recon.json.items?.length ?? '0');
  if (first) say('recon row keys', Object.keys(first).join(', '));
} else {
  say('error', JSON.stringify(recon.json?.error ?? recon.json).slice(0, 220));
}

// ---------------------------------------------------------------------------- row 4
//
// **The one that sends money if it is wrong.** `E06-08` must be able to retry a refund whose
// response was lost. Without idempotency, the retry refunds a second time — so the fallback is
// §7.4's `notes.graybag_refund_id` adoption, which costs a reconcile before every attempt.
line('ROW 4 — do refunds accept an idempotency key?');

if (!doRefund) {
  say('skipped', 'pass --refund to run (this one moves test money)');
} else {
  const captured = (await call('/payments?count=20')).json.items?.find(
    (p) => p.status === 'captured' && p.amount_refunded === 0,
  );
  if (!captured) {
    say('no refundable payment', 'need a captured, unrefunded test payment');
  } else {
    say('refunding', `${captured.id} (${captured.amount} paise, ${captured.method})`);
    const key = `e19-07-probe-${captured.id}`;

    const first = await call(`/payments/${captured.id}/refund`, {
      method: 'POST',
      // 100 paise. Enough to be real, small enough that a partial refund leaves the payment
      // available for anything else this sitting needs.
      body: { amount: 100, notes: { graybag_probe: 'E19-07 row 4' } },
      headers: { 'Idempotency-Key': key },
    });
    say('1st POST → HTTP', first.status);
    say('refund id', first.json.id ?? JSON.stringify(first.json?.error ?? {}).slice(0, 160));

    // The whole question: same key, same body, again.
    const second = await call(`/payments/${captured.id}/refund`, {
      method: 'POST',
      body: { amount: 100, notes: { graybag_probe: 'E19-07 row 4' } },
      headers: { 'Idempotency-Key': key },
    });
    say('2nd POST, same key → HTTP', second.status);
    say('refund id', second.json.id ?? JSON.stringify(second.json?.error ?? {}).slice(0, 160));

    const sameId = first.json.id && first.json.id === second.json.id;
    say(
      'VERDICT',
      sameId
        ? 'IDEMPOTENT — same refund id returned. E06-08 may retry safely.'
        : 'NOT idempotent (or not honoured) — E06-08 must reconcile before every retry (§7.4).',
    );
    if (!sameId && second.json.id) {
      say('WARNING', `two refunds created: ${first.json.id} and ${second.json.id}`);
    }
  }
}

console.log('\nDone. Paste this whole output back.\n');
