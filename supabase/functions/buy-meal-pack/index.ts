// POST /buy-meal-pack — start a pack purchase. `E21-48`.
//
// A shell, like `checkout`. Everything with consequences lives in `start_meal_pack_purchase()` in
// migration `0077`: the offer must be active, the school must be switched on, the tax is stamped
// from config, and the group's totals are verified against the pack at COMMIT.
//
// ## It does not take payment
//
// It returns an `order_group_id`, and the app then calls `payments-create-order` with it —
// **exactly as a food order does**. Andy chose that over a second payment path: *"duplicating the
// payment path means duplicating settlement, the webhook, the drain and reconciliation."* So there
// is no Razorpay code in this file at all, and the pack becomes spendable in `settle_payment`.
//
//   200 -> { order_group_id, meal_pack_id, payable_paise, replayed }
//   400 -> malformed body, or no Idempotency-Key
//   401 -> no or invalid session
//   409 -> a guard refused; `code` says which
//   500 -> anything else, without leaking the database's message

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, preflight } from '../_shared/cors.ts';

const CORS = corsHeaders('POST');

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

const REFUSALS: Record<string, string> = {
  unknown_offer: 'That pack is no longer available.',
  offer_not_active: 'That pack is not on sale.',
  not_offered_here: 'Meal packs aren’t offered at this school.',
};

Deno.serve(async (request: Request) => {
  const pre = preflight(request, CORS);
  if (pre) return pre;

  if (request.method !== 'POST') return json(405, { error: 'POST only' });

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return json(401, { error: 'sign in to buy a pack' });
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
    // Without one, a retry after a timeout is a second pack — and a second charge. The server
    // cannot invent a key, because it would differ per attempt and defeat the point.
    return json(400, { error: 'Idempotency-Key is required' });
  }

  const offerId = String(body.offer_id ?? '').trim();
  const schoolId = String(body.school_id ?? '').trim();
  if (!offerId || !schoolId) {
    return json(400, { error: 'offer_id and school_id are required' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error('buy-meal-pack: environment is incomplete');
    return json(500, { error: 'server misconfigured' });
  }

  // (1) Who is calling. The JWT is verified by Supabase, not by us.
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData?.user) {
    return json(401, { error: 'sign in to buy a pack' });
  }

  // (2) The one privileged call, with the id from (1) and never from the body.
  const asService = createClient(supabaseUrl, serviceKey);
  const { data, error } = await asService.rpc('start_meal_pack_purchase', {
    p_user_id: userData.user.id,
    p_offer_id: offerId,
    p_school_id: schoolId,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    const hint = typeof error.hint === 'string' ? error.hint : '';
    const known = REFUSALS[hint];
    if (known !== undefined) return json(409, { code: hint, message: known });
    console.error('buy-meal-pack: unexpected failure', { code: error.code, hint });
    return json(500, { error: 'we could not start that purchase' });
  }

  return json(200, data);
});
