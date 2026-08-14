import type { APIRoute } from 'astro';

import { SITE } from '../content/site.js';

/**
 * `robots.txt` (`E12-07`, `E12-09`).
 *
 * Generated rather than sat in `public/` so the sitemap URL comes from `SITE.url` and cannot
 * drift when the domain changes at the cutover (`E12-10`).
 *
 * ## Crawling is off unless the build says otherwise
 *
 * The back office needs to be reachable from any device, which means deploying. The marketing
 * pages on the same build are **not cleared to be published** — they carry claims about the
 * service that are waiting on legal review — and a Netlify subdomain is a public URL like any
 * other. So the default is `Disallow: /`, and `PUBLIC_SITE_PUBLISHED=true` is what a deploy sets
 * once those pages are cleared.
 *
 * Defaulting to disallow rather than to allow is deliberate: forgetting to *add* a block
 * publishes unreviewed claims to search, and forgetting to *remove* one costs a day of indexing.
 * Those are not the same mistake.
 *
 * The back-office pages carry `noindex` in their own `<head>` regardless, and always have.
 */
const published = import.meta.env.PUBLIC_SITE_PUBLISHED === 'true';

export const GET: APIRoute = () =>
  new Response(
    published
      ? [
          `User-agent: *`,
          `Allow: /`,
          // Named explicitly even though each carries `noindex`: a crawler that never fetches
          // them cannot read the meta tag, so the two mechanisms cover different failures.
          `Disallow: /signin`,
          `Disallow: /kitchen`,
          `Disallow: /orders`,
          ``,
          `Sitemap: ${new URL('/sitemap.xml', SITE.url).href}`,
          ``,
        ].join('\n')
      : [
          `# Not published yet. Set PUBLIC_SITE_PUBLISHED=true when the site is cleared to go live.`,
          `User-agent: *`,
          `Disallow: /`,
          ``,
        ].join('\n'),
    { headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
