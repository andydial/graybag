import type { APIRoute } from 'astro';

import { SITE } from '../content/site.js';

/**
 * `robots.txt` (`E12-07`).
 *
 * Generated rather than sat in `public/` so the sitemap URL comes from `SITE.url` and cannot
 * drift when the domain changes at the cutover (`E12-09`, `E12-10`).
 *
 * Everything is allowed. There is nothing on this site to hide: four pages, no admin surface
 * (`E12-06` is a separate task and will need its own `Disallow`), and the enquiry endpoint is
 * not on this origin.
 */
export const GET: APIRoute = () =>
  new Response(
    [`User-agent: *`, `Allow: /`, ``, `Sitemap: ${new URL('/sitemap.xml', SITE.url).href}`, ``].join('\n'),
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
