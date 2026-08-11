// `/account` — the account holder's own details. `P18`, `E05-39`.
//
// One thing today: their name, and the record that we asked for it. A shell like `recipients`
// and `checkout` — the rules live in `set_user_name()` and `skip_user_name_prompt()`
// (migration `0030`), and this file owns the HTTP shape and the one thing that cannot live in
// SQL: **establishing who the caller is.**
//
// ## Why this exists when RLS already allowed the write
//
// `app_user_update_self` (`0002`) has always let a user update their own row, so the app could
// have written the name directly. Non-negotiable #1 is why it does not: **every write goes
// through an Edge Function.** That rule is what keeps "put a real API server in front of this
// later" a config change rather than a rewrite, and a name field is exactly the sort of small,
// obviously-safe write that erodes it one exception at a time.
//
//   PATCH /account   { first_name, last_name? }   200 -> { first_name, last_name, prompted }
//   PATCH /account   { skip_name_prompt: true }   200 -> { prompted }
//   PATCH /account   { clear_name: true }         200 -> { first_name: null, … }
//
//   400 -> malformed body
//   401 -> no or invalid session
//   409 -> a guard refused; `code` says which
//   500 -> anything else, without leaking the database's message
//
// ## The user id is never read from the body
//
// Both RPCs are `security definer` and take the id as a parameter, so whoever calls them can
// act on any account. The id comes from the verified JWT and nowhere else; a body field named
// `user_id` is ignored, and there is no code path that reads one.
//
// ## What may be logged here
//
// **A name is tier A personal data** (§13.3) — less regulated than a child's, and still not
// something that belongs in a log line or in Sentry. Every `console.error` below carries the
// error's `code` and `hint` and nothing else, the same rule `recipients` follows.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Guard hints, mapped to what the account holder reads. Anything unmapped becomes a 500. */
const REFUSALS: Record<string, string> = {
  first_name_required: 'Please enter a name, or skip for now.',
  account_not_found: 'We could not find your account. Try signing in again.',
};

Deno.serve(async (request: Request) => {
  if (request.method !== 'PATCH') return json(405, { error: 'PATCH only' });

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return json(401, { error: 'sign in to change your details' });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'body must be JSON' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error('account: environment is incomplete');
    return json(500, { error: 'server misconfigured' });
  }

  // Who is calling. The JWT is verified by Supabase, not by us.
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData?.user) {
    return json(401, { error: 'sign in to change your details' });
  }

  const asService = createClient(supabaseUrl, serviceKey);

  // Strictly `=== true`, like every other flag that crosses this boundary: `"false"` is a
  // truthy string, and a skip read out of a mistyped field would silently discard a name
  // somebody typed.
  if (body.skip_name_prompt === true) {
    const { data, error } = await asService.rpc('skip_user_name_prompt', {
      p_user_id: userData.user.id,
    });
    return respond(error, () => json(200, data), 'skip_user_name_prompt');
  }

  // Taking a name back. A separate flag rather than an empty `first_name`, because
  // `set_user_name` refuses a blank one on purpose — "you may not save an empty name" and
  // "you may not remove the name you gave" are different rules, and a client sending "" would
  // otherwise be indistinguishable from a form somebody tabbed past.
  if (body.clear_name === true) {
    const { data, error } = await asService.rpc('clear_user_name', {
      p_user_id: userData.user.id,
    });
    return respond(error, () => json(200, data), 'clear_user_name');
  }

  const { data, error } = await asService.rpc('set_user_name', {
    p_user_id: userData.user.id,
    p_first_name: body.first_name ?? '',
    p_last_name: body.last_name ?? null,
  });
  return respond(error, () => json(200, data), 'set_user_name');
});

/**
 * A refused guard becomes a 409 with its curated sentence; anything else becomes a 500 with
 * none of the database's own message, which can quote the value it refused.
 */
function respond(
  error: { code?: string; hint?: string } | null,
  ok: () => Response,
  operation: string,
): Response {
  if (!error) return ok();

  const hint = error.hint ?? '';
  if (hint in REFUSALS) {
    return json(409, { code: hint, message: REFUSALS[hint] });
  }

  // The code and the hint, never the message: a Postgres error message can carry the value it
  // refused, and the value here is somebody's name.
  console.error(`account: unexpected database error in ${operation}`, {
    code: error.code,
    hint,
  });
  return json(500, { error: 'could not save that just now' });
}
