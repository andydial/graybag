import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Imported from the Edge Functions' own directory rather than copied, for the same reason
// `signature.test.ts` does it: Deno bundles from there, so a copy here would be a second
// implementation free to drift from the one that actually ships.
import { corsHeaders, preflight } from '../../../../supabase/functions/_shared/cors.js';

const FUNCTIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/functions');

/**
 * `E09-20`. A preflight failure is invisible from the mobile app and total from a browser, which
 * is the combination that let it sit in six functions at once.
 *
 * React Native's `fetch` sends no `OPTIONS`, so every one of these functions was correct for the
 * app and unreachable from any web page. The web thread hit it on the back office's first real
 * click — `OPTIONS` answered `405`, and the actual request was never sent.
 *
 * These tests are **static**, reading the shipped sources. Edge Functions run on Deno and are not
 * importable into vitest as handlers, so the alternative is no test at all — and a fix applied by
 * hand to six files with nothing asserting the seventh stays excluded is how the next one gets
 * missed.
 */
describe('corsHeaders', () => {
  it('always permits OPTIONS, whatever the function accepts', () => {
    // A function that answers a preflight necessarily accepts OPTIONS. Forgetting to say so in
    // Allow-Methods is the original bug with an extra step.
    expect(corsHeaders('POST')['access-control-allow-methods']).toBe('POST, OPTIONS');
    expect(corsHeaders('POST, PATCH, DELETE')['access-control-allow-methods']).toBe(
      'POST, PATCH, DELETE, OPTIONS',
    );
  });

  it('allows the headers supabase-js actually sends', () => {
    // `apikey` and `x-client-info` are set by the client library itself. Omitting either fails
    // the preflight for a header the caller never chose to send, which reads as a server bug.
    const allowed = corsHeaders('POST')['access-control-allow-headers'];
    for (const header of ['authorization', 'apikey', 'content-type', 'x-client-info']) {
      expect(allowed).toContain(header);
    }
  });

  it('caches the preflight, so it is not a round trip per click', () => {
    expect(Number(corsHeaders('GET')['access-control-max-age'])).toBeGreaterThanOrEqual(3600);
  });
});

describe('preflight', () => {
  const CORS = corsHeaders('POST');

  it('answers OPTIONS with 204 and no body', async () => {
    const response = preflight(new Request('https://x/y', { method: 'OPTIONS' }), CORS);
    expect(response?.status).toBe(204);
    expect(await response?.text()).toBe('');
  });

  it('carries the origin header on the preflight itself', () => {
    const response = preflight(new Request('https://x/y', { method: 'OPTIONS' }), CORS);
    expect(response?.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('returns null for every real request, so the handler runs', () => {
    // The failure this guards is a preflight helper that swallows the actual call.
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      expect(preflight(new Request('https://x/y', { method }), CORS)).toBeNull();
    }
  });
});

describe('every browser-callable Edge Function', () => {
  /**
   * `payments-webhook` is **deliberately absent**, and this list is where that is recorded.
   *
   * Razorpay calls it server to server; no browser ever does. Advertising a preflight on it would
   * describe a browser-callable surface that should not exist. Its safety is the HMAC over the
   * raw body, not CORS — but "no browser client" is a fact worth keeping true rather than merely
   * untested.
   */
  const BROWSER_CALLABLE = [
    'account',
    'checkout',
    // Added by `E09-20`. The back office is the first browser client in the project, and this
    // function is where the missing preflight was found.
    'kitchen-order-status',
    'menu-version',
    'order-calendar',
    // Added by `E06-02`. This list failing on a new function is the point of the last test in
    // this block, and it worked: the function was written, the suite went red, and the choice
    // between the two lists had to be made rather than defaulted.
    'payments-create-order',
    'policy',
    'recipients',
  ];
  const NOT_BROWSER_CALLABLE = ['payments-webhook'];

  const source = (name: string) => readFileSync(join(FUNCTIONS, name, 'index.ts'), 'utf8');

  it.each(BROWSER_CALLABLE)('%s answers a preflight before authenticating', (name) => {
    const text = source(name);
    expect(text).toContain('preflight(request, CORS)');

    // Order matters more than presence. A preflight carries no credentials — the browser strips
    // them — so a function that authenticates first returns 401 to the OPTIONS and the real
    // request is never sent. Same outage as the 405, different status code.
    const pre = text.indexOf('preflight(request, CORS)');
    const auth = text.indexOf("headers.get('Authorization')");
    if (auth !== -1) expect(pre).toBeLessThan(auth);

    // And before the method guard, which was literally what returned the 405.
    const method = text.indexOf("request.method !==");
    if (method !== -1) expect(pre).toBeLessThan(method);
  });

  it.each(BROWSER_CALLABLE)('%s puts the origin header on ordinary replies too', (name) => {
    // A preflight that passes, followed by a reply the browser discards for want of the header,
    // is the same failed click one step later.
    expect(source(name)).toContain('...CORS');
  });

  it.each(NOT_BROWSER_CALLABLE)('%s stays free of CORS on purpose', (name) => {
    const text = source(name);
    expect(text).not.toContain('preflight(');
    expect(text.toLowerCase()).not.toContain('access-control-allow-origin');
  });

  it('names every function that exists, so a new one cannot be forgotten', () => {
    // The point of `E09-20` is that this is a class. A seventh function added next month with no
    // preflight would reproduce it exactly — and silently, because the app would not notice.
    // This fails until somebody decides which list it belongs in.
    const onDisk = readdirSync(FUNCTIONS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .map((entry) => entry.name)
      .sort();
    expect(onDisk).toEqual([...BROWSER_CALLABLE, ...NOT_BROWSER_CALLABLE].sort());
  });
});
