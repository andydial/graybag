// @ts-check
import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'astro/config';

import { ENQUIRY_ENDPOINT_PATH, devEnquiryEndpoint } from './scripts/dev-enquiry-endpoint.mjs';

/**
 * `/admin/import` runs the **CLI importer's own** parse, validate and plan (`E10-29`).
 *
 * Aliased rather than copied, and that is the entire point: a browser dry run that disagreed with
 * the tool doing the real import would be worse than no dry run at all — it would say "12 changes,
 * no problems" about a file that then behaves differently. One implementation, 83 tests, two
 * callers.
 *
 * Only the four modules that import nothing are reachable this way. `connect.mjs` holds the
 * service-role client and is deliberately not among them.
 */
const BULK_IMPORT = fileURLToPath(new URL('../../tools/bulk-import/src', import.meta.url));

/**
 * The public GrayBag site (`E12`).
 *
 * **`output: 'static'`, and no adapter.** There is no server. Every page is HTML on a CDN, and
 * the one thing that writes — the enquiry form — posts to a Supabase Edge Function in
 * `ap-south-1`. That is `A4` (writes go through Edge Functions) and `A5` (Netlify Functions are
 * not used for API work, because Netlify has no India region and a 200ms hop to Virginia is the
 * whole thing this stack was chosen to avoid).
 *
 * A static site also means the deploy has no cold start, no runtime to patch and nothing that
 * can fall over at 9am on the morning a principal opens the link.
 *
 * **No integrations.** No React, no Tailwind, no analytics. The performance budget for this
 * site is zero third-party requests (`docs/superpowers/specs/2026-08-11-public-website-design.md`
 * §7), and every integration is a standing invitation to spend that budget. The page ships one
 * small inline script for form progressive enhancement and nothing else.
 */
export default defineConfig({
  site: 'https://graybag.com',
  output: 'static',
  trailingSlash: 'never',
  build: {
    // One stylesheet rather than a per-page one. The whole site is a handful of pages sharing
    // one design; splitting it costs a request per navigation and saves nothing.
    inlineStylesheets: 'never',
    format: 'file',
  },
  devToolbar: { enabled: false },
  vite: {
    resolve: {
      alias: { '@bulk-import': BULK_IMPORT },
    },
    server: {
      // The importer lives outside this package, so the dev server has to be told it may read it.
      fs: { allow: ['..', BULK_IMPORT] },
    },
    build: {
      // The site's own JS is a few hundred bytes of form enhancement. Chunking it would produce
      // more HTTP requests than code.
      assetsInlineLimit: 0,
    },
  },
  integrations: [devEnquiryEndpoint()],
  compressHTML: true,
});

export { ENQUIRY_ENDPOINT_PATH };
