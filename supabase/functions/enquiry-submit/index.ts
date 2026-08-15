// `enquiry-submit` — the public website's enquiry form. `E12-15`.
//
// Implemented to `docs/enquiry-submission-contract.md`, which was written by the side that calls
// this so the two halves cannot disagree. Read that document before changing anything here; the
// reasoning for each rule lives there and is not repeated in full.
//
//   POST /functions/v1/enquiry-submit
//     201 -> stored              { status: 'created', id }
//     202 -> looked automated    { status: 'accepted' }   (accepted, stored nowhere, never told)
//     303 -> form-encoded success or drop, Location: /thanks
//     422 -> validation failed   { error: 'validation_failed', fields: {...} }
//     400 -> unparseable body    { error: 'malformed_body' }
//     429 -> rate limited        { error: 'rate_limited' }
//     405 -> not POST or OPTIONS { error: 'method_not_allowed' }
//
// ## Two content types, and why the no-JavaScript path is not a nicety
//
// The audience is on patchy mobile data in tier-1 Indian cities (`P11`). A dropped script bundle
// must not cost an enquiry, so a native form post with no JavaScript works: it arrives as
// `application/x-www-form-urlencoded` and is answered with a `303` to `/thanks`.
//
// ## The notification, and why it comes last
//
// §6 wants one notification per stored enquiry. `E08`'s mail infrastructure now exists, so
// `E12-16` is done: `_shared/enquiry-notice.ts` sends it.
//
// It is sent **after the row is committed, and its result is ignored**. The contract is explicit
// that the email is best-effort and must never fail the request — *"an enquiry lost because a
// mail provider had a bad minute is the worst outcome this endpoint can produce"* — so a send
// that fails logs and the caller still gets its `201`. An enquiry stored and not emailed is
// recoverable; the reverse is not.
//
// It also does not carry the phone number or the message. Those are on the row. An email is
// forwarded and quoted and sits in inboxes; a row has RLS.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, preflight } from '../_shared/cors.ts';
import { sendEnquiryNotice } from '../_shared/enquiry-notice.ts';

/**
 * An allowlist, not `*`.
 *
 * `_shared/cors.ts` uses `*` for the authenticated back-office functions, and the reasoning there
 * — authorisation is a bearer token, so CORS buys nothing — does not hold for this one. This
 * endpoint takes **unauthenticated** writes, so the origin is the only thing distinguishing our
 * form from someone else's page posting as if it were ours. It is not a security control (a
 * server-side caller ignores it entirely), but it stops the browser-based version cheaply.
 */
const ALLOWED_ORIGINS = [
  'https://graybag.com',
  'https://www.graybag.com',
  'https://graybag-web.netlify.app',
  'http://localhost:4321',
];

const CORS_BASE = corsHeaders('POST');

function corsFor(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  return {
    ...CORS_BASE,
    'access-control-allow-origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]!,
    // The reply varies by request origin, so a shared cache must not serve one origin's headers
    // to another.
    vary: 'Origin',
    'access-control-allow-headers': 'content-type',
  };
}

const json = (status: number, payload: unknown, cors: Record<string, string>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });

// ------------------------------------------------------------------------ the rules, restated
//
// §4: "Re-run every rule server-side." `apps/web/src/lib/enquiry.ts` implements all of them and
// is covered by tests, but it runs in the visitor's browser and is therefore advice, not
// enforcement. An Edge Function cannot import from `packages/shared`, so they are restated —
// deliberately identically, and any change must be made in both places.

const ROLES = [
  'principal',
  'vice_principal',
  'administrator',
  'canteen_manager',
  'management',
  'other',
];

/** Collapse runs of whitespace and trim. The same `tidy` the form applies. */
const tidy = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * Normalise what people actually type into `+91XXXXXXXXXX`.
 *
 * The `(?=\d{10}$)` on the bare `91` strip is load-bearing: `9176543210` is a valid mobile
 * beginning `9`, and taking its first two characters as a country code corrupts it. Character for
 * character the same as the client's `normalisePhone`.
 */
function normalisePhone(value: string): string | null {
  const digits = value.replace(/[\s\-().]/g, '');
  const bare = digits
    .replace(/^\+91/, '')
    .replace(/^0091/, '')
    .replace(/^91(?=\d{10}$)/, '')
    .replace(/^0/, '');
  if (!/^[6-9]\d{9}$/.test(bare)) return null;
  return `+91${bare}`;
}

function looksLikeEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

interface Fields {
  name: string;
  role: string;
  school: string;
  city: string;
  email: string;
  phone: string;
  message: string;
  website: string;
  elapsed_ms: string;
  redirect_to: string;
}

const EMPTY: Fields = {
  name: '', role: '', school: '', city: '', email: '', phone: '',
  message: '', website: '', elapsed_ms: '', redirect_to: '',
};

/** Validate, and return one message per bad field. Empty means good. */
function validate(f: Fields): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = tidy(f.name);
  const school = tidy(f.school);
  const city = tidy(f.city);
  const email = tidy(f.email).toLowerCase();

  if (name.length < 2 || name.length > 80) errors.name = 'invalid';
  if (!ROLES.includes(f.role)) errors.role = 'invalid';
  if (school.length < 2 || school.length > 120) errors.school = 'invalid';
  if (city.length < 2 || city.length > 60) errors.city = 'invalid';
  if (!looksLikeEmail(email)) errors.email = 'invalid';
  if (!normalisePhone(f.phone)) errors.phone = 'invalid';
  if (f.message.length > 2000) errors.message = 'invalid';

  return errors;
}

/**
 * §5: a submission that looks automated is answered as if it succeeded.
 *
 * A bot told it failed retries with a variation; a bot told it succeeded goes away. It also means
 * a false positive costs a real person nothing visible — the alternative is a principal who
 * believes they have contacted us and has not.
 *
 * **An absent `elapsed_ms` is not automated.** That is the no-JavaScript case, which is exactly
 * the visitor the fallback exists for.
 */
function looksAutomated(website: string, elapsedRaw: string): boolean {
  if (website.trim() !== '') return true;
  if (elapsedRaw === '') return false;
  const elapsed = Number(elapsedRaw);
  return Number.isFinite(elapsed) && elapsed > 0 && elapsed < 3000;
}

/**
 * A URL on the **site's** origin, not this function's.
 *
 * A bare `/thanks` in a `Location` header resolves against the origin that sent it, so a
 * no-JavaScript visitor landed on `<project>.supabase.co/thanks` — a 404 on a domain they have
 * never heard of, at the exact moment they were told their enquiry had been received. The origin
 * comes from the request when it is one we allow, and falls back to production.
 */
function siteUrl(path: string, request: Request): string {
  const origin = request.headers.get('Origin') ?? '';
  const site = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : (Deno.env.get('ENQUIRY_SITE_ORIGIN') ?? ALLOWED_ORIGINS[0]!);
  return new URL(path, site).href;
}

/**
 * `/thanks`, and nothing else. Reflecting an arbitrary value would be an open redirect, and open
 * redirects on a real domain get used for phishing.
 */
const REDIRECT_ALLOWLIST = new Set(['/thanks']);
const safeRedirect = (value: string, request: Request) =>
  siteUrl(REDIRECT_ALLOWLIST.has(value) ? value : '/thanks', request);

/** SHA-256 of the IP plus a per-project salt. The IP itself is never stored or logged. */
async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get('ENQUIRY_IP_SALT') ?? Deno.env.get('SUPABASE_URL') ?? 'graybag';
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request: Request) => {
  const cors = corsFor(request);

  // First, before anything else: a preflight carries no credentials and no body.
  const pre = preflight(request, cors);
  if (pre) return pre;

  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, cors);

  // ------------------------------------------------------------------------------- the body
  const contentType = request.headers.get('content-type') ?? '';
  const formEncoded = contentType.includes('application/x-www-form-urlencoded');
  let f: Fields;

  try {
    if (formEncoded) {
      const form = new URLSearchParams(await request.text());
      f = { ...EMPTY };
      for (const key of Object.keys(EMPTY) as (keyof Fields)[]) f[key] = form.get(key) ?? '';
    } else {
      const body = await request.json();
      if (typeof body !== 'object' || body === null) throw new Error('not an object');
      f = { ...EMPTY };
      for (const key of Object.keys(EMPTY) as (keyof Fields)[]) {
        const value = (body as Record<string, unknown>)[key];
        f[key] = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
      }
    }
  } catch {
    return json(400, { error: 'malformed_body' }, cors);
  }

  const redirectTo = safeRedirect(f.redirect_to, request);
  const seeOther = () => new Response(null, { status: 303, headers: { ...cors, location: redirectTo } });

  // ----------------------------------------------------------------------------- rate limit
  //
  // Before validation, so a flood costs one function invocation and one round trip rather than a
  // parse and a write.
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('cf-connecting-ip') ||
    'unknown';

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  if (ip !== 'unknown') {
    const ipHash = await hashIp(ip);
    const windows: [string, number][] = [['01:00:00', 10], ['24:00:00', 30]];
    for (const [window, limit] of windows) {
      const { data: over, error } = await admin.rpc('enquiry_rate_hit', {
        p_ip_hash: ipHash,
        p_window: window,
        p_limit: limit,
      });
      // A rate limiter that cannot count must not become a rate limiter that rejects everyone.
      // The enquiry is worth more than the limit is.
      if (error) console.error('rate check failed', error.code);
      else if (over) {
        return formEncoded ? seeOther() : json(429, { error: 'rate_limited' }, cors);
      }
    }
  }

  // ------------------------------------------------------------------------------- automated
  if (looksAutomated(f.website, f.elapsed_ms)) {
    // Logged without any field of the submission, so the false-positive rate is observable
    // without the log becoming a copy of the table.
    console.warn('enquiry dropped as automated');
    return formEncoded ? seeOther() : json(202, { status: 'accepted' }, cors);
  }

  // ------------------------------------------------------------------------------ validation
  const errors = validate(f);
  if (Object.keys(errors).length > 0) {
    // The no-JavaScript path has nowhere to render field errors, and the browser has already
    // left the page. `/thanks` would be a lie, so it goes back to the form.
    if (formEncoded) {
      return new Response(null, {
        status: 303,
        headers: { ...cors, location: siteUrl('/#enquiry', request) },
      });
    }
    return json(422, { error: 'validation_failed', fields: errors }, cors);
  }

  // ----------------------------------------------------------------------------------- store
  const { data, error } = await admin
    .from('enquiry')
    .insert({
      name: tidy(f.name),
      role: f.role,
      school: tidy(f.school),
      city: tidy(f.city),
      email: tidy(f.email).toLowerCase(),
      phone: normalisePhone(f.phone),
      // Empty becomes `null`, never `''` — §4. They mean different things and only one is true.
      message: tidy(f.message) === '' ? null : f.message.trim(),
      source: formEncoded ? 'website_nojs' : 'website',
    })
    .select('id')
    .single();

  if (error) {
    // Never echo the database's message: it quotes column values, and every value here is
    // somebody's name, email or phone number.
    console.error('enquiry insert failed', error.code);
    return formEncoded ? seeOther() : json(500, { error: 'internal' }, cors);
  }

  // §6's notification — `E12-16`. Awaited so a failure is logged inside the request's own
  // lifetime rather than after the runtime has moved on, but its result is **deliberately
  // discarded**: the row is committed and nothing below this line may turn a stored enquiry into
  // an error the visitor sees.
  await sendEnquiryNotice({
    id: data.id,
    name: tidy(f.name),
    role: f.role,
    school: tidy(f.school),
    city: tidy(f.city),
    email: tidy(f.email).toLowerCase(),
    noJs: formEncoded,
  });

  return formEncoded ? seeOther() : json(201, { status: 'created', id: data.id }, cors);
});
