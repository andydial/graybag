// `POST /payments-create-order` — the step between a priced cart and a payment sheet. `E06-02`.
//
// `create_checkout` prices and places the orders. Razorpay's SDK needs a **provider order id**
// before it can open. Nothing created one, so this is the missing link in the client half of
// checkout.
//
// ## The shape, and why it is this shape
//
// Razorpay's Orders API is an HTTP call with the key secret in a Basic auth header, so it cannot
// live in SQL — and the secret must never reach the app, which is the other half of why this is a
// function and not a client call. What the app gets back is the **public** key id, the order id
// and the amount. That is everything the SDK needs and nothing it should not have.
//
// ## The order of operations is deliberate: Razorpay first, our row second
//
// The obvious ordering is to insert the payment row and then create the Razorpay order, so the
// row is never missing. It is wrong. `payment.provider_order_id` is `not null` with a unique
// constraint, so a row cannot exist before the id does — and a placeholder id would be a lie in
// the one column reconciliation matches on.
//
// The failure this leaves is a Razorpay order we created and did not record: the customer never
// sees a sheet, no money moves, and `E06-17`'s in-flight reconciler finds an order with no
// payment row. That is a recoverable, visible orphan. The reverse — a row claiming a provider
// order that does not exist — is a reconciliation mismatch that looks like Razorpay's fault.
//
// **Prefer the orphan you can find over the record that lies.**
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, preflight } from '../_shared/cors.ts';
import { buildOrderRequest, disallowedNoteKeys } from '../_shared/razorpay-payload.ts';

const CORS = corsHeaders('POST');

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

/** `begin_payment`'s hints, mapped to what a parent reads. Anything unmapped becomes a 500. */
const REFUSALS: Record<string, { status: number; error: string }> = {
  invalid_request: { status: 400, error: 'that request was not valid' },
  not_found: { status: 404, error: 'we could not find that order' },
  // Deliberately the same reply as not_found: a caller naming somebody else's order must not
  // learn whether it exists.
  not_authorized: { status: 404, error: 'we could not find that order' },
  already_paid: { status: 409, error: 'this order has already been paid' },
  not_payable: { status: 409, error: 'this order can no longer be paid' },
  amount_mismatch: { status: 409, error: 'the price changed — please review your cart' },
  nothing_payable: { status: 409, error: 'there is nothing to pay on this order' },
};

Deno.serve(async (request: Request) => {
  const pre = preflight(request, CORS);
  if (pre) return pre;

  if (request.method !== 'POST') return json(405, { error: 'POST only' });

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return json(401, { error: 'sign in to pay for an order' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const keyId = Deno.env.get('RAZORPAY_KEY_ID') ?? '';
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';
  const appEnv = Deno.env.get('APP_ENV') ?? 'unknown';

  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error('payments-create-order: supabase environment is incomplete');
    return json(500, { error: 'server misconfigured' });
  }

  // Said separately and loudly, because this is the exact state `E06-36` was: absent Razorpay
  // credentials are a configuration fault of ours, not a bad request, and the two must not be
  // reported the same way. A generic 500 here reads as "Razorpay is down" to whoever is on call.
  if (!keyId || !keySecret) {
    console.error(
      'payments-create-order: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set — no payment ' +
        'can be started. This is a configuration fault, not a provider outage.',
    );
    return json(503, { error: 'payments are not available right now' });
  }

  let body: { order_group_id?: unknown };
  try {
    body = (await request.json()) as { order_group_id?: unknown };
  } catch {
    return json(400, { error: 'body must be JSON' });
  }

  const orderGroupId = typeof body.order_group_id === 'string' ? body.order_group_id.trim() : '';
  if (!orderGroupId) return json(400, { error: 'order_group_id is required' });

  // ---------------------------------------------------------------- who is calling
  //
  // Proved from the caller's own JWT, never taken from the body — the same two-client shape as
  // `checkout`, and for the same reason: `begin_payment` runs as `service_role` and takes the
  // user id as a parameter, so whoever calls it could otherwise pay as anybody.
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData?.user) {
    return json(401, { error: 'sign in to pay for an order' });
  }
  const customerUserId = userData.user.id;

  const admin = createClient(supabaseUrl, serviceKey);

  // ---------------------------------------------------------------- what is owed
  //
  // Read before calling Razorpay, because the amount asked for must be OUR figure. `begin_payment`
  // checks it again on the way back in — belt and braces, and the second check is the one that
  // holds under a concurrent price change, because it runs under the group's row lock.
  const { data: group, error: groupError } = await admin
    .from('order_group')
    .select('id, customer_user_id, status, payable_paise, currency, correlation_id')
    .eq('id', orderGroupId)
    .maybeSingle();

  if (groupError) {
    console.error('payments-create-order: order_group read failed', groupError.message);
    return json(500, { error: 'something went wrong' });
  }
  if (!group || group.customer_user_id !== customerUserId) {
    return json(404, { error: 'we could not find that order' });
  }

  /**
   * **Resume before create — `E05-54`.**
   *
   * Every call used to mint a fresh Razorpay order. That is correct for a first attempt and
   * wrong for a resume: a parent who dismissed the sheet and came back would end up with two
   * live provider orders against one group, and both can be paid. That is how somebody is
   * charged twice for one lunch.
   *
   * `reusable_payment_attempt` returns the existing attempt only when nothing about the money
   * has changed — still `pending_payment`, attempt still `created`, amount still equal to
   * `payable_paise`, checkout not expired. Any of those failing returns nothing and we fall
   * through to creating a new one, which is the safe direction: a spare unpaid Razorpay order
   * costs nothing, a wrongly-reused one costs money.
   */
  const { data: reusable, error: reuseError } = await admin.rpc('reusable_payment_attempt', {
    p_order_group_id: orderGroupId,
    p_customer_user_id: customerUserId,
  });

  if (reuseError) {
    const hint = String(reuseError.hint ?? '');
    const mapped = REFUSALS[hint];
    if (mapped) return json(mapped.status, { error: mapped.error, code: hint });
    console.error('payments-create-order: reuse lookup failed', reuseError.message);
    return json(500, { error: 'something went wrong' });
  }

  const existing = Array.isArray(reusable) ? reusable[0] : reusable;
  if (existing?.provider_order_id) {
    // Same order, same amount, same attempt number. The client reopens the sheet on it.
    return json(200, {
      key_id: keyId,
      provider_order_id: String(existing.provider_order_id),
      amount_paise: Number(existing.amount_paise),
      currency: String(group.currency ?? 'INR'),
      order_group_id: orderGroupId,
      correlation_id: String(group.correlation_id),
      attempt_no: Number(existing.attempt_no),
      resumed: true,
    });
  }

  const attemptNo = await nextAttemptNo(admin, orderGroupId);

  // ---------------------------------------------------------------- the outbound call
  const payload = buildOrderRequest({
    amountPaise: Number(group.payable_paise),
    currency: String(group.currency ?? 'INR'),
    orderGroupId,
    correlationId: String(group.correlation_id),
    attemptNo,
    appEnv,
  });

  // `E06-25` enforced at the send, not only in a test. A rule that lives only in a test holds
  // until somebody adds a field in a hurry; this refuses to transmit instead.
  const offenders = disallowedNoteKeys(payload.notes);
  if (offenders.length > 0) {
    console.error(`payments-create-order: refusing to send disallowed notes: ${offenders.join(', ')}`);
    return json(500, { error: 'something went wrong' });
  }

  let providerOrderId: string;
  try {
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        // Basic auth, key id as user and secret as password. `btoa` is fine: these are ASCII.
        Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    if (!response.ok) {
      // Razorpay's message can name the account and the key. It is logged and never returned.
      console.error(`payments-create-order: razorpay ${response.status}: ${text}`);
      return json(502, { error: 'we could not reach the payment provider' });
    }

    const created = JSON.parse(text) as { id?: unknown; amount?: unknown };
    if (typeof created.id !== 'string' || !created.id) {
      console.error(`payments-create-order: razorpay returned no order id: ${text}`);
      return json(502, { error: 'we could not reach the payment provider' });
    }

    // Razorpay echoing a different amount than we asked for would mean charging something we did
    // not price. It has never happened; it is one comparison, and the alternative is finding out
    // from a customer.
    if (Number(created.amount) !== payload.amount) {
      console.error(
        `payments-create-order: razorpay amount ${String(created.amount)} != asked ${payload.amount}`,
      );
      return json(502, { error: 'we could not start this payment' });
    }

    providerOrderId = created.id;
  } catch (error) {
    console.error('payments-create-order: razorpay call threw', String(error));
    return json(502, { error: 'we could not reach the payment provider' });
  }

  // ---------------------------------------------------------------- record it
  const { data: recorded, error: recordError } = await admin.rpc('begin_payment', {
    p_customer_user_id: customerUserId,
    p_order_group_id: orderGroupId,
    p_provider_order_id: providerOrderId,
    p_amount_paise: payload.amount,
  });

  if (recordError) {
    const hint = String(recordError.hint ?? '');
    const mapped = REFUSALS[hint];
    if (mapped) return json(mapped.status, { error: mapped.error, code: hint });

    // The orphan described in the header: Razorpay has an order, we do not. Logged with the
    // provider id so `E06-17` and a human can both find it.
    console.error(
      `payments-create-order: created razorpay order ${providerOrderId} but could not record it: ` +
        recordError.message,
    );
    return json(500, { error: 'something went wrong' });
  }

  const row = Array.isArray(recorded) ? recorded[0] : recorded;

  return json(200, {
    // The PUBLIC key id. The secret never leaves this function.
    key_id: keyId,
    provider_order_id: providerOrderId,
    amount_paise: payload.amount,
    currency: payload.currency,
    order_group_id: orderGroupId,
    correlation_id: String(group.correlation_id),
    attempt_no: row?.attempt_no ?? attemptNo,
  });
});

/**
 * The attempt number used in the outbound `notes`, read before the write.
 *
 * `begin_payment` computes the authoritative value under the group's row lock and returns it;
 * this is only for the payload, which has to be built before that call exists to be made. Two
 * simultaneous taps on Pay can therefore send the same `attempt_no` to Razorpay while the rows
 * get distinct ones — which is why the row's value is what comes back to the client, and why
 * reconciliation keys on `provider_order_id` and never on this.
 */
async function nextAttemptNo(
  admin: ReturnType<typeof createClient>,
  orderGroupId: string,
): Promise<number> {
  const { data } = await admin
    .from('payment')
    .select('attempt_no')
    .eq('order_group_id', orderGroupId)
    .order('attempt_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (Number(data?.attempt_no) || 0) + 1;
}
