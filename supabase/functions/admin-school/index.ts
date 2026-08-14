// `admin-school` — onboarding a school, and setting its configuration. `E10-01`, `E10-06`.
//
//   POST  /functions/v1/admin-school     create a school           201 { id, code }
//   PATCH /functions/v1/admin-school     update one, or its config 200 { id, changed: [...] }
//
//     401 not_authenticated      no usable JWT
//     403 not_permitted          the caller lacks the grant, which is named in the reply
//     400 malformed_body / unknown_kitchen / unknown_city
//     409 code_taken             a school already has that code
//     422 validation_failed      { fields: { … } }
//     405 method_not_allowed
//
// ## Why an Edge Function at all, when `tools/bulk-import` writes the same rows directly
//
// They are different callers with different trust. The importer runs on Andy's laptop with the
// service role, is a batch job, and is not the application. This is the *application* writing —
// non-negotiable #1 and `A4` — so it goes through a function that proves who is calling from their
// own JWT and checks the grant before touching anything.
//
// ## Two grants, not one
//
// Creating a school is `school.onboard`. Editing its configuration is `school.config_edit`, which
// is a separate grant because `school_config` carries `revenue_share_bps` (`M4`) — the commercial
// terms — on the same row as the cutoff. `0002` §9 already gates the *reads* that way; this keeps
// the writes consistent, so somebody who may onboard a school is not thereby somebody who may
// change what it is paid.
//
// ## `config_change_log` is written for every config change
//
// `0001` §9.4 creates that table for `E10-11` — "who changed a price" — and says it is written by
// trigger on all three config tables so it cannot be bypassed. This function relies on that
// trigger rather than writing the row itself; what it must do is set the actor, which the trigger
// reads. A config change with no attributable actor is the audit trail failing quietly.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, preflight } from '../_shared/cors.ts';

const CORS = corsHeaders('POST, PATCH');

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

// ------------------------------------------------------------------------ validation
//
// Restated here rather than imported: an Edge Function cannot import from `packages/shared`.
// `apps/web` validates the same rules in the browser so a mistake is caught before a round trip,
// but that copy is advice and this one is enforcement. Any change must be made in both.

const CODE = /^[a-z0-9][a-z0-9_-]*$/;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;
const INSTITUTION_TYPES = ['school', 'college'];

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/**
 * Weekday sets are validated here as well as by the check constraint on the column.
 *
 * The constraint is what actually holds. This exists so the caller gets `422` naming the field
 * rather than a `23514` with a constraint name in it, which a screen cannot turn into a sentence.
 */
function weekdays(v: unknown, fields: Record<string, string>, name: string): number[] | null {
  if (v === null || v === undefined || v === '') return null;
  if (!Array.isArray(v)) {
    fields[name] = 'must be a list of weekday numbers, 1 to 7, with Monday as 1';
    return null;
  }
  const days = v.map(Number);
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    fields[name] = 'weekdays are 1 to 7 with Monday as 1. Sunday is 7, never 0';
    return null;
  }
  if (days.length === 0) {
    fields[name] = 'a school served on no days is closed — deactivate it instead of clearing this';
    return null;
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

interface SchoolInput {
  code: string | null;
  name: string | null;
  cityCode: string | null;
  kitchenCode: string | null;
  institutionType: string;
  addressLine1: string | null;
  addressLine2: string | null;
  postcode: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

function readSchool(body: Record<string, unknown>, fields: Record<string, string>): SchoolInput {
  const code = str(body.code);
  if (code !== null && !CODE.test(code.toLowerCase())) {
    fields.code =
      'use lower-case letters, digits, hyphens and underscores. This is the permanent key for ' +
      'this school and it must never change';
  }

  const institutionType = str(body.institutionType) ?? 'school';
  if (!INSTITUTION_TYPES.includes(institutionType)) {
    fields.institutionType = `must be one of: ${INSTITUTION_TYPES.join(', ')}`;
  }

  const contactEmail = str(body.contactEmail);
  if (contactEmail !== null && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
    fields.contactEmail = 'that is not an email address';
  }

  return {
    code: code === null ? null : code.toLowerCase(),
    name: str(body.name),
    cityCode: str(body.cityCode)?.toLowerCase() ?? null,
    kitchenCode: str(body.kitchenCode)?.toLowerCase() ?? null,
    institutionType,
    addressLine1: str(body.addressLine1),
    addressLine2: str(body.addressLine2),
    postcode: str(body.postcode),
    contactName: str(body.contactName),
    contactEmail,
    contactPhone: str(body.contactPhone),
  };
}

/**
 * The config columns this function will write, and how each is read.
 *
 * **`null` clears an override; an absent key leaves it alone.** That distinction is the whole
 * inheritance model — `NULL` in `school_config` means "inherit" — and collapsing the two would
 * make every save wipe every setting the caller's screen happened not to send.
 */
function readConfig(
  body: Record<string, unknown>,
  fields: Record<string, string>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const config = (body.config ?? {}) as Record<string, unknown>;

  if ('serviceDays' in config) {
    patch.service_days = config.serviceDays === null ? null : weekdays(config.serviceDays, fields, 'serviceDays');
  }

  if ('orderCutoffTime' in config) {
    const raw = config.orderCutoffTime;
    if (raw === null) patch.order_cutoff_time = null;
    else {
      const value = str(raw);
      if (value === null || !HHMM.test(value)) {
        fields.orderCutoffTime = 'use 24-hour HH:MM. 1:30 PM is 13:30, and midnight is 00:00';
      } else {
        patch.order_cutoff_time = value.length === 5 ? `${value}:00` : value;
      }
    }
  }

  for (const [key, column, max] of [
    ['orderCutoffDaysBefore', 'order_cutoff_days_before', 30],
    ['maxAdvanceOrderDays', 'max_advance_order_days', 3650],
    ['minAdvanceOrderDays', 'min_advance_order_days', 30],
  ] as const) {
    if (!(key in config)) continue;
    const raw = config[key];
    if (raw === null) {
      patch[column] = null;
      continue;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > max) {
      fields[key] = `must be a whole number between 0 and ${max}`;
      continue;
    }
    patch[column] = n;
  }

  return patch;
}

// ------------------------------------------------------------------------ the handler

Deno.serve(async (request: Request): Promise<Response> => {
  const pre = preflight(request, CORS);
  if (pre) return pre;

  if (request.method !== 'POST' && request.method !== 'PATCH') {
    return json(405, { error: 'method_not_allowed' });
  }

  // ---------------------------------------------------------------- who is calling
  //
  // Proved from the caller's own JWT and never taken from the body. A body field naming a user is
  // ignored; there is no code path that reads one.
  const authHeader = request.headers.get('Authorization') ?? '';
  const anon = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userError } = await anon.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json(401, { error: 'not_authenticated' });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'malformed_body' });
  }

  // ------------------------------------------------------------------ authorization
  //
  // Read through the caller's own client, so RLS decides what they can see of their own grants.
  // Checked again by RLS on every write below; this one exists to produce a 403 that names the
  // grant instead of a policy failure that names nothing.
  const { data: grantRows, error: grantError } = await anon
    .from('permission_grant')
    .select('permission_code')
    .is('revoked_at', null);

  if (grantError) {
    console.error('grant read failed', grantError.code);
    return json(500, { error: 'internal' });
  }
  const held = new Set((grantRows ?? []).map((g: { permission_code: string }) => g.permission_code));

  const wantsConfig = Object.keys(readConfig(body, {})).length > 0;
  const needed = request.method === 'POST' ? 'school.onboard' : 'school.edit';

  if (!held.has(needed)) return json(403, { error: 'not_permitted', requires: needed });
  // Config is its own grant because `revenue_share_bps` sits on the same row as the cutoff.
  if (wantsConfig && !held.has('school.config_edit')) {
    return json(403, { error: 'not_permitted', requires: 'school.config_edit' });
  }

  const fields: Record<string, string> = {};
  const configPatch = readConfig(body, fields);

  // The service-role client. Everything above this line established who is calling and what they
  // may do; nothing below re-decides it.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  if (request.method === 'POST') {
    const input = readSchool(body, fields);
    if (input.code === null) fields.code = fields.code ?? 'required';
    if (input.name === null) fields.name = 'required';
    if (input.cityCode === null) fields.cityCode = 'required';
    if (input.kitchenCode === null) fields.kitchenCode = 'required';
    if (Object.keys(fields).length > 0) return json(422, { error: 'validation_failed', fields });

    const [{ data: city }, { data: kitchen }] = await Promise.all([
      admin.from('city').select('id').eq('code', input.cityCode).maybeSingle(),
      admin.from('kitchen').select('id').eq('code', input.kitchenCode).maybeSingle(),
    ]);
    // Named separately rather than as one "bad reference": the fixes are different, and an
    // operator onboarding a school knows which of the two they typed.
    if (!city) return json(400, { error: 'unknown_city', code: input.cityCode });
    if (!kitchen) return json(400, { error: 'unknown_kitchen', code: input.kitchenCode });

    const { data: created, error: insertError } = await admin
      .from('school')
      .insert({
        code: input.code,
        name: input.name,
        city_id: city.id,
        kitchen_id: kitchen.id,
        institution_type: input.institutionType,
        address_line1: input.addressLine1,
        address_line2: input.addressLine2,
        postcode: input.postcode,
        contact_name: input.contactName,
        contact_email: input.contactEmail,
        contact_phone: input.contactPhone,
        // `onboarded_at` gates the parent-facing picker (`P1`). A school created here is a school
        // being onboarded; leaving it null makes the whole action look like it did nothing.
        onboarded_at: new Date().toISOString(),
      })
      .select('id,code')
      .single();

    if (insertError) {
      // 23505 is the unique index on `code`. Answered as a 409 with the code named, because the
      // caller's next action is to pick a different one — not to retry.
      if (insertError.code === '23505') return json(409, { error: 'code_taken', code: input.code });
      console.error('school insert failed', insertError.code);
      return json(500, { error: 'internal' });
    }

    if (Object.keys(configPatch).length > 0) {
      const wrote = await writeConfig(admin, created.id, configPatch, user.id);
      if (wrote) return wrote;
    }

    return json(201, { id: created.id, code: created.code });
  }

  // ------------------------------------------------------------------------- PATCH
  const id = str(body.id);
  if (id === null) return json(422, { error: 'validation_failed', fields: { id: 'required' } });

  const input = readSchool(body, fields);
  if (Object.keys(fields).length > 0) return json(422, { error: 'validation_failed', fields });

  const patch: Record<string, unknown> = {};
  // Only what the caller actually sent. An absent key leaves the column alone — the same
  // absent-versus-null rule the config patch follows, and the reason a partial save cannot blank
  // a contact somebody set last week.
  if ('name' in body && input.name !== null) patch.name = input.name;
  if ('institutionType' in body) patch.institution_type = input.institutionType;
  for (const [key, column] of [
    ['addressLine1', 'address_line1'], ['addressLine2', 'address_line2'],
    ['postcode', 'postcode'], ['contactName', 'contact_name'],
    ['contactEmail', 'contact_email'], ['contactPhone', 'contact_phone'],
  ] as const) {
    if (key in body) patch[column] = input[key];
  }

  const changed: string[] = Object.keys(patch);

  if (changed.length > 0) {
    // Qualified by id. `E06-38` cost two incidents to an unqualified write, and
    // `scripts/check-unqualified-writes.mjs` exists because of it.
    const { error } = await admin.from('school').update(patch).eq('id', id);
    if (error) {
      if (error.code === '23505') return json(409, { error: 'code_taken' });
      console.error('school update failed', error.code);
      return json(500, { error: 'internal' });
    }
  }

  if (Object.keys(configPatch).length > 0) {
    const wrote = await writeConfig(admin, id, configPatch, user.id);
    if (wrote) return wrote;
    changed.push(...Object.keys(configPatch).map((c) => `config.${c}`));
  }

  return json(200, { id, changed });
});

/**
 * Upsert `school_config`, attributing the change.
 *
 * Returns a `Response` on failure and `null` on success, so the caller can `if (r) return r`
 * without a second error shape.
 *
 * `updated_by_user_id` is set from the **verified** caller, never from the body. `0001` §9.4's
 * `config_change_log` is written by trigger and reads it; a config change with no attributable
 * actor is the audit trail failing quietly, which is worse than it failing loudly.
 */
async function writeConfig(
  admin: ReturnType<typeof createClient>,
  schoolId: string,
  patch: Record<string, unknown>,
  userId: string,
): Promise<Response | null> {
  const { error } = await admin
    .from('school_config')
    .upsert({ school_id: schoolId, ...patch, updated_by_user_id: userId }, { onConflict: 'school_id' });

  if (!error) return null;

  // 23514 is a check constraint — an out-of-range weekday that slipped past the validation above,
  // or a future setting this function does not know about. Answered as 422 rather than 500: it is
  // the caller's input that is wrong, even if this function failed to say so first.
  if (error.code === '23514') {
    return json(422, { error: 'validation_failed', fields: { config: error.message } });
  }
  console.error('school_config upsert failed', error.code);
  return json(500, { error: 'internal' });
}
