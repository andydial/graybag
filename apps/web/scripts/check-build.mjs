#!/usr/bin/env node
/**
 * Gates that only a built site can be checked against (`E12-08`).
 *
 *     node apps/web/scripts/check-build.mjs
 *
 * These run as part of `npm --prefix apps/web run build`, so they cannot be forgotten and a
 * failure stops a deploy rather than being noticed later. Everything here is a property of
 * `dist/`, not of the source — which is the point: the budget that matters is the one the
 * visitor downloads, and an internal link is only really broken once it is emitted.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');
const DIST = join(WEB, 'dist');

/**
 * The budgets, with actual numbers because `E12-08` asks for actual numbers.
 *
 * Every one is derived from the same constraint: a mid-range Android on patchy mobile data in a
 * tier-1 Indian city (`P11`). They are set close to the current measured values on purpose — a
 * budget with a lot of slack in it is a budget that never fires, and the failure this exists to
 * catch is gradual.
 */
const BUDGETS = {
  homeHtmlGz: 45_000,
  /*
   * **17,000, down from 18,000 — `E10-62`, and the interim 21,000 is gone.**
   *
   * The back office migration deleted `admin.css` entirely: one design system (`backoffice.css`)
   * replaced the old chrome plus the per-screen rules scattered beside it, and the total came out
   * at 16,384 B — smaller than before the rebuild started, not larger. The ceiling follows it
   * down, because a budget with 5 KB of slack is a budget that never fires.
   */
  cssGz: 17_000,
  jsGz: 10_000,
  totalHomePayload: 400_000,
  thirdPartyRequests: 0,
};

/**
 * Store links — `E12-05`.
 *
 * This list used to forbid every store host outright, because **a dead download button is worse
 * than none** and neither app was published. Both shipped on 2026-08-22, so the rule changed
 * shape rather than being deleted: exactly two URLs are permitted, and any other store host still
 * fails.
 *
 * That keeps the original protection where it still bites — a placeholder, a typo in the Play
 * package (`com.gracord.graybag` is a 404; the listing is `com.Gracord.Graybag`), a TestFlight
 * link left in by accident — while letting the two real ones through.
 */
const ALLOWED_STORE_URLS = [
  'https://apps.apple.com/in/app/graybag/id6749555467',
  'https://play.google.com/store/apps/details?id=com.Gracord.Graybag',
];

const FORBIDDEN_HOSTS = [
  'apps.apple.com',
  'itunes.apple.com',
  'play.google.com',
  'testflight.apple.com',
];

/**
 * Any origin that is not ours.
 *
 * The zero-third-party budget cannot be checked by counting requests without running a browser,
 * so it is checked structurally: no absolute URL to another host may appear in an attribute that
 * causes a fetch. `href` on an `<a>` is fine — linking out is not loading in.
 */
const FETCHING_ATTRS = /(?:src|srcset|data-src)\s*=\s*"([^"]+)"/g;
const STYLESHEET_LINK = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g;
const PRELOAD_LINK = /<link[^>]+rel="preload"[^>]+href="([^"]+)"/g;

const problems = [];
const notes = [];

function fail(message) {
  problems.push(message);
}

if (!existsSync(DIST)) {
  console.error(`No dist/ at ${DIST}. Run astro build first.`);
  process.exit(1);
}

/** Every emitted file, relative to dist/. */
function walk(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(path).isDirectory()) out.push(...walk(path, rel));
    else out.push({ rel, path, bytes: statSync(path).size });
  }
  return out;
}

const files = walk(DIST);
const html = files.filter((f) => extname(f.rel) === '.html');
const gz = (path) => gzipSync(readFileSync(path)).length;

// ---------------------------------------------------------------- budgets

const home = files.find((f) => f.rel === 'index.html');
if (!home) fail('dist/index.html was not emitted.');
else {
  const size = gz(home.path);
  notes.push(`index.html      ${size} B gzipped (budget ${BUDGETS.homeHtmlGz})`);
  if (size > BUDGETS.homeHtmlGz) fail(`index.html is ${size} B gzipped, over ${BUDGETS.homeHtmlGz}.`);
}

const css = files.filter((f) => extname(f.rel) === '.css');
const cssGz = css.reduce((sum, f) => sum + gz(f.path), 0);
notes.push(`css             ${cssGz} B gzipped across ${css.length} file(s) (budget ${BUDGETS.cssGz})`);
if (cssGz > BUDGETS.cssGz) fail(`CSS is ${cssGz} B gzipped, over ${BUDGETS.cssGz}.`);

/**
 * JavaScript is budgeted **per page**, not in total.
 *
 * Summing every `.js` in `dist/` charged the marketing home page for the kitchen dashboard's
 * island, which it never loads — and would have made the budget fire on a page that ships two
 * kilobytes. What a visitor downloads is the only thing worth budgeting, and no visitor
 * downloads two pages at once.
 */
const js = files.filter((f) => extname(f.rel) === '.js');
for (const page of html) {
  const source = readFileSync(page.path, 'utf8');
  const referenced = js.filter((f) => source.includes(f.rel));
  const pageJsGz = referenced.reduce((sum, f) => sum + gz(f.path), 0);
  notes.push(`js ${page.rel.padEnd(13)} ${pageJsGz} B gzipped across ${referenced.length} file(s) (budget ${BUDGETS.jsGz})`);
  if (pageJsGz > BUDGETS.jsGz) fail(`${page.rel} ships ${pageJsGz} B of gzipped JavaScript, over ${BUDGETS.jsGz}.`);
}


/**
 * What a first visit to the home page actually costs.
 *
 * HTML + CSS + JS + the font + every image the home page references without `loading="lazy"`.
 * A lazy image below the fold is not part of first paint and is not counted, which is the whole
 * reason it is lazy.
 */
if (home) {
  const source = readFileSync(home.path, 'utf8');
  const eager = new Set();
  for (const match of source.matchAll(/<img\b[^>]*>/g)) {
    const tag = match[0];
    if (/loading="lazy"/.test(tag)) continue;
    const src = tag.match(/src="([^"]+)"/)?.[1];
    if (src?.startsWith('/')) eager.add(src.slice(1));
  }
  // The pattern is a CSS mask on the hero: it is fetched on first paint even though no <img>
  // names it, so counting only <img> would understate the real cost.
  eager.add('img/pattern.webp');
  eager.add('fonts/nunito-latin-var.woff2');

  // Only the JavaScript this page actually references — the kitchen island is not part of a
  // marketing visitor's first load and must not be charged to it.
  const homeJs = js.filter((f) => source.includes(f.rel));
  let total = statSync(home.path).size + css.reduce((s, f) => s + f.bytes, 0) + homeJs.reduce((s, f) => s + f.bytes, 0);
  for (const rel of eager) {
    const file = files.find((f) => f.rel === rel);
    if (!file) fail(`index.html references /${rel}, which was not emitted.`);
    else total += file.bytes;
  }
  notes.push(`home first load ${total} B uncompressed, ${eager.size} eager asset(s) (budget ${BUDGETS.totalHomePayload})`);
  if (total > BUDGETS.totalHomePayload) {
    fail(`The home page's first load is ${total} B, over ${BUDGETS.totalHomePayload}.`);
  }
}

// ------------------------------------------------------------------ analytics placement
//
// `E12-38`. Andy: *"nothing on authenticated pages."*
//
// Analytics is imported by `index.astro` and must stay there. This asserts it, because "we only
// imported it in one place" is a fact about today and a guard is a fact about every day — and the
// pages it must never reach are the ones a parent signs in to.
{
  const analytics = files.filter((f) => f.rel.endsWith('.js') && readFileSync(f.path, 'utf8').includes('posthog'));
  const AUTHENTICATED = ['signin', 'kitchen', 'orders', 'reports', 'dashboard', 'admin/'];

  for (const page of html) {
    const source = readFileSync(page.path, 'utf8');
    const loadsAnalytics = analytics.some((a) => source.includes(a.rel));
    const isAuthenticated = AUTHENTICATED.some((p) => page.rel.includes(p));

    if (loadsAnalytics && isAuthenticated) {
      fail(
        `${page.rel} loads analytics. Authenticated pages must never be measured (E12-38) — ` +
          `remove the import; it belongs on the marketing site only.`,
      );
    }
  }
}

// --------------------------------------------------- third parties and stores

for (const page of html) {
  const source = readFileSync(page.path, 'utf8');

  /*
   * Every store URL on the page must be one of the two verified listings.
   *
   * Matching the whole URL rather than the host is the point: the host alone would let a typo in
   * the Play package through, and that typo is a 404 — a dead download button, which is the
   * failure this check has always existed to prevent.
   */
  for (const host of FORBIDDEN_HOSTS) {
    if (!source.includes(host)) continue;
    for (const match of source.matchAll(/https?:\/\/[^"'\s<>]+/g)) {
      const url = match[0].replace(/&amp;/g, '&').replace(/[.,)]+$/, '');
      if (!url.includes(host)) continue;
      if (!ALLOWED_STORE_URLS.includes(url)) {
        fail(
          `${page.rel} links to an unverified store URL: ${url}. Only the two listings in ` +
            `ALLOWED_STORE_URLS are permitted — a dead download button is worse than no button ` +
            `(E12-05).`,
        );
      }
    }
  }

  for (const pattern of [FETCHING_ATTRS, STYLESHEET_LINK, PRELOAD_LINK]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const value = match[1] ?? '';
      if (/^https?:\/\//i.test(value)) {
        fail(`${page.rel} fetches a third-party asset: ${value}. The budget is ${BUDGETS.thirdPartyRequests}.`);
      }
    }
  }

  if (/<script\b[^>]*\bsrc="https?:/i.test(source)) {
    fail(`${page.rel} loads a third-party script. The budget is ${BUDGETS.thirdPartyRequests}.`);
  }
}

// ------------------------------------------------------------ internal links

/**
 * Every internal link resolves to something that was emitted.
 *
 * `format: 'file'` means `/privacy` is written as `privacy.html`, so a link that looks right in
 * the source can 404 in production. That is exactly the class of breakage nobody notices until a
 * principal clicks the privacy link and gets a 404 on the one page a regulator cares about.
 */
const emitted = new Set(files.map((f) => f.rel));
const anchors = new Map();

for (const page of html) {
  const source = readFileSync(page.path, 'utf8');
  anchors.set(
    page.rel,
    new Set([...source.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])),
  );
}

for (const page of html) {
  const source = readFileSync(page.path, 'utf8');
  for (const match of source.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    const href = match[1] ?? '';
    if (/^(https?:|mailto:|tel:)/i.test(href)) continue;

    const [pathPart, hash] = href.split('#');
    let target = pathPart;

    if (target === '' || target === undefined) {
      // Same-page anchor.
      if (hash && !anchors.get(page.rel)?.has(hash)) {
        fail(`${page.rel} links to #${hash}, which is not an id on that page.`);
      }
      continue;
    }

    if (!target.startsWith('/')) {
      fail(`${page.rel} has a relative link "${href}"; use an absolute path.`);
      continue;
    }

    const bare = target.replace(/^\//, '');
    const candidates = bare === '' ? ['index.html'] : [bare, `${bare}.html`, `${bare}/index.html`];
    const found = candidates.find((c) => emitted.has(c));

    if (!found) {
      fail(`${page.rel} links to ${href}, which was not emitted.`);
      continue;
    }

    if (hash && !anchors.get(found)?.has(hash)) {
      fail(`${page.rel} links to ${href}, but ${found} has no id "${hash}".`);
    }
  }
}

/**
 * No inline `<script>` anywhere in the build — `E12-36`.
 *
 * `netlify.toml` sends `Content-Security-Policy: … script-src 'self'`, so the browser **refuses**
 * an inline script. There is no console error a visitor would see and no visual failure if the
 * script was progressive enhancement: the page simply behaves as though the code was never
 * written. That is exactly what happened to the home page's motion, which shipped dead — and it
 * passed every check, because a local file server sends no CSP and the page still rendered.
 *
 * `application/ld+json` is data, not script, and is not covered by `script-src`.
 */
const inlineScripts = [];
for (const page of html) {
  const source = readFileSync(page.path, 'utf8');
  for (const tag of source.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = tag[1] ?? '';
    if (/\bsrc=/i.test(attrs)) continue;
    if (/type=["']application\/ld\+json["']/i.test(attrs)) continue;
    inlineScripts.push(`${page.rel}  <script${attrs}>`);
  }
}
if (inlineScripts.length > 0) {
  fail(
    `${inlineScripts.length} inline <script> tag(s), which the site's CSP (script-src 'self') ` +
      `refuses to execute:\n    ${inlineScripts.join('\n    ')}\n` +
      `  Drop \`is:inline\` so Astro bundles it to a file served from the origin.`,
  );
}

// ------------------------------------------------------------------- report

console.log('Build checks:');
for (const note of notes) console.log(`  ${note}`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}


console.log(
  `  store links verified against ${ALLOWED_STORE_URLS.length} listing(s), no third-party assets, ` +
    `${html.length} page(s) with sound internal links.`,
);
