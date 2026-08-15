// `admin-import` — applying an import file from the browser. `E10-30`.
//
//   POST /functions/v1/admin-import
//     { kind: 'schools'|'dishes'|'menu'|'breaks', filename, text, apply?: boolean }
//
//     200 { dryRun, changes, errors[], blockers[], report, applied? }
//     401 not_authenticated
//     403 not_permitted        needs menu.import at platform
//     409 refused              errors or blockers — nothing was written, they are in the reply
//     422 validation_failed
//     405 method_not_allowed
//
// ## It runs the CLI's code, not a reimplementation of it
//
// `parse.mjs`, `validate.mjs`, `plan.mjs`, `report.mjs` and `db.mjs` in `tools/bulk-import/src/`
// are imported directly, from here and from the browser and from the command line. That was the
// whole reason `connect.mjs` was split out in `E10-29`: with the service-role client gone, `db.mjs`
// imports nothing and its `apply*` functions take the client as an argument, so the same functions
// that ran the 17th's import run here.
//
// A second implementation would be worse than no Apply button. The failure it invites is not a
// crash — it is the browser writing something subtly different from what the dry run promised, on
// the tables the entire product sits on.
//
// ## The server re-plans; it never trusts a plan from the client
//
// The browser sends the **file**, not its own plan. This parses, validates and plans again, and
// the result of *that* is what gets applied. The dry run the operator read is a preview computed
// the same way — but a client-supplied plan would be an arbitrary write request wearing the shape
// of an audit trail.
//
// ## Refuses on any error or blocker
//
// Exactly as `cli.mjs` does. A partial import across schools, dishes and menus is the state
// nobody can reason about afterwards, and `--apply` on a file with blockers is refused there too.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, preflight } from '../_shared/cors.ts';

import { ParseError, parseFile } from '../../../tools/bulk-import/src/parse.mjs';
import {
  validateBreakTimes, validateDishes, validateMenuItems, validateSchools,
} from '../../../tools/bulk-import/src/validate.mjs';
import {
  planBreakTimes, planDishes, planMenus, planSchools,
} from '../../../tools/bulk-import/src/plan.mjs';
import {
  renderBlockers, renderBreakPlan, renderDishPlan, renderErrors, renderMenuPlan,
  renderSchoolPlan, renderVerdict,
} from '../../../tools/bulk-import/src/report.mjs';
import {
  applyBreakTimes, applyDishes, applyMenus, applySchools, snapshot,
} from '../../../tools/bulk-import/src/db.mjs';

const CORS = corsHeaders('POST');

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

const KINDS = ['schools', 'dishes', 'menu', 'breaks'] as const;
type Kind = (typeof KINDS)[number];

const VALIDATE = {
  schools: validateSchools, dishes: validateDishes,
  menu: validateMenuItems, breaks: validateBreakTimes,
} as const;

/** A file big enough to be a mistake. The whole catalogue is around 20 kB. */
const MAX_BYTES = 2_000_000;

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
  if (userError || !userData?.user) return json(401, { error: 'not_authenticated' });

  let body: { kind?: string; filename?: string; text?: string; apply?: boolean };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'malformed_body' });
  }

  const kind = body.kind as Kind;
  if (!KINDS.includes(kind)) {
    return json(422, { error: 'validation_failed', fields: { kind: `must be one of: ${KINDS.join(', ')}` } });
  }
  const text = typeof body.text === 'string' ? body.text : '';
  if (text === '') {
    return json(422, { error: 'validation_failed', fields: { text: 'the file is empty' } });
  }
  if (text.length > MAX_BYTES) {
    return json(422, { error: 'validation_failed', fields: { text: `at most ${MAX_BYTES} bytes` } });
  }
  const filename = typeof body.filename === 'string' && body.filename !== '' ? body.filename : 'upload.csv';

  // `menu.import` at platform, read through the caller's own client so RLS decides what they see.
  const { data: grants, error: grantError } = await anon
    .from('permission_grant')
    .select('permission_code,scope_type')
    .is('revoked_at', null);
  if (grantError) {
    console.error('grant read failed', grantError.code);
    return json(500, { error: 'internal' });
  }
  const permitted = (grants ?? []).some(
    (g: { permission_code: string; scope_type: string }) =>
      g.permission_code === 'menu.import' && g.scope_type === 'platform',
  );
  if (!permitted) return json(403, { error: 'not_permitted', requires: 'menu.import' });

  // ------------------------------------------------------------------------------ parse
  let rows: unknown[];
  try {
    rows = parseFile(filename, text, kind);
  } catch (cause) {
    const message = cause instanceof ParseError || cause instanceof Error ? cause.message : 'unreadable';
    return json(409, { refused: true, stage: 'parse', message, report: `${filename}: ${message}` });
  }

  const { records, errors } = VALIDATE[kind](rows);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  let snap;
  try {
    snap = await snapshot(admin);
  } catch (cause) {
    console.error('snapshot failed', cause instanceof Error ? cause.message : cause);
    return json(500, { error: 'internal' });
  }

  // ------------------------------------------------------------------------------- plan
  const parts: string[] = [];
  if (errors.length > 0) parts.push(renderErrors(errors, { label: `${kind} file` }));

  let plan: Record<string, unknown> & { blockers: { row?: number; message: string }[] };
  let changes = 0;

  if (kind === 'schools') {
    plan = planSchools(records, snap);
    changes = plan.creates.length + plan.updates.length;
    parts.push(renderSchoolPlan(plan));
  } else if (kind === 'dishes') {
    plan = planDishes(records, snap);
    changes = plan.creates.length + plan.updates.length;
    parts.push(renderDishPlan(plan));
  } else if (kind === 'breaks') {
    plan = planBreakTimes(records, snap);
    changes = plan.creates.length + plan.updates.length;
    parts.push(renderBreakPlan(plan));
  } else {
    plan = planMenus(records, snap);
    changes = plan.menus.filter((m: { changed: boolean }) => m.changed).length;
    parts.push(renderMenuPlan(plan.menus));
  }

  if (plan.blockers.length > 0) parts.push(renderBlockers(plan.blockers));

  const refused = errors.length > 0 || plan.blockers.length > 0;
  const dryRun = body.apply !== true;

  parts.push(renderVerdict({
    dryRun,
    errorCount: errors.length,
    blockerCount: plan.blockers.length,
    changeCount: changes,
  }));
  const report = parts.join('\n\n');

  if (refused) {
    // 409 rather than 422: the file is well-formed, the request is well-formed, and the state of
    // the database is what makes it inapplicable. Nothing has been written.
    return json(409, { refused: true, dryRun: true, changes, errors, blockers: plan.blockers, report });
  }

  if (dryRun) {
    return json(200, { dryRun: true, changes, errors: [], blockers: [], report });
  }

  // ------------------------------------------------------------------------------ apply
  //
  // The same four functions `cli.mjs --apply` calls, with the same plan object, against the same
  // shape of client. Nothing here decides anything — `plan.mjs` already did.
  try {
    let applied = 0;
    if (kind === 'schools') applied = await applySchools(admin, plan, snap);
    else if (kind === 'dishes') applied = await applyDishes(admin, plan, snap);
    else if (kind === 'breaks') applied = await applyBreakTimes(admin, plan);
    else applied = await applyMenus(admin, plan.menus, snap);

    return json(200, { dryRun: false, changes, applied, errors: [], blockers: [], report });
  } catch (cause) {
    // The importer's `must()` throws with the operation that failed in the message. Passed
    // through, because "creating dish X" is the only thing that makes a half-finished import
    // recoverable — and unlike the refusals above, this one may have written something.
    const message = cause instanceof Error ? cause.message : 'the import failed part-way';
    console.error('apply failed', message);
    return json(500, {
      error: 'apply_failed',
      message,
      detail: 'Some rows may have been written before this failed. Re-run the dry run to see the current state.',
    });
  }
});
