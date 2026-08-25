/**
 * Where school enquiries come from — `E12-38`.
 *
 * Andy: *"web and marketing analytics on the public site — enough to tell me where school
 * enquiries come from. Privacy-respecting, no third-party tracking of parents, and nothing on
 * authenticated pages."* And: *"Use PostHog… the mobile thread is standing it up, so share one
 * project and one account."*
 *
 * ## Why there is no PostHog SDK here
 *
 * The first version imported `posthog-js`. It is **88 KB gzipped** — 8.8× this project's
 * per-page JavaScript budget — and it took the home page's first load from 244 KB to 507 KB,
 * past the 400 KB ceiling. `check-build.mjs` refused it, correctly: that budget exists for a
 * mid-range Android on patchy mobile data in a tier-1 Indian city (`P11`), and 88 KB of analytics
 * on the page that sells to schools is the exact trade it was written to prevent.
 *
 * PostHog's capture endpoint is a plain JSON POST. Two events do not need a library, so this is
 * about forty lines and roughly **half a kilobyte**, into the same project the mobile app uses —
 * one account, one dataset, as asked.
 *
 * ## Proxied through our own origin
 *
 * `netlify.toml` maps `/ingest/*` to PostHog. The browser therefore only ever talks to graybag:
 * `script-src 'self'` is untouched, `connect-src 'self'` needs no widening, no third-party host
 * appears in the HTML, and the request survives the ad-blockers that drop `*.posthog.com`.
 *
 * ## The marketing site only
 *
 * Imported by `index.astro` and nothing else, so the back office, the kitchen board and the
 * policy pages are never measured. `check-build.mjs` asserts that placement rather than trusting
 * it — a parent signing in is never tracked.
 *
 * ## What is deliberately not collected
 *
 * **No cookies and no storage**, so there is nothing to consent to under DPDP and no banner to
 * write. The cost is real and worth stating: a returning visitor is a new one every time, so
 * these are visit counts, not people counts. The question asked — where enquiries come from —
 * does not need people counts.
 *
 * **Nothing anybody typed.** Not a school name, not a contact, not the message. Those live on the
 * `enquiry` row behind RLS; an analytics vendor is a different place with different rules.
 *
 * **No autocapture, no recording, no heatmaps** — none of which exist without the SDK anyway,
 * which is a second reason not to have it.
 *
 * ## Inert until a key exists
 *
 * `PUBLIC_POSTHOG_KEY` is baked at build time. Unset — as it is until the mobile thread shares
 * the project — every function here returns immediately.
 */

/** PostHog needs *a* distinct id. A fresh random one per page view, kept only in memory. */
const visit = Math.random().toString(36).slice(2) + Date.now().toString(36);

const key = (): string => import.meta.env.PUBLIC_POSTHOG_KEY ?? '';

/**
 * A browser that has asked not to be tracked is asked once and believed.
 *
 * Cheap to honour, and the alternative is measuring people who have said no.
 */
const refused = (): boolean =>
  typeof navigator !== 'undefined' && navigator.doNotTrack === '1';

function send(event: string, properties: Record<string, string>): void {
  if (!key() || refused()) return;

  const body = JSON.stringify({
    api_key: key(),
    event,
    distinct_id: visit,
    properties: { ...properties, $current_url: location.pathname },
  });

  /*
   * `keepalive` so an event fired as somebody navigates away still leaves the browser — the
   * enquiry submit is exactly that moment, and it is the one event worth having.
   *
   * Failures are swallowed on purpose. Analytics must never be the reason a page misbehaves, and
   * an ad-blocker refusing this request is a normal Tuesday rather than an error.
   */
  void fetch('/ingest/i/v0/e/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

/**
 * Where this visit came from.
 *
 * `utm_source` when we put one there, otherwise the referrer's **host only** — enough to tell a
 * school newsletter from a search engine, and deliberately not the full URL, which can carry a
 * search query somebody typed.
 */
function source(): string {
  const utm = new URLSearchParams(location.search).get('utm_source');
  if (utm) return utm.slice(0, 60);
  if (!document.referrer) return 'direct';
  try {
    return new URL(document.referrer).host;
  } catch {
    return 'unknown';
  }
}

export function startAnalytics(): void {
  send('$pageview', { source: source() });
}

/**
 * One event: a school asked to be contacted.
 *
 * The single thing Andy asked to measure. It carries the **source** and nothing the enquirer
 * typed.
 */
export function trackEnquiry(): void {
  send('enquiry_submitted', { source: source() });
}
