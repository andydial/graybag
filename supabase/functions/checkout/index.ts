// POST /checkout — `docs/order-lifecycle.md` §8.2, and the app's only way to create an
// order. `E05-09`, `E05-12`, `E05-13`.
//
// A shell, like `menu-version`. Every guard, every price and every snapshot lives in
// `create_checkout()` in migration `0014`, in one transaction, where the checks and the
// writes see the same snapshot of the data. This file owns the HTTP shape and one thing
// that cannot live in SQL: **establishing who the caller is.**
//
// ## The two clients, and why there are two
//
// `create_checkout` takes `p_customer_user_id` as a parameter and runs as `service_role`,
// so whoever calls it can create orders as anybody. The identity therefore has to be
// proved *before* that call, from the caller's own JWT, and never taken from the request
// body. That is the whole reason this function exists rather than the app calling the RPC
// directly:
//
//   1. the **caller's** client — anon key plus the request's `Authorization` header — is
//      asked "who are you". Supabase verifies the JWT signature; we cannot forge an answer
//      and neither can the caller.
//   2. the **service-role** client makes exactly one call, passing the id from (1).
//
// A body field named `customer_user_id` is ignored if present. There is no code path that
// reads one.
//
// ## Writes go through here, always
//
// Non-negotiable #1 and `A4`: reads may use the Supabase client; writes always go through
// an Edge Function. This is the first write endpoint in the system and it sets the shape —
// the client sends intent, the server decides everything that has consequences.
//
//   200 -> the checkout, or the replayed one   { order_group_id, payable_paise, orders }
//   400 -> malformed body
//   401 -> no or invalid session
//   409 -> a guard refused; `code` says which  { code, message }
//   500 -> anything else, without leaking the database's message
//
// **No PII may appear in a response body or a log line here** (non-negotiable #4). The
// refusal codes name a condition, never a child.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * Guard hints from `create_checkout`, mapped to what the app shows. Anything not in this
 * map becomes a generic 500 rather than being echoed: a database message can carry ids and
 * column names, and this response goes to a phone.
 */
const REFUSALS: Record<string, string> = {
  empty_cart: 'Your cart is empty.',
  bad_quantity: 'One of the items has an invalid quantity.',
  not_authorized: 'You cannot order for that child.',
  recipient_unavailable: 'That child is no longer available to order for.',
  unavailable: 'One of the dishes is no longer on the menu for that day.',
  cutoff_passed: 'Ordering for that day has closed.',
  not_orderable: 'That date is outside the ordering window.',
  price_changed: 'The price changed. Please check the total and try again.',
  idempotency_key_reused: 'That request was already used for a different cart.',
};

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json(405, { error: 'POST only' });

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return json(401, { error: 'sign in to place an order' });
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
    // E05-12: without a key, a retry after a timeout is a second order. Refusing is the
    // only safe answer — the server cannot invent one, because it would differ per attempt
    // and defeat the point.
    return json(400, { error: 'Idempotency-Key is required' });
  }

  const lines = body.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    return json(400, { error: 'lines must be a non-empty array' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error('checkout: environment is incomplete');
    return json(500, { error: 'server misconfigured' });
  }

  // (1) Who is calling. The JWT is verified by Supabase, not by us.
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData?.user) {
    return json(401, { error: 'sign in to place an order' });
  }

  // (2) The one privileged call, with the id from (1) and never from the body.
  const asService = createClient(supabaseUrl, serviceKey);
  const { data, error } = await asService.rpc('create_checkout', {
    p_customer_user_id: userData.user.id,
    p_idempotency_key: idempotencyKey,
    // The hash is what makes "same key, different cart" detectable. It is computed over
    // the lines and the expected total, so changing either changes it.
    p_request_hash: await sha256(JSON.stringify({ lines, e: body.expected_total_paise ?? null })),
    p_expected_total_paise: body.expected_total_paise ?? null,
    p_lines: lines,
  });

  if (error) {
    const hint = (error as { hint?: string }).hint ?? '';
    if (hint in REFUSALS) {
      return json(409, { code: hint, message: REFUSALS[hint] });
    }
    // Deliberately not echoed. A Postgres error message can carry ids, column names and
    // occasionally a value — and this body goes to a phone.
    console.error('checkout: unexpected database error', { code: error.code, hint });
    return json(500, { error: 'could not place the order' });
  }

  return json(200, data);
});

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
