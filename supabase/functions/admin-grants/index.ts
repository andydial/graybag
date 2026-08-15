// `admin-grants` — granting and revoking back-office access. `E10-27`.
//
//   POST /functions/v1/admin-grants
//     { grant:  { userId, permissionCode, scopeType, scopeId? } }
//     { revoke: { grantId, reason? } }
//
//     200 { granted: {...} } | { revoked: {...} }
//     401 not_authenticated
//     403 not_permitted           needs grants.manage at platform
//     404 unknown_user / unknown_permission / unknown_grant
//     409 already_held            the grant exists and is live
//     422 validation_failed       { fields: { … } }
//     405 method_not_allowed
//
// ## Why this has to be an Edge Function
//
// `permission_grant` has **read** policies and no write policy at all (`0002`), which is
// deliberate: authorization is default-deny (non-negotiable #2), and a table that grants access
// must not be writable by the thing whose access it grants. So the write runs as the service role
// here, behind an explicit `grants.manage` check.
//
// ## The three rails
//
// **1. Nobody edits their own access.** Not even the platform owner. Self-service escalation is
// the failure this table exists to make impossible, and the one case where "I am the only
// operator" is exactly the argument that should not work — an account that can widen itself makes
// every other check advisory. Bootstrapping is `scripts/grant-operator.mjs`, run by a human with
// the database password, which is a meaningfully different act.
//
// **2. The customer persona is untouchable.** Any `+parent@` address is refused, because
// `authorization.test.sql` proves parent RLS restricts by asserting that account holds nothing.
// One grant would break the proof and the test guarding it at the same moment.
//
// **3. Scope shape is enforced, not assumed.** `platform` means a null `scope_id` and anything
// else means a non-null one — the same biconditional `0001` puts on the table. Sent the wrong
// way round, a school-scoped grant with a null scope would silently mean *every* school.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, preflight } from '../_shared/cors.ts';

const CORS = corsHeaders('POST');

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPES = ['platform', 'city', 'kitchen', 'school'];
const PROTECTED_ACCOUNT = /\+parent@/i;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

Deno.serve(async (request: Request): Promise<Response> => {
  const pre = preflight(request, CORS);
  if (pre) return pre;

  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const authHeader = request.headers.get('Authorization') ?? '';
  const anon = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userError } = await anon.auth.getUser();
  const actor = userData?.user;
  if (userError || !actor) return json(401, { error: 'not_authenticated' });

  let body: { grant?: Record<string, unknown>; revoke?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'malformed_body' });
  }

  // Read through the caller's own client, so RLS decides what they can see. The check is on the
  // platform-scoped grant specifically: `grants.manage` is platform-only in the catalogue.
  const { data: mine, error: grantError } = await anon
    .from('permission_grant')
    .select('permission_code,scope_type')
    .is('revoked_at', null);
  if (grantError) {
    console.error('grant read failed', grantError.code);
    return json(500, { error: 'internal' });
  }
  const canManage = (mine ?? []).some(
    (g: { permission_code: string; scope_type: string }) =>
      g.permission_code === 'grants.manage' && g.scope_type === 'platform',
  );
  if (!canManage) return json(403, { error: 'not_permitted', requires: 'grants.manage' });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  // ------------------------------------------------------------------------------- revoke
  if (body.revoke) {
    const grantId = str(body.revoke.grantId);
    if (!grantId || !UUID.test(grantId)) {
      return json(422, { error: 'validation_failed', fields: { grantId: 'required, and a uuid' } });
    }

    const { data: row } = await admin
      .from('permission_grant')
      .select('id,user_id,permission_code,revoked_at')
      .eq('id', grantId)
      .maybeSingle();
    if (!row) return json(404, { error: 'unknown_grant', grantId });
    if (row.revoked_at !== null) {
      // Not an error worth failing on — the end state is the one asked for — but reported as a
      // no-op rather than as a fresh revocation, so an audit trail is not written twice.
      return json(200, { revoked: { grantId, alreadyRevoked: true } });
    }
    if (row.user_id === actor.id) {
      return json(403, {
        error: 'not_permitted',
        detail:
          'You cannot change your own access, including removing it. Use ' +
          'scripts/grant-operator.mjs, which needs the database password.',
      });
    }

    const { error } = await admin
      .from('permission_grant')
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by_user_id: actor.id,
        revoke_reason: str(body.revoke.reason) ?? 'revoked from /admin/access',
        updated_at: new Date().toISOString(),
      })
      .eq('id', grantId);
    if (error) {
      console.error('revoke failed', error.code);
      return json(500, { error: 'internal' });
    }
    return json(200, { revoked: { grantId, permissionCode: row.permission_code } });
  }

  // -------------------------------------------------------------------------------- grant
  if (body.grant) {
    const g = body.grant;
    const userId = str(g.userId);
    const permissionCode = str(g.permissionCode);
    const scopeType = str(g.scopeType);
    const scopeId = g.scopeId === null || g.scopeId === undefined ? null : str(g.scopeId);
    const fields: Record<string, string> = {};

    if (!userId || !UUID.test(userId)) fields.userId = 'required, and a uuid';
    if (!permissionCode) fields.permissionCode = 'required';
    if (!scopeType || !SCOPES.includes(scopeType)) {
      fields.scopeType = `must be one of: ${SCOPES.join(', ')}`;
    }
    // The biconditional from `0001`. Without it a school-scoped grant with a null scope silently
    // means every school — the widest possible reading of the narrowest-looking grant.
    if (scopeType === 'platform' && scopeId !== null) {
      fields.scopeId = 'a platform grant covers everything, so it must not name a scope';
    }
    if (scopeType && scopeType !== 'platform' && scopeId === null) {
      fields.scopeId = `a ${scopeType} grant must name the ${scopeType} it applies to`;
    }
    if (scopeId !== null && !UUID.test(scopeId)) fields.scopeId = 'must be a uuid';
    if (Object.keys(fields).length > 0) return json(422, { error: 'validation_failed', fields });

    if (userId === actor.id) {
      return json(403, {
        error: 'not_permitted',
        detail:
          'You cannot grant yourself anything. An account that can widen its own access makes ' +
          'every other check advisory. Use scripts/grant-operator.mjs, which needs the database ' +
          'password.',
      });
    }

    const { data: target } = await admin
      .from('app_user')
      .select('id,email,deleted_at')
      .eq('id', userId)
      .maybeSingle();
    if (!target || target.deleted_at !== null) return json(404, { error: 'unknown_user', userId });

    if (PROTECTED_ACCOUNT.test(target.email ?? '')) {
      return json(403, {
        error: 'not_permitted',
        detail:
          `${target.email} is the customer persona. It proves parent RLS actually restricts, and ` +
          'authorization.test.sql fails if it holds a grant — granting it anything would break ' +
          'the proof and the test guarding the proof at the same moment.',
      });
    }

    const { data: permission } = await admin
      .from('permission')
      .select('code,valid_scope_types,is_active')
      .eq('code', permissionCode)
      .maybeSingle();
    if (!permission || permission.is_active === false) {
      return json(404, { error: 'unknown_permission', permissionCode });
    }
    if (!(permission.valid_scope_types ?? []).includes(scopeType)) {
      return json(422, {
        error: 'validation_failed',
        fields: {
          scopeType:
            `${permissionCode} cannot be held at ${scopeType} scope. It allows: ` +
            `${(permission.valid_scope_types ?? []).join(', ')}`,
        },
      });
    }

    // The partial unique index would reject this anyway; caught here so the reply says what
    // happened rather than surfacing a constraint name.
    const { data: existing } = await admin
      .from('permission_grant')
      .select('id')
      .eq('user_id', userId)
      .eq('permission_code', permissionCode)
      .eq('scope_type', scopeType)
      .is('revoked_at', null)
      .maybeSingle();
    if (existing) return json(409, { error: 'already_held', grantId: existing.id });

    const { data: created, error } = await admin
      .from('permission_grant')
      .insert({
        user_id: userId,
        permission_code: permissionCode,
        scope_type: scopeType,
        scope_id: scopeId,
        granted_by_user_id: actor.id,
      })
      .select('id')
      .single();
    if (error) {
      console.error('grant failed', error.code);
      return json(500, { error: 'internal' });
    }
    return json(200, { granted: { grantId: created.id, permissionCode, scopeType } });
  }

  return json(422, { error: 'validation_failed', fields: { body: 'send a grant or a revoke' } });
});
