// Connecting to Supabase with the service role.
//
// Split out of `db.mjs` by `E10-29` so that everything else in that file — `snapshot()` above all
// — imports **nothing**. `snapshot(db)` only ever calls `db.from(x).select(y)`, so once the
// `createClient` import is gone it runs anywhere, including a browser, against any object with
// that shape. That is what lets `/admin/import` dry-run a file through the *same* code the CLI
// uses rather than a second implementation that would drift from it.
//
// This file stays Node-only, and deliberately so: the service role bypasses RLS and must never
// reach a browser.

import { createClient } from '@supabase/supabase-js';

export function connect(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n\n' +
        '  set -a; . ./.secrets.staging.env; set +a\n\n' +
        'The service role key bypasses RLS. Never put it in a shell history, a script in the ' +
        'repository, or anything that reaches a browser.',
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
