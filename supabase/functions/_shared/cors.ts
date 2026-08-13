/**
 * CORS preflight handling, in one place, for every Edge Function that a browser may call.
 *
 * # Why this was invisible
 *
 * `apps/mobile` is React Native, and **React Native's `fetch` issues no preflight**. So every
 * function here was perfectly correct for the app and unreachable from any web page. Nothing
 * failed, nothing was logged, and no test caught it, because until the back office existed
 * there was no browser client at all.
 *
 * The web thread found it the hard way on `kitchen-order-status`: a `POST` carrying
 * `content-type: application/json` and an `Authorization` header is **not a "simple request"**,
 * so the browser sends `OPTIONS` first — and `OPTIONS` was answered `405`. The click failed
 * before the real request was ever sent.
 *
 * That is `E09-20`, and the point of it is that this is a **class, not an incident**: `checkout`,
 * `recipients`, `menu-version`, `order-calendar`, `account` and `policy` would each have failed
 * on their first call from the back office, one at a time, each looking like a new bug. Fixing
 * them individually would have meant six separate diagnoses of one cause.
 *
 * # Why the origin is `*`
 *
 * This is deliberate and not laziness. **Authorisation here is the bearer token and nothing
 * else** — no cookie is set, no session rides on the origin — so there is no CSRF for an origin
 * allow-list to prevent, and an allow-list would buy nothing while being one more thing to
 * update per environment. A caller still needs a valid JWT and the grant behind it; CORS decides
 * who may *read a reply in a browser*, never who may act.
 *
 * The reasoning is the web thread's, restated here rather than reinvented, so both threads keep
 * one convention.
 *
 * # `payments-webhook` is deliberately not on this list
 *
 * Razorpay calls it server to server. No browser ever calls it, so it needs no preflight — and
 * advertising one would describe a browser-callable surface that should not exist. Its safety
 * comes from the HMAC over the raw body, not from CORS, but "no browser client" is a fact worth
 * keeping true rather than merely unexercised. `cors.test.ts` asserts the exclusion, so that
 * nobody adds it later for the look of consistency.
 */

/** Headers a preflight may carry. `apikey` and `x-client-info` are supabase-js's own. */
const ALLOWED_HEADERS = 'authorization, apikey, content-type, x-client-info';

/**
 * A day. The preflight is a round trip before every non-simple request, and the answer does not
 * change between deploys — caching it is the difference between one OPTIONS per session and one
 * per click on a kitchen screen someone is using all morning.
 */
const MAX_AGE = '86400';

/**
 * The CORS headers for a function accepting `methods`.
 *
 * `OPTIONS` is appended rather than expected in the argument, because a function that answers a
 * preflight necessarily accepts `OPTIONS` and forgetting to say so is the whole bug again.
 */
export function corsHeaders(methods: string): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': ALLOWED_HEADERS,
    'access-control-allow-methods': `${methods}, OPTIONS`,
    'access-control-max-age': MAX_AGE,
  };
}

/**
 * Answers a preflight, or returns `null` if this request is not one.
 *
 * Call it as the **first thing** in the handler, before any authentication. A preflight carries
 * no credentials by design — the browser strips them — so authenticating it rejects it, and the
 * real request that would have followed is never sent. A 401 on an OPTIONS is the same outage as
 * a 405 on one.
 *
 * `204` with no body: there is nothing to say, and a body on a preflight is ignored anyway.
 *
 * **Takes the headers, not the method list.** Each function already holds its `corsHeaders(...)`
 * in a constant, because every ordinary reply has to carry the origin header too — a preflight
 * that passes followed by a reply the browser discards is the same failed click. Passing the
 * methods again here would state them twice per function, and the copy that goes stale is the
 * one nobody reads.
 */
export function preflight(request: Request, headers: Record<string, string>): Response | null {
  if (request.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers });
}
