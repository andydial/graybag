// GET /order/calendar?school=<uuid>&from=<date>&to=<date> — E05-08.
//
// Deliberately a shell, exactly like `menu-version`. Every decision — what is a 400, what the
// wire shape is, how long it may be cached, how long a range may be — lives in
// `packages/shared/src/ordering/calendar-endpoint.ts` and is unit-tested there, without Deno,
// without a database and without a deploy.
//
// The rules are restated here as a contract rather than imported, because Deno resolves
// modules by URL and cannot import a workspace package. `calendar-endpoint.test.ts` is the
// authority; if this file and that file disagree, this one is wrong.
//
//   200 -> {"advisory":true,"days":[{serviceDate,cutoffAt,isOrderable,reason}]}
//          cache-control: private, max-age=60
//   400 -> malformed school, malformed date, backwards range, or a range over the cap
//
// **This endpoint is advisory** (order-lifecycle §9.2 E1). It exists so the app can grey out
// closed days. The authoritative refusal is `assert_cutoff_open` inside the checkout
// transaction, against a snapshotted `cutoff_at` (`L6`) — a client clock is not evidence, and
// neither is a cached copy of this.
//
// Reads only. Under `A4` a read may use the Supabase client directly; this function holds no
// service-role key and does no writes.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, preflight } from '../_shared/cors.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 62;
const MAX_AGE_SECONDS = 60;

const CORS = corsHeaders('GET');

const json = (status: number, payload: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json', ...extra },
  });

/** Rejects `2026-02-30`, which a pattern match alone would accept. */
function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

Deno.serve(async (request: Request) => {
  const pre = preflight(request, CORS);
  if (pre) return pre;

  const params = new URL(request.url).searchParams;
  const school = params.get('school')?.trim() ?? '';
  const from = params.get('from')?.trim() ?? '';
  const to = params.get('to')?.trim() ?? '';

  const badRequest = json(400, {
    error: 'school must be a uuid, and from/to must be YYYY-MM-DD with to on or after from',
    hint: `GET /order/calendar?school=<uuid>&from=<date>&to=<date> (max ${MAX_RANGE_DAYS} days)`,
  });

  if (!UUID_RE.test(school) || !isRealDate(from) || !isRealDate(to)) return badRequest;

  const span = Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
  if (span < 0 || span + 1 > MAX_RANGE_DAYS) return badRequest;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    // The anon key. RLS is the control (`D17`, `PB1`), not the key.
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { authorization: request.headers.get('authorization') ?? '' } } },
  );

  const { data, error } = await supabase.rpc('orderable_calendar', {
    p_school_id: school.toLowerCase(),
    p_from: from,
    p_to: to,
  });

  // `orderable_calendar` raises `no_data_found` for a school with no config, which is the
  // same signal as "unknown school". A 404 says which, where a 500 would say only that
  // something broke.
  if (error) {
    if (error.code === 'P0002') return json(404, { error: 'no configuration for that school' });
    return json(500, { error: 'calendar lookup failed' });
  }

  return json(
    200,
    {
      advisory: true,
      days: (data ?? []).map((row: {
        service_date: string;
        cutoff_at: string;
        is_orderable: boolean;
        reason: string | null;
      }) => ({
        serviceDate: row.service_date,
        cutoffAt: row.cutoff_at,
        isOrderable: row.is_orderable,
        reason: row.reason,
      })),
    },
    // `private`, never `public`: the answer depends on the school's config chain and on when
    // it was asked. A shared cache handing one school's calendar to another only shows up
    // once there is a CDN in front.
    { 'cache-control': `private, max-age=${MAX_AGE_SECONDS}` },
  );
});
