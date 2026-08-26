// POST /confirm-pack-plan — spend meals from a pack across several days. `E21-47`.
//
// A shell, like `checkout`. Every guard, every price and every ledger leg lives in
// `confirm_meal_pack_plan()` in migration `0073`, in one transaction, where the checks and the
// writes see the same snapshot. This file owns the HTTP shape and the one thing that cannot live
// in SQL: **establishing who the caller is.**
//
// ## The identity never comes from the body
//
// `confirm_meal_pack_plan` takes `p_user_id` and runs as `service_role`, so whoever calls it
// could spend anybody's meals. The identity is therefore proved from the caller's own JWT before
// that call. A body field named `user_id` is ignored if present; there is no code path that reads
// one. This is the same shape `checkout` set, and for the same reason.
//
// ## Why an Idempotency-Key is required rather than generated
//
// Andy: *"Planning four days and retrying on a flaky connection must produce four orders, not
// eight."* A key the server invents would differ per attempt and defeat the whole point — the
// retry has to carry the SAME key as the attempt it repeats, which only the client can arrange.
// So a missing key is a refusal, not a default.
//
//   200 -> { order_ids, redemption_ids, replayed }
//   400 -> malformed body, or no Idempotency-Key
//   401 -> no or invalid session
//   409 -> a guard refused; `code` says which
//   500 -> anything else, without leaking the database's message
//
// **No PII may appear in a response body or a log line here** (non-negotiable #4). Every refusal
// names a condition — never a child, never a dish, never a date belonging to one.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, preflight } from '../_shared/cors.ts';

const CORS = corsHeaders('POST');

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

/**
 * Guard hints from `confirm_meal_pack_plan`, mapped to what the app shows.
 *
 * Anything not in this map becomes a generic 500 rather than being echoed: a database message can
 * carry ids, column names and a recipient's first name, and this response goes to a phone.
 */
const REFUSALS: Record<string, string> = {
  empty_plan: 'Choose at least one day.',
  insufficient_meals: 'You don’t have enough meals left for that many days.',
  plan_spans_packs: 'That plan is larger than the pack it would come from.',
  day_after_expiry: 'One of those days is after your pack expires.',
  cutoff_passed: 'Ordering has closed for one of those days.',
  not_eligible: 'One of those days isn’t a valid pack meal.',
  unknown_recipient: 'We couldn’t find who that day is for.',
  key_reused_with_different_plan: 'That request was already used for a different plan.',
};

Deno.serve(async (request: Request) => {
  const pre = preflight(request, CORS);
  if (pre) return pre;

  if (request.method !== 'POST') return json(405, { error: 'POST only' });

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return json(401, { error: 'sign in to plan meals' });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'body must be JSON' });
  }

  const idempotencyKey =
    request.headers.get('Idempotency-Key')?.trim() || String(body.idempotency_key ?? '').trim();
  if (!idempotencyKey) {
    return json(400, { error: 'Idempotency-Key is required' });
  }

  const days = body.days;
  if (!Array.isArray(days) || days.length === 0) {
    return json(400, { error: 'days must be a non-empty array' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error('confirm-pack-plan: environment is incomplete');
    return json(500, { error: 'server misconfigured' });
  }

  // (1) Who is calling. The JWT is verified by Supabase, not by us.
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData?.user) {
    return json(401, { error: 'sign in to plan meals' });
  }

  // (2) The one privileged call, with the id from (1) and never from the body.
  const asService = createClient(supabaseUrl, serviceKey);
  const { data, error } = await asService.rpc('confirm_meal_pack_plan', {
    p_user_id: userData.user.id,
    p_idempotency_key: idempotencyKey,
    p_days: days,
  });

  if (error) {
    // `hint` is what the function raises deliberately; `message` is not echoed.
    const hint = typeof error.hint === 'string' ? error.hint : '';
    const known = REFUSALS[hint];
    if (known !== undefined) return json(409, { code: hint, message: known });

    console.error('confirm-pack-plan: unexpected failure', { code: error.code, hint });
    return json(500, { error: 'we could not plan those meals' });
  }

  return json(200, data);
});
