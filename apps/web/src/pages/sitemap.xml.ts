import type { APIRoute } from 'astro';

import { SITE } from '../content/site.js';
import { POLICIES } from '../lib/policy.js';

/**
 * The sitemap (`E12-07`).
 *
 * Hand-built rather than via `@astrojs/sitemap`, because the site is five URLs and the
 * integration would be a dependency that exists to enumerate a list this file can hold in
 * full — and it would also list `/thanks`, which is a form-submission landing page and has no
 * business in search results.
 *
 * No `lastmod`. A date that is really "when the build ran" is noise, and search engines
 * discount it; an honest `lastmod` needs per-page content dates we do not have.
 */
const PAGES = [
  { path: '/', priority: '1.0', changefreq: 'monthly' },
  ...Object.values(POLICIES).map((policy) => ({
    path: policy.path,
    priority: '0.3',
    changefreq: 'yearly',
  })),
];

export const GET: APIRoute = () =>
  new Response(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...PAGES.map((page) =>
        [
          '  <url>',
          `    <loc>${new URL(page.path, SITE.url).href}</loc>`,
          `    <changefreq>${page.changefreq}</changefreq>`,
          `    <priority>${page.priority}</priority>`,
          '  </url>',
        ].join('\n'),
      ),
      '</urlset>',
      '',
    ].join('\n'),
    { headers: { 'content-type': 'application/xml; charset=utf-8' } },
  );
