// `POST /payments-drain` — process anything left in the webhook queue. `E06-37`.
//
// The webhook drains inline after recording, so on a healthy path this finds nothing. It exists
// for the paths that are not healthy, and each of them has already happened once:
//
//   * Razorpay was unreachable when the event arrived, so the row stayed `pending`;
//   * our Razorpay credentials were missing, so the drain deliberately left the queue alone;
//   * `settle_payment` failed — as it did on 2026-08-14, when PostgREST's schema cache predated
//     the migration and the RPC could not see the function at all.
//
// In every one of those the money had already moved. A queue with no reader is how a captured
// payment becomes an order that never existed, so this is the reader of last resort and it is
// meant to be run on a schedule.
//
// ## Not a public endpoint
//
// It settles orders, so it requires a **service-role** JWT and nothing less. No CORS is offered:
// nothing in a browser should ever call this, and advertising a preflight would describe a
// surface that must not exist — the same reasoning that keeps `payments-webhook` off the list.
//
// **Two layers, and the division matters.** Supabase's gateway verifies the token's *signature*
// before this function runs, so a forged token never arrives. What the gateway does not check is
// *which* token: an ordinary signed-in parent's JWT is equally valid to it. So this checks the
// `role` claim, which is the only thing that separates a customer from the service.
//
// It is deliberately not a comparison against `SUPABASE_SERVICE_ROLE_KEY`. That was the first
// implementation and it failed against the real key: Supabase now issues `sb_secret_…` and
// `sb_publishable_…` alongside the legacy JWTs, so "the key" is not one string any more, and an
// equality check silently locks out a caller holding a perfectly valid credential.
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { drainPendingEvents } from '../_shared/settle-from-events.ts';

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

/**
 * The `role` claim, read **without verifying** — the gateway already verified the signature, and
 * re-verifying here would need the JWT secret this function has no business holding.
 *
 * Reading an unverified token is only safe because of that ordering. If this ever runs somewhere
 * the signature is not already checked, this function is wide open.
 */
function roleClaim(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json(405, { error: 'POST only' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('payments-drain: environment is incomplete');
    return json(500, { error: 'server misconfigured' });
  }

  const presented = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (roleClaim(presented) !== 'service_role') {
    return json(401, { error: 'not authorized' });
  }

  const result = await drainPendingEvents(createClient(supabaseUrl, serviceKey), {
    // Bounded so one invocation cannot run past the function's own time limit and be killed
    // mid-settlement. Whatever is left stays `pending` and the next run takes it.
    limit: 50,
    keyId: Deno.env.get('RAZORPAY_KEY_ID') ?? '',
    keySecret: Deno.env.get('RAZORPAY_KEY_SECRET') ?? '',
  });

  console.log(`payments-drain: ${JSON.stringify(result)}`);
  return json(200, result);
});
