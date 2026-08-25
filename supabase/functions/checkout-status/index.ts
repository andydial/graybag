// `GET /checkout-status?group=<uuid>` — did that payment actually land? `E06-16`.
//
// **A launch blocker, not a nicety** (`docs/e06-build-plan.md` step 7). A UPI intent payment
// app-switches away from our process by construction, and on a mid-range Android under memory
// pressure the OS may never bring it back. On this product "app killed mid-payment" is the normal
// path with bad luck attached — and the parent's money has moved.
//
// ## It reconciles; it does not report our own row
//
// The naive version answers from `order_group.status` and is wrong in the one case that matters.
// The webhook may not have arrived — it is a different network path, from Razorpay's servers to
// ours, and it can lag or fail while the payment itself succeeded perfectly. Answering "not paid"
// then is answering from our own ignorance.
//
// So when our row says unpaid, this **asks Razorpay** what happened to that provider order, and
// if a capture exists it calls `settle_payment` — the same function the webhook calls, with the
// same idempotency (§7.1 layers 5–8 refuse every write of a repeat). The webhook arriving later
// changes nothing.
//
// ## Today it is the ONLY route to settlement, which was not the plan
//
// `payments-webhook` verifies an event and **records** it with `processing_status = 'pending'`.
// Nothing consumes that queue yet — no function calls `settle_payment` from a recorded row. So
// until that processor exists (`E06-37`), a payment settles when the app asks, and not before.
//
// That is why this polls every two seconds rather than once, and why it reconciles against
// Razorpay rather than reading `order_group.status`: reading our own row would return `unpaid`
// forever. It works, and it is one route where the design calls for two — a parent who never
// reopens the app would have a captured payment and no settled order until the processor lands.
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, preflight } from '../_shared/cors.ts';
import { sendOrderConfirmation } from '../_shared/order-confirmation.ts';
import { sendOrderAlerts } from '../_shared/order-alert.ts';

const CORS = corsHeaders('GET');

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the app does with each answer. The strings are a contract with `PaymentWaitingScreen`,
 * not decoration.
 *
 *   `paid`      — settled. Show the confirmation. Terminal.
 *   `pending`   — money may have moved and we cannot yet say. **Keep waiting.** Never a failure.
 *   `unpaid`    — nothing captured. The order is intact and retryable.
 *   `failed`    — the provider reported a failed payment. Retry is a new attempt.
 *   `cancelled` — the order is gone.
 */
type Status = 'paid' | 'pending' | 'unpaid' | 'failed' | 'cancelled';

Deno.serve(async (request: Request) => {
  const pre = preflight(request, CORS);
  if (pre) return pre;

  if (request.method !== 'GET') return json(405, { error: 'GET only' });

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return json(401, { error: 'sign in to check an order' });
  }

  const group = (new URL(request.url).searchParams.get('group') ?? '').trim();
  if (!UUID.test(group)) return json(400, { error: 'group must be a uuid' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const keyId = Deno.env.get('RAZORPAY_KEY_ID') ?? '';
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';

  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error('checkout-status: supabase environment is incomplete');
    return json(500, { error: 'server misconfigured' });
  }

  // Identity from the caller's own JWT, never from the query string.
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData?.user) return json(401, { error: 'sign in to check an order' });

  const admin = createClient(supabaseUrl, serviceKey);

  /**
   * **The sweep, ridden along on a request that was happening anyway — `E05-54`.**
   *
   * There is no `pg_cron` on production, so "resolves itself server-side" has to mean *some
   * request does it*. This is the natural one: the app polls it during checkout, so it fires
   * exactly when people are ordering, which is when stale checkouts accumulate.
   *
   * `expire_stale_checkouts` only touches groups that are provably unchargeable — no live
   * Razorpay attempt — so riding it here cannot cancel an order somebody is mid-payment on.
   * Groups holding a live attempt are left for a caller that reconciles with the provider.
   *
   * Failure is swallowed deliberately. A parent polling their own payment must never be told
   * anything went wrong because a housekeeping job for *other* orders failed.
   */
  void admin
    .rpc('expire_stale_checkouts')
    .then(({ data, error }) => {
      if (error) console.warn(`checkout-status: sweep failed: ${error.message}`);
      else if (Number(data) > 0) console.warn(`checkout-status: expired ${Number(data)} stale checkout(s)`);
    })
    .catch(() => {});

  const { data: row, error: readError } = await admin
    .from('order_group')
    .select('id, customer_user_id, status, payable_paise')
    .eq('id', group)
    .maybeSingle();

  if (readError) {
    console.error('checkout-status: order_group read failed', readError.message);
    return json(500, { error: 'something went wrong' });
  }
  // Same reply for "not yours" as for "does not exist".
  if (!row || row.customer_user_id !== userData.user.id) {
    return json(404, { error: 'we could not find that order' });
  }

  if (row.status === 'paid') {
    /**
     * **The confirmation must not depend on which route settled the order.**
     *
     * This branch used to return without sending, so an order settled by the drain — or by hand
     * during an incident — never told the parent anything. `0050`'s unique index means calling
     * this on every poll is safe: the first caller claims the send and the rest read `23505` as
     * already done, so the invariant is "exactly one email per order", not "one email if the
     * settlement happened in the right function".
     *
     * Telling a parent late is a nuisance. Never telling them is the failure.
     */
    await sendOrderConfirmation(admin, { orderGroupId: group, correlationId: null });
    // `E08-16`. Idempotent per order, so reaching here twice sends one alert.
    await sendOrderAlerts(admin, { orderGroupId: group });
    return json(200, { status: 'paid' satisfies Status, group, order: await summarise(admin, group) });
  }
  if (row.status === 'cancelled') return json(200, { status: 'cancelled' satisfies Status, group });

  // ------------------------------------------------------------------ our row says unpaid
  //
  // Which may mean the webhook has not arrived. Ask the provider before believing ourselves.
  const { data: payments } = await admin
    .from('payment')
    .select('provider_order_id, status, attempt_no')
    .eq('order_group_id', group)
    .order('attempt_no', { ascending: false });

  if (!payments || payments.length === 0) {
    // No attempt was ever started, so there is nothing to reconcile against.
    return json(200, { status: 'unpaid' satisfies Status, group });
  }

  if (!keyId || !keySecret) {
    // Cannot reconcile. **`pending`, never `unpaid`** — the honest answer is "we do not know",
    // and of the two available words the one that keeps a parent waiting is the one that cannot
    // tell them their money is safe when it is not.
    console.error('checkout-status: Razorpay credentials missing — cannot reconcile');
    return json(200, { status: 'pending' satisfies Status, group, reconciled: false });
  }

  const auth = `Basic ${btoa(`${keyId}:${keySecret}`)}`;
  let sawFailure = false;

  for (const attempt of payments) {
    let captured: { id: string; amount: number } | null = null;
    try {
      const res = await fetch(
        `https://api.razorpay.com/v1/orders/${attempt.provider_order_id}/payments`,
        { headers: { Authorization: auth } },
      );
      if (!res.ok) {
        console.error(`checkout-status: razorpay ${res.status} for ${attempt.provider_order_id}`);
        continue;
      }
      const body = (await res.json()) as { items?: { id: string; status: string; amount: number }[] };
      for (const p of body.items ?? []) {
        if (p.status === 'captured') captured = { id: p.id, amount: p.amount };
        if (p.status === 'failed') sawFailure = true;
      }
    } catch (error) {
      console.error('checkout-status: razorpay call threw', String(error));
      continue;
    }

    if (captured) {
      // The same function the webhook calls. Idempotent by construction, so a webhook arriving
      // a second later is a no-op rather than a second settlement.
      const { error: settleError } = await admin.rpc('settle_payment', {
        p_provider_order_id: attempt.provider_order_id,
        p_provider_payment_id: captured.id,
        p_amount_paise: captured.amount,
      });
      if (settleError) {
        console.error('checkout-status: settle_payment failed', settleError.message);
        // We know money moved and we could not record it. `pending` keeps the parent waiting
        // rather than telling them an order they paid for does not exist.
        return json(200, { status: 'pending' satisfies Status, group, reconciled: true });
      }
      // `E08-03`. Awaited rather than fired and forgotten: an Edge Function's process can be
      // torn down the moment it responds, so a floating promise here is an email that sometimes
      // sends. It never throws and never blocks — see `order-confirmation.ts`.
      await sendOrderConfirmation(admin, { orderGroupId: group, correlationId: null });
    // `E08-16`. Idempotent per order, so reaching here twice sends one alert.
    await sendOrderAlerts(admin, { orderGroupId: group });

      return json(200, {
        status: 'paid' satisfies Status,
        group,
        reconciled: true,
        order: await summarise(admin, group),
      });
    }
  }

  // A `created` attempt with no capture and no failure is a payment still in flight — a UPI
  // collect the parent has not yet approved, most often. Waiting is correct.
  const stillOpen = payments.some((p) => p.status === 'created' || p.status === 'authorized');
  if (stillOpen) return json(200, { status: 'pending' satisfies Status, group, reconciled: true });

  return json(200, {
    status: (sawFailure ? 'failed' : 'unpaid') satisfies Status,
    group,
    reconciled: true,
  });
});

/**
 * The confirmation, read after settlement — never assembled on the client.
 *
 * `OrderPlacedScreen` takes a **branded** `PlacedOrder` that only `placedOrder()` can mint, and
 * it refuses anything without a four-digit pickup code. That is `R8` expressed in the type
 * system: a screen that says "confirmed" cannot be rendered from a handset's optimism, only from
 * a settled row. So these fields come from the database after `settle_payment`, or not at all.
 *
 * The recipient's **first name only** (§4.3, `G7`) — the same rule the invoice line follows, for
 * the same reason: this is a surface a parent may show to somebody else.
 */
async function summarise(admin: ReturnType<typeof createClient>, group: string) {
  const { data } = await admin
    .from('order')
    .select('pickup_code, service_date, recipient_name_snapshot, break_label_snapshot, total_paise')
    .eq('order_group_id', group)
    .order('service_date', { ascending: true });

  const orders = data ?? [];
  if (orders.length === 0) return null;

  const first = orders[0] as Record<string, unknown>;
  const fullName = String(first.recipient_name_snapshot ?? '').trim();

  return {
    pickup_code: String(first.pickup_code ?? ''),
    service_date: String(first.service_date ?? ''),
    recipient_first_name: fullName === '' ? null : fullName.split(/\s+/)[0],
    break_label: String(first.break_label_snapshot ?? 'Break'),
    item_count: orders.length,
    total_paise: orders.reduce((sum, o) => sum + Number((o as Record<string, unknown>).total_paise ?? 0), 0),
  };
}
