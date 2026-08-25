// POST /cancel-order — the parent cancels their own paid order before the cutoff. `E06-45`,
// `docs/order-lifecycle.md` T10 / §9.2 E5.
//
// A shell, exactly like `checkout`. Every guard, the state change and the refund record live in
// `cancel_order()` in migration `0053`, in one transaction, where the checks and the writes see
// the same snapshot of the data. This file owns the HTTP shape and the one thing that cannot
// live in SQL: **establishing who the caller is.**
//
// ## The two clients, and why there are two
//
// `cancel_order` takes `p_customer_user_id` and runs as `service_role`, so whoever calls it
// could cancel as anybody. The identity is therefore proved *before* that call, from the
// caller's own JWT, and never taken from the request body:
//
//   1. the **caller's** client — anon key plus the request's `Authorization` header — is asked
//      "who are you". Supabase verifies the signature; neither we nor the caller can forge it.
//   2. the **service-role** client makes exactly one call, with the id from (1).
//
// A body field named `customer_user_id` is ignored if present. There is no code path that
// reads one.
//
//   200 -> cancelled   { order_group_id, status, orders_cancelled, refund_id, refund_amount_paise, refund_status }
//   400 -> malformed body
//   401 -> no or invalid session
//   409 -> a guard refused; `code` says which  { code, message }
//   500 -> anything else, without leaking the database's message
//
// **No PII may appear in a response body or a log line here** (non-negotiable #4). Every
// refusal names a condition, never a child and never an order id.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, preflight } from '../_shared/cors.ts';

const CORS = corsHeaders('POST');

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

/**
 * `cancel_order`'s hints, mapped to what the parent reads.
 *
 * These are close to the sentences `cancelAvailability` already renders on the screen, and
 * that is intentional rather than duplication: the screen's copy is an *advisory* answer from
 * a device clock, and this one is the authoritative answer. A parent who taps at exactly the
 * wrong second must get the same explanation from the server that the screen would have given
 * a moment later — not a different one that reads like a bug.
 *
 * Anything not in this map becomes a generic 500 rather than being echoed: a database message
 * can carry ids and column names, and this response goes to a phone.
 */
const REFUSALS: Record<string, string> = {
  not_found: 'We could not find that order.',
  already_cancelled: 'That order has already been cancelled.',
  already_delivered: 'That order has already been delivered.',
  already_preparing:
    "The kitchen has already started preparing this order, so it can't be cancelled from the " +
    'app. Get in touch and we will see what can be done.',
  // `not_paid` is no longer surfaced to anyone: it is intercepted below and dispatched to
  // `abandon_checkout`. The old copy claimed the order would "close by itself", which nothing
  // did — kept here only so the map still covers every hint the RPC can raise.
  not_paid: 'This order has not been paid for.',
  not_pending: 'That order is no longer waiting for payment.',
  cancellation_not_offered:
    "This kitchen doesn't take cancellations through the app. Get in touch and we will sort " +
    'it out with them.',
  cancellation_window_unknown:
    "We can't tell when cancelling closes for this order, so we are not going to guess. Get " +
    'in touch and we will check.',
  cancellation_closed:
    'Cancelling has closed for this order. Get in touch if something is wrong and we will ' +
    'sort it out.',
  // Should be unreachable: `settle_payment` writes the capture and the `paid` status
  // together. Surfaced as words anyway, because the alternative when it does happen is a
  // 500 that tells the parent nothing and tells us nothing either.
  no_payment_to_refund:
    "We couldn't work out where to send your refund, so we have not cancelled this order. " +
    'Get in touch and we will sort it out.',
};

Deno.serve(async (request: Request) => {
  const pre = preflight(request, CORS);
  if (pre) return pre;

  if (request.method !== 'POST') return json(405, { error: 'POST only' });

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return json(401, { error: 'sign in to cancel an order' });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'body must be JSON' });
  }

  const orderGroupId = String(body.order_group_id ?? '').trim();
  if (!orderGroupId) {
    return json(400, { error: 'order_group_id is required' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error('cancel-order: environment is incomplete');
    return json(500, { error: 'server misconfigured' });
  }

  // (1) Who is calling. The JWT is verified by Supabase, not by us.
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData?.user) {
    return json(401, { error: 'sign in to cancel an order' });
  }

  // (2) The one privileged call, with the id from (1) and never from the body.
  const asService = createClient(supabaseUrl, serviceKey);
  const { data, error } = await asService.rpc('cancel_order', {
    p_order_group_id: orderGroupId,
    p_customer_user_id: userData.user.id,
  });

  if (error) {
    const hint = (error as { hint?: string }).hint ?? '';

    /**
     * **An unpaid order is abandoned, not cancelled — `E05-54`.**
     *
     * `cancel_order` refuses `not_paid`, and until now that refusal was the end of the road: the
     * app told the parent it "will close by itself if the payment does not come through", which
     * nothing did. Two real parents sat stranded for six days behind that sentence.
     *
     * The distinction is ours, not theirs. A parent taps the same "cancel" either way; whether
     * that means reversing money or releasing a checkout that never completed is a question for
     * this function. So `not_paid` dispatches to `abandon_checkout` rather than being reported.
     *
     * They are genuinely different underneath — `cancel_order` records a refund, and
     * `abandon_checkout` posts nothing because nothing was ever captured — which is exactly why
     * they are two functions and one endpoint.
     */
    if (hint === 'not_paid') {
      const { data: abandoned, error: abandonError } = await asService.rpc('abandon_checkout', {
        p_order_group_id: orderGroupId,
        p_customer_user_id: userData.user.id,
      });

      if (abandonError) {
        const abandonHint = (abandonError as { hint?: string }).hint ?? '';
        if (abandonHint in REFUSALS) {
          return json(409, { code: abandonHint, message: REFUSALS[abandonHint] });
        }
        console.error('cancel-order: abandon failed', { hint: abandonHint });
        return json(500, { error: 'could not cancel the order' });
      }

      return json(200, { ...abandoned, abandoned: true });
    }

    if (hint in REFUSALS) {
      return json(409, { code: hint, message: REFUSALS[hint] });
    }
    console.error('cancel-order: unexpected database error', { code: error.code, hint });
    return json(500, { error: 'could not cancel the order' });
  }

  return json(200, data);
});
