// GET /menu/version?school=<uuid> — E04-09.
//
// Deliberately a shell. Every decision this endpoint makes — what is a 400 versus a 404,
// how small the body is, how long it may be cached — lives in
// `packages/shared/src/menu/version-endpoint.ts` and is unit-tested there, without Deno,
// without a database and without a deploy.
//
// That split is not tidiness. This endpoint is called by **every user on every app open**,
// so it is the one place in the system where a small mistake is multiplied by the whole
// user base, and it is also the hardest thing here to exercise locally. Keeping the logic
// somewhere a test can reach it is the only way its behaviour is ever actually checked.
//
// The rules it must obey are copied here as a contract rather than imported, because Deno
// resolves modules by URL and cannot import a workspace package. `version-endpoint.test.ts`
// is the authority; if this file and that file disagree, this one is wrong.
//
//   200 -> {"v":<n>}   cache-control: public, max-age=30
//   400 -> malformed or missing `school`
//   404 -> no school_menu_version row for that school
//
// Reads only. Under `A4` a read may use the Supabase client directly; this function holds
// no service-role key and does no writes.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AGE_SECONDS = 30;

const json = (status: number, payload: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });

Deno.serve(async (request: Request) => {
  const raw = new URL(request.url).searchParams.get('school')?.trim() ?? '';

  if (!UUID_RE.test(raw)) {
    return json(400, { error: 'school must be a uuid', hint: 'GET /menu/version?school=<uuid>' });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    // The anon key. RLS is the control (`D17`, `PB1`), not the key — and the read policy
    // `school_menu_version_read_customer` in 0002 is what decides who sees what.
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { authorization: request.headers.get('authorization') ?? '' } } },
  );

  const { data, error } = await supabase
    .from('school_menu_version')
    .select('version')
    .eq('school_id', raw.toLowerCase())
    .maybeSingle();

  if (error) return json(500, { error: 'lookup failed' });

  // Null-check the ROW, never falsy-check the version: a real version 0 must be a 200.
  if (data === null) return json(404, { error: 'no menu version for that school' });

  return json(200, { v: data.version }, { 'cache-control': `public, max-age=${MAX_AGE_SECONDS}` });
});
