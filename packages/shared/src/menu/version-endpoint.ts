/**
 * `GET /menu/version?school=<uuid>` — the handler's decisions, as a pure function
 * (`E04-09`).
 *
 * The Edge Function in `supabase/functions/menu-version/` is a ten-line shell around this:
 * read the query string, call the database, hand both to `menuVersionResponse`. Everything
 * that can be wrong lives here, where it can be tested without Deno, without a database and
 * without a deploy — which matters because this endpoint is called by **every user on every
 * app open** and is therefore the one place in the system where a small mistake is
 * multiplied by the entire user base.
 *
 * Three things it decides, none of them obvious:
 *
 * 1. **A missing or malformed `school` is a 400, and an unknown school is a 404.** They are
 *    different failures — one is a client bug, the other is a school that has no menu
 *    assigned yet — and collapsing them into one status makes the second undiagnosable.
 * 2. **The body is the smallest thing that can carry the number.** `{"v":12}` is nine bytes.
 *    This is a request every user makes on every open, on connections that are the binding
 *    constraint; a helpfully verbose envelope here is paid for a million times.
 * 3. **`Cache-Control` is short but non-zero.** The token is monotonic, so a stale read can
 *    only ever cause a *missed* refresh for a few seconds, never a wrong menu — and the
 *    endpoint is the first thing worth putting behind a CDN (`E15-10`). `no-store` here
 *    would throw that away for a correctness property we do not need.
 */

/** A v4-shaped UUID. Deliberately strict: the app has no reason to send anything else. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VersionResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Seconds a client or CDN may serve this without re-asking. */
export const VERSION_MAX_AGE_SECONDS = 30;

const json = (status: number, payload: unknown, extra: Record<string, string> = {}): VersionResponse => ({
  status,
  headers: { 'content-type': 'application/json', ...extra },
  body: JSON.stringify(payload),
});

export function parseSchoolId(rawQuery: string | null | undefined): string | null {
  if (!rawQuery) return null;
  const value = rawQuery.trim();
  return UUID_RE.test(value) ? value.toLowerCase() : null;
}

/**
 * Shape the response.
 *
 * @param schoolIdParam the raw `school` query parameter
 * @param lookup        `null` when the school has no `school_menu_version` row
 */
export function menuVersionResponse(
  schoolIdParam: string | null | undefined,
  lookup: { version: number } | null,
): VersionResponse {
  const schoolId = parseSchoolId(schoolIdParam);

  if (schoolId === null) {
    // A client bug. Saying which one costs nothing and saves a debugging session.
    return json(400, {
      error: 'school must be a uuid',
      hint: 'GET /menu/version?school=<uuid>',
    });
  }

  if (lookup === null) {
    // Not an error condition in the system — a school with no menu assigned yet is a
    // legitimate state, and `bump_school_menu_version` only creates the row once a school
    // exists. The app treats this as "no menu to cache" rather than as a failure.
    return json(404, { error: 'no menu version for that school' });
  }

  // The smallest body that carries the number. Every user, every open.
  return json(200, { v: lookup.version }, {
    'cache-control': `public, max-age=${VERSION_MAX_AGE_SECONDS}`,
  });
}
