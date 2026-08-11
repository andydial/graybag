#!/usr/bin/env node
/**
 * Fetch the Nunito webfont into `apps/web/public/fonts/`.
 *
 *     node apps/web/scripts/fetch-fonts.mjs
 *
 * ## Why Nunito, and why self-hosted
 *
 * **Nunito, not VAG Rounded Next.** VAG Rounded Next is the brand face, ten weights of it sit
 * in the design package, and its licence has never been checked (`E19-03`, still open). A
 * webfont is redistribution in the plainest possible sense — the bytes are served to anyone who
 * loads the page — so the site cannot use it until that question is answered. Nunito is the
 * substitute decision `DS-02` already names, and it is SIL OFL, which permits exactly this.
 * `ux-spec.md` §3.2 records Andy's ruling: ship the rounded fallback everywhere, do not block on
 * the licence. Because the family is one token, swapping it later is a one-line change.
 *
 * **Self-hosted, not `fonts.googleapis.com`.** A stylesheet request to Google, then a font
 * request to `fonts.gstatic.com`, is two extra DNS lookups, two TLS handshakes and two
 * round-trips on the far side of a connection this site exists to be fast on. It is also a
 * third-party request, and the performance budget for this site is **zero** of those. Self-hosted
 * the font is one same-origin request that can be `<link rel=preload>`ed in the same document
 * that needs it.
 *
 * ## One variable file, not three static ones
 *
 * `design-tokens.md` §3.1 bundles three weights — 400 Regular, 500 Medium, 600 SemiBold. As
 * static files that is three requests. Nunito ships as a variable font, so the 400-600 range
 * comes as **one** file that is smaller than two static ones, and the `font-weight` axis is then
 * continuous. Latin subset only — `P10`, English only.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'public', 'fonts');

/**
 * The `css2` endpoint returns different formats per User-Agent. A modern Chrome string is what
 * gets `woff2` plus `unicode-range` subsetting; without it Google serves `ttf`, which is roughly
 * three times the size.
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36';

const CSS_URL = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400..600&display=swap';

const css = await fetch(CSS_URL, { headers: { 'User-Agent': UA } }).then((r) => {
  if (!r.ok) throw new Error(`Google Fonts returned ${r.status}`);
  return r.text();
});

/**
 * Take the `latin` block only.
 *
 * The response is a sequence of `@font-face` rules, one per unicode-range, in a fixed order that
 * ends with `latin`. Matching on the `unicode-range` rather than on position is what stops this
 * silently picking up Cyrillic the day Google reorders them.
 */
const blocks = css.split('@font-face').slice(1);
const latin = blocks.find(
  (b) => b.includes('U+0000-00FF') && !b.includes('U+0460') && !b.includes('U+0370'),
);
if (!latin) throw new Error('No latin block in the Google Fonts response.');

const url = latin.match(/url\((https:\/\/[^)]+\.woff2)\)/)?.[1];
const range = latin.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
if (!url || !range) throw new Error('Could not parse the latin @font-face block.');

const bytes = Buffer.from(await fetch(url).then((r) => r.arrayBuffer()));

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'nunito-latin-var.woff2'), bytes);
writeFileSync(
  join(OUT, 'SOURCE.txt'),
  [
    'Nunito, variable weight axis 400-600, latin subset.',
    '',
    'Licence: SIL Open Font License 1.1 — https://openfontlicense.org',
    'Committed rather than fetched at build time so a clean CI checkout can build offline,',
    'and self-hosted rather than loaded from Google so the page makes zero third-party requests.',
    '',
    `Fetched from: ${CSS_URL}`,
    `File: ${url}`,
    `unicode-range: ${range}`,
    `Bytes: ${bytes.length}`,
    '',
    'Regenerate: node apps/web/scripts/fetch-fonts.mjs',
    '',
    'NOTE: Nunito is the substitute named by decision DS-02. The brand face is VAG Rounded',
    'Next, whose licence is unresolved (E19-03) and which therefore cannot be served as a',
    'webfont. Swapping it in later is one line in src/styles/base.css.',
  ].join('\n'),
  'utf8',
);

console.log(`Wrote nunito-latin-var.woff2 — ${bytes.length} bytes`);
console.log(`unicode-range: ${range}`);
