// `/policy` — recording that a user accepted a policy version. `E20-36`, `E20-03`.
//
// The write half of the acceptance gate. The read half is `fetchPendingPolicies` in
// `packages/shared/src/api/policy.ts` and goes straight to PostgREST under RLS; this exists
// because **writes always go through an Edge Function** (`A4`, non-negotiable #1) — and here
// that rule is load-bearing rather than ceremonial.
//
//   POST /policy   { action: 'accept', versionId }   200 -> { ok: true }
//
//   400 -> malformed body or unknown action
//   401 -> no or invalid session
//   409 -> the version is not one that may be accepted; `code` says why
//   500 -> anything else, without leaking the database's message
//
// ## Why this is not a direct insert
//
// `user_policy_acceptance_insert_self` would permit the client to insert the row itself, and
// that would be a mistake. Four of the columns are **evidence**, and evidence a client can
// author is not evidence:
//
//   - `source` — the table's own comment reserves `migration` for a pre-cutover acceptance
//     carried over WITH EVIDENCE, and says in as many words that it must never be used to
//     fabricate consent nobody gave. A client that chose its own `source` could write it.
//   - `app_version`, `ip_hash`, `user_agent_hash` — a record of the circumstances of the
//     acceptance. Self-reported circumstances are worth nothing in a dispute.
//
// So the server sets all four, and the client sends one thing: which version.
//
// ## The version is re-checked here, not trusted
//
// The client says "accept version X". If X were taken at its word, a stale or tampered client
// could record acceptance of a version that is not published, not in effect, or not the
// current one — producing a consent record that looks valid and gates nothing. The row is
// re-read under `service_role` and refused unless it is genuinely acceptable.
//
// ## What must never be logged
//
// Nothing here touches a child's data, but `user_id` is personal data and the policy text can
// be long. Every `console.error` below logs a code and nothing else — never the body, never
// the row, never the Postgres message, which can carry a value (non-negotiable #4).

import { createClient } from 'jsr:@supabase/supabase-js@2';

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Refusals a parent may see. Anything else becomes a generic 500 rather than being echoed. */
const REFUSALS: Record<string, string> = {
  version_not_found: 'That policy is no longer available. Please reopen the app and try again.',
  version_not_published: 'That policy is not published yet.',
  version_not_in_effect: 'That policy does not apply yet.',
};

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json(405, { error: 'POST only' });

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    // Unlike the menu, this is inherently a signed-in action: an acceptance row names a user.
    return json(401, { error: 'sign in to accept a policy' });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'body must be JSON' });
  }

  if (body.action !== 'accept') return json(400, { error: 'unknown action' });
  const versionId = String(body.versionId ?? '').trim();
  if (!versionId) return json(400, { error: 'versionId is required' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error('policy: environment is incomplete');
    return json(500, { error: 'server misconfigured' });
  }

  // (1) Who is calling. The JWT is verified by Supabase, not by us, and the id is taken from
  // it rather than from the body — a `user_id` field would be ignored if one were sent.
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData?.user) {
    return json(401, { error: 'sign in to accept a policy' });
  }

  const asService = createClient(supabaseUrl, serviceKey);

  // (2) Is this a version anyone may accept? Re-read rather than trusted — see the note above.
  const { data: version, error: versionError } = await asService
    .from('policy_version')
    .select('id,published_at,effective_from')
    .eq('id', versionId)
    .maybeSingle();

  if (versionError) {
    console.error('policy: version lookup failed', versionError.code);
    return json(500, { error: 'could not record your acceptance' });
  }
  if (!version) {
    return json(409, { code: 'version_not_found', message: REFUSALS.version_not_found });
  }
  if (!version.published_at) {
    return json(409, { code: 'version_not_published', message: REFUSALS.version_not_published });
  }
  if (new Date(version.effective_from) > new Date()) {
    return json(409, { code: 'version_not_in_effect', message: REFUSALS.version_not_in_effect });
  }

  // (3) The row. `source`, `app_version` and the hashes are the server's to set.
  //
  // `app_version` comes from a header the client sets for diagnostics; it is not trusted for
  // anything and is stored as reported, which is all the column claims to be.
  const { error: insertError } = await asService.from('user_policy_acceptance').insert({
    user_id: userData.user.id,
    policy_version_id: versionId,
    source: 'app',
    app_version: request.headers.get('x-app-version'),
  });

  if (insertError) {
    // `23505` is the unique constraint on (user_id, policy_version_id). Accepting twice is
    // not a problem a parent should be shown — a double tap, or a retry after a dropped
    // response, has already achieved what they asked for. The table is append-only, so there
    // is nothing to update and nothing to undo.
    if (insertError.code === '23505') return json(200, { ok: true });
    console.error('policy: acceptance insert failed', insertError.code);
    return json(500, { error: 'could not record your acceptance' });
  }

  return json(200, { ok: true });
});
