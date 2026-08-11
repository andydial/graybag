// `/recipients` — adding a child, and moving one to another school. `E05-01`, `E05-02`,
// `E20-02`.
//
// A shell, like `checkout`. Every guard, every consent write and the atomicity live in
// `create_recipient()` (migration `0015`) and `change_recipient_school()` (`0016`), in one
// transaction each, where the checks and the writes see the same snapshot. This file owns
// the HTTP shape and the one thing that cannot live in SQL: **establishing who the caller
// is.**
//
// ## The two clients, and why there are two
//
// Both functions take the guardian's id as a parameter and run as `service_role`, so
// whoever calls them can create children for anybody. The identity is therefore proved
// *before* that call, from the caller's own JWT, and never taken from the request body —
// the same shape `checkout` set, and for the same reason.
//
// A body field named `guardian_user_id` is ignored if present. There is no code path that
// reads one.
//
//   POST  /recipients            add a child        201 -> { recipient_id, … }
//   PATCH /recipients/:id        change the school  200 -> { recipient_id, changed_school, … }
//
//   400 -> malformed body
//   401 -> no or invalid session
//   409 -> a guard refused; `code` says which  { code, message }
//   500 -> anything else, without leaking the database's message
//
// ## The thing to be most careful about in this file
//
// **A child's name, class, section and allergies pass through here, and none of them may
// reach a log line** (non-negotiable #4, DPDP §11.5). Every `console.error` below logs the
// error's `code` and `hint` and nothing else — never the body, never the row, never the
// Postgres message, which can carry a value. The refusal strings name a condition, never a
// child.
//
// This is also why consent is not a separate call. The client cannot write the child first
// and the consent second: `create_recipient` does both or neither, so a network failure
// between two requests cannot leave a child in the database whose details nobody agreed to
// us holding.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * Guard hints, mapped to what a parent reads. Anything not in this map becomes a generic
 * 500 rather than being echoed.
 *
 * `allergen_consent_required` is the one worth reading twice: the server refuses rather
 * than dropping the allergies, because a parent who typed "peanut" and had it silently
 * discarded would believe the kitchen knows.
 */
const REFUSALS: Record<string, string> = {
  first_name_required: 'Please enter your child’s first name.',
  school_unavailable: 'GrayBag is not serving that school yet.',
  allergen_consent_required:
    'To store allergy details we need your permission on the allergies question.',
  no_notice_published: 'We cannot add a child just now. Please try again shortly.',
  recipient_not_found: 'That child is no longer available.',
  first_name_required: 'A first name is needed.',
  future_orders_exist:
    'There are orders for this child that have not been delivered yet. Cancel those days first, then change the school.',
};

Deno.serve(async (request: Request) => {
  const method = request.method;
  if (method !== 'POST' && method !== 'PATCH' && method !== 'DELETE') {
    return json(405, { error: 'POST, PATCH or DELETE only' });
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    // `AR7`: the menu and the cart are browsable signed out. A child is not — there is
    // nobody for the consent record to name.
    return json(401, { error: 'sign in to add a child' });
  }

  // DELETE carries no body — the id is in the path. Requiring one would be ceremony.
  let body: Record<string, unknown> = {};
  if (method !== 'DELETE') {
    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'body must be JSON' });
    }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error('recipients: environment is incomplete');
    return json(500, { error: 'server misconfigured' });
  }

  // (1) Who is calling. The JWT is verified by Supabase, not by us.
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await asCaller.auth.getUser();
  if (userError || !userData?.user) {
    return json(401, { error: 'sign in to add a child' });
  }

  const asService = createClient(supabaseUrl, serviceKey);

  if (method === 'POST') {
    const schoolId = String(body.school_id ?? '').trim();
    if (!schoolId) return json(400, { error: 'school_id is required' });

    // The consent flags are read as strict booleans rather than for truthiness. `"false"`
    // is a truthy string, and a parent who declined the allergies question must not have
    // that read as agreement because the client sent the wrong type.
    const allergenConsent = body.allergen_consent === true;
    const consentGranted = body.consent_granted === true;
    if (!consentGranted) {
      // The required purpose. There is no "add the child now and ask later" path: the row
      // and the consent are written in one transaction precisely so this cannot happen.
      return json(409, {
        code: 'consent_required',
        message:
          'We need your permission to use your child’s details before we can add them.',
      });
    }

    const { data, error } = await asService.rpc('create_recipient', {
      p_guardian_user_id: userData.user.id,
      p_first_name: body.first_name ?? '',
      p_last_name: body.last_name ?? null,
      p_school_id: schoolId,
      p_class_label: body.class_label ?? null,
      p_section_label: body.section_label ?? null,
      p_allergen_ids: Array.isArray(body.allergen_ids) ? body.allergen_ids : [],
      p_allergy_note: body.allergy_note ?? null,
      p_allergen_consent: allergenConsent,
      // Screen, app version and the id of the wording shown — never the child (§11.5).
      p_capture_context: {
        screen: String(body.screen ?? 'add-child'),
        app_version: String(body.app_version ?? 'unknown'),
      },
    });

    return respond(error, () => json(201, data), 'create_recipient');
  }

  // PATCH — the recipient id comes from the path, not the body, so a client cannot send one
  // id in the URL and a different one in the payload and leave it ambiguous which won.
  const recipientId = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
  if (!recipientId || recipientId === 'recipients') {
    return json(400, { error: 'recipient id is required in the path' });
  }

  /**
   * Removal — `E05-44`. Deactivates the recipient and revokes every guardian link.
   *
   * Not a DPDP erasure: order history, invoices and ledger entries are retained deliberately
   * (see `0025`). Erasure is `E20-06` and has its own process.
   */
  if (method === 'DELETE') {
    const { data, error } = await asService.rpc('deactivate_recipient', {
      p_guardian_user_id: userData.user.id,
      p_recipient_id: recipientId,
    });
    return respond(error, () => json(200, data), 'deactivate_recipient');
  }

  /**
   * PATCH does two different things, told apart by whether a school was named.
   *
   * With `school_id` it is a move, which has a future-order guard and a class reset. Without
   * one it is a correction — a mistyped section, a new class in July — and those must not have
   * to pretend to be a school move to get through, which is the only route that existed.
   */
  const schoolId = String(body.school_id ?? '').trim();
  if (!schoolId) {
    const { data, error } = await asService.rpc('update_recipient_details', {
      p_guardian_user_id: userData.user.id,
      p_recipient_id: recipientId,
      p_first_name: body.first_name ?? null,
      p_last_name: body.last_name ?? null,
      p_class_label: body.class_label ?? null,
      p_section_label: body.section_label ?? null,
      // Explicit, because null already means "leave alone" and a parent has to be able to
      // remove a section they added by mistake.
      p_clear_section: body.clear_section === true,
      p_clear_last_name: body.clear_last_name === true,
    });
    return respond(error, () => json(200, data), 'update_recipient_details');
  }

  const { data, error } = await asService.rpc('change_recipient_school', {
    p_guardian_user_id: userData.user.id,
    p_recipient_id: recipientId,
    p_school_id: schoolId,
    p_class_label: body.class_label ?? null,
    p_section_label: body.section_label ?? null,
  });

  return respond(error, () => json(200, data), 'change_recipient_school');
});

/**
 * Turn a database error into a response, or hand back the success.
 *
 * Shared so the two branches cannot drift on the one thing that must not drift: what
 * reaches the log. `code` and `hint` only — a Postgres message can carry a value, and the
 * values in this endpoint are a child's name and their allergies.
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

  console.error(`recipients: unexpected database error in ${operation}`, {
    code: error.code,
    hint,
  });
  return json(500, { error: 'could not save that just now' });
}
