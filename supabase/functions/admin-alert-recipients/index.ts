// `admin-alert-recipients` — who is emailed when an order is paid. `E08-16`.
//
//   POST /functions/v1/admin-alert-recipients
//     { add:    { kitchenId, email, label? } }
//     { toggle: { id, isEnabled } }
//     { remove: { id } }
//
//     200 { recipient: {...} } | { removed: { id } }
//     401 not_authenticated
//     403 not_permitted           needs kitchen.edit on that kitchen (or wider)
//     404 unknown_kitchen / unknown_recipient
//     409 already_listed
//     422 validation_failed       { fields: { … } }
//     405 method_not_allowed
//
// ## Why an Edge Function
//
// `kitchen_alert_recipient` has a read policy and **no write policy** (`0066`), like every other
// back-office table here. Writes run as the service role behind an explicit permission check
// (`A4`, non-negotiable #1).
//
// ## Authorisation is per kitchen, and checked against the caller's own grants
//
// `kitchen.edit` at that kitchen, or wider. The check reads the caller's grants through
// their **own** client so RLS decides what they can see, then compares scope explicitly rather
// than trusting a claim in the request — the request names a kitchen, and a request cannot be
// allowed to name a kitchen the caller has no grant on.
//
// Scope widening is honoured the same way the database does it: a `platform` grant satisfies a
// check on any kitchen; a grant on kitchen A does not satisfy a check on kitchen B.
//
// ## Turning off is not removing
//
// `toggle` sets `is_enabled`. `remove` deletes the row. They are separate verbs because they are
// separate decisions — "stop alerting me this week" must not lose the address.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, preflight } from '../_shared/cors.ts';

const CORS = corsHeaders('POST');

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * Deliberately the same shape as the database check in `0066`, not a cleverer one. An address
 * this refuses but the column accepts (or the reverse) is a validation that disagrees with its
 * own storage, and the failure surfaces as a 500 rather than a message about the field.
 */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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

  let body: {
    add?: Record<string, unknown>;
    toggle?: Record<string, unknown>;
    remove?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'malformed_body' });
  }

  const { data: mine, error: grantError } = await anon
    .from('permission_grant')
    .select('permission_code,scope_type,scope_id')
    .is('revoked_at', null);
  if (grantError) {
    console.error('grant read failed', grantError.code);
    return json(500, { error: 'internal' });
  }

  type Grant = { permission_code: string; scope_type: string; scope_id: string | null };
  /** `kitchen.edit` on this kitchen, or at a wider scope. Mirrors `auth_can`. */
  const mayEdit = (kitchenId: string) =>
    (mine ?? []).some((g: Grant) =>
      g.permission_code === 'kitchen.edit' &&
      (g.scope_type === 'platform' ||
        (g.scope_type === 'kitchen' && g.scope_id === kitchenId)),
    );

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  /** The kitchen a recipient row belongs to, so toggle and remove authorise on the real owner. */
  const kitchenOf = async (id: string): Promise<string | null> => {
    const { data } = await admin
      .from('kitchen_alert_recipient')
      .select('kitchen_id')
      .eq('id', id)
      .maybeSingle();
    return (data?.kitchen_id as string | undefined) ?? null;
  };

  // ---------------------------------------------------------------------------------- add
  if (body.add) {
    const kitchenId = str(body.add.kitchenId);
    const email = str(body.add.email)?.toLowerCase() ?? null;
    const label = str(body.add.label);

    const fields: Record<string, string> = {};
    if (!kitchenId || !UUID.test(kitchenId)) fields.kitchenId = 'required, and a uuid';
    if (!email || !EMAIL.test(email)) fields.email = 'required, and an email address';
    if (label && label.length > 80) fields.label = 'at most 80 characters';
    if (Object.keys(fields).length > 0) return json(422, { error: 'validation_failed', fields });

    if (!mayEdit(kitchenId!)) {
      return json(403, { error: 'not_permitted', requires: 'kitchen.edit' });
    }

    const { data: kitchen } = await admin
      .from('kitchen').select('id').eq('id', kitchenId!).maybeSingle();
    if (!kitchen) return json(404, { error: 'unknown_kitchen' });

    const { data: created, error } = await admin
      .from('kitchen_alert_recipient')
      .insert({
        kitchen_id: kitchenId,
        email,
        label,
        created_by_user_id: actor.id,
        is_enabled: true,
      })
      .select('id,kitchen_id,email,label,is_enabled')
      .single();

    if (error) {
      // The unique index is on (kitchen_id, email). Adding somebody already listed is not an
      // error worth a stack trace — it is a person doing the obvious thing twice.
      if (error.code === '23505') return json(409, { error: 'already_listed' });
      console.error('alert recipient insert failed', error.code);
      return json(500, { error: 'internal' });
    }
    return json(200, { recipient: created });
  }

  // ------------------------------------------------------------------------------- toggle
  if (body.toggle) {
    const id = str(body.toggle.id);
    const isEnabled = body.toggle.isEnabled;
    if (!id || !UUID.test(id) || typeof isEnabled !== 'boolean') {
      return json(422, {
        error: 'validation_failed',
        fields: { id: 'required, and a uuid', isEnabled: 'required, and a boolean' },
      });
    }

    const kitchenId = await kitchenOf(id);
    if (!kitchenId) return json(404, { error: 'unknown_recipient' });
    if (!mayEdit(kitchenId)) {
      return json(403, { error: 'not_permitted', requires: 'kitchen.edit' });
    }

    const { data: updated, error } = await admin
      .from('kitchen_alert_recipient')
      .update({ is_enabled: isEnabled, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id,kitchen_id,email,label,is_enabled')
      .single();

    if (error) {
      console.error('alert recipient toggle failed', error.code);
      return json(500, { error: 'internal' });
    }
    return json(200, { recipient: updated });
  }

  // ------------------------------------------------------------------------------- remove
  if (body.remove) {
    const id = str(body.remove.id);
    if (!id || !UUID.test(id)) {
      return json(422, { error: 'validation_failed', fields: { id: 'required, and a uuid' } });
    }

    const kitchenId = await kitchenOf(id);
    if (!kitchenId) return json(404, { error: 'unknown_recipient' });
    if (!mayEdit(kitchenId)) {
      return json(403, { error: 'not_permitted', requires: 'kitchen.edit' });
    }

    const { error } = await admin.from('kitchen_alert_recipient').delete().eq('id', id);
    if (error) {
      console.error('alert recipient delete failed', error.code);
      return json(500, { error: 'internal' });
    }
    return json(200, { removed: { id } });
  }

  return json(422, { error: 'validation_failed', fields: { body: 'one of add, toggle, remove' } });
});
