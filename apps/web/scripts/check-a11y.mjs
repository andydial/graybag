#!/usr/bin/env node
/**
 * The accessibility gate (`E12-08`).
 *
 *     node apps/web/scripts/check-a11y.mjs
 *
 * Runs axe-core against every built page in a real browser and fails on any violation at
 * WCAG 2.1 A or AA. `E13-10` already makes `outline: none` without a replacement a CI failure
 * for the app; this is the same principle for the site — **a budget, not a review**. A one-off
 * audit tells you about the day it ran.
 *
 * ## Why it drives Chrome directly
 *
 * There is no Playwright or Puppeteer in this repository and adding one would pull a browser
 * download into every CI run. Chrome is already on the machine, Node 22 ships a global
 * `WebSocket`, and the DevTools Protocol is enough: navigate, inject `axe.min.js`, run it, read
 * the result. That is about eighty lines and no dependency beyond `axe-core` itself, which is
 * one file.
 *
 * ## The threshold
 *
 * **Zero violations**, at `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa`. Not "no criticals" —
 * this is five pages of static content and there is nothing here that legitimately fails.
 *
 * Colour is largely handled before axe sees it: every value comes from the semantic role map,
 * whose pairs are asserted at full float precision by `E13-13`. What axe adds is everything
 * contrast tests cannot see — landmarks, heading order, form labelling, accessible names,
 * duplicate ids, and the `aria-*` attributes on the hero illustration.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');
const DIST = join(WEB, 'dist');

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** The pages to check, as emitted by `format: 'file'`. */
/**
 * `/kitchen` carries `?state=` so the board itself is audited rather than the sign-in redirect.
 *
 * Any `?state=` value pins the page to fixtures — a signed-out visit to the live dashboard
 * correctly bounces to `/signin`, which is right behaviour and useless to audit here, since
 * `/signin` is on this list in its own right.
 */
const PAGES = [
  '/index.html',
  '/privacy.html',
  '/terms.html',
  '/refunds.html',
  '/thanks.html',
  '/kitchen.html?state=default',
  // `?state=` renders fixtures instead of reaching the backend, the same switch `/kitchen` uses.
  // Without it this audits the sign-in redirect rather than the screen (`E10-06`).
  '/admin/config.html?state=demo',
  '/admin/schools.html?state=demo',
  '/kitchen/sheet.html?state=default',
  '/admin/dishes.html?state=demo',
  '/admin/menus.html?state=demo',
  '/admin/packs.html?state=demo',
  // `E10-27`. Its fixture carries the four states worth auditing: an operator with a long list,
  // a cook with two, an account holding nothing, and a disabled account that still holds access.
  '/admin/people.html?state=demo',
  // `E10-29`. Its demo file is deliberately not clean — an unchanged row, a create, and a
  // blocker — so the audit sees the report in the state it is actually read in.
  '/admin/import.html?state=demo',
  // `E10-33`. The fixture carries a tagged dish, an explicitly-none dish and two unchecked
  // ones, so the audit sees the guess chips and the three states rather than an empty list.
  '/admin/allergens.html?state=demo',
  '/reports.html?state=demo',
  // `E11-08`. Its fixture carries quiet days, a school with nobody at it, siblings and a second
  // guardian, so the audit sees the charts and the tables rather than an empty state.
  '/admin/growth.html?state=demo',
  // `E08-16`. Its fixture carries a paused recipient and a kitchen with nobody listed — the two
  // states that mean "no email will arrive", which is what this screen exists to make visible.
  '/admin/alerts.html?state=demo',
  // `E11-12`. Its fixture carries late-night orders, a spike, a quiet weekend and unpaid rows —
  // the cases the screen exists to show, rather than a clean climb.
  '/admin/sales.html?state=demo',
  // `E10-43`. The demo state reveals every route, so this audits the full navigation — the panel
  // it opens is audited here too, because the toggle is on every one of the pages above.
  '/dashboard.html?state=demo',
  '/signin.html',
];

const RULE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(DIST)) {
  console.error('No dist/. Run `npm --prefix apps/web run build` first.');
  process.exit(1);
}

if (!existsSync(CHROME)) {
  console.error(
    `No Chrome at ${CHROME}. Set CHROME_PATH.\n` +
      'Skipping the accessibility gate would be worse than failing it, so this is an error.',
  );
  process.exit(1);
}

// npm hoists workspace dependencies to the repository root, so `axe-core` is usually there
// rather than beside this package. Resolve it rather than assuming either location.
const axePath = fileURLToPath(import.meta.resolve('axe-core/axe.min.js'));
const axeSource = readFileSync(axePath, 'utf8');

// ------------------------------------------------------------------ static server

const server = createServer((request, response) => {
  const requested = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
  // Resolve `/signin` to `signin.html`, which is what Netlify does and what `format: 'file'`
  // requires. Without it a redirect under test lands on a 404 whose empty document then fails
  // `html-has-lang` and `document-title` — two violations that say nothing about the page.
  const candidates = [requested, `${requested}.html`, join(requested, 'index.html')];
  const path = candidates
    .map((c) => join(DIST, c))
    .find((c) => c.startsWith(DIST) && existsSync(c) && !statSync(c).isDirectory());

  if (!path) {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
  response.end(readFileSync(path));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// ------------------------------------------------------------------------ chrome

const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'gb-a11y-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function debuggerUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = targets.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chrome did not expose a debugging endpoint');
}

const ws = new WebSocket(await debuggerUrl());
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

let seq = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(JSON.stringify(message.error)));
  else resolve(message.result);
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Page.enable');
await send('Runtime.enable');

// A phone, because that is what this site is read on (P11) — and because a violation that only
// appears at a narrow width, where the nav collapses, is one a desktop audit never sees.
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});

// --------------------------------------------------------------------------- run

let failures = 0;

for (const page of PAGES) {
  await send('Page.navigate', { url: `${origin}${page}` });
  await sleep(900);

  await send('Runtime.evaluate', { expression: axeSource });

  const { result } = await send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(RULE_TAGS)} } })
      .then(r => ({
        violations: r.violations.map(v => ({
          id: v.id, impact: v.impact, help: v.help,
          nodes: v.nodes.slice(0, 4).map(n => n.target.join(' ') + ' — ' + n.failureSummary.replace(/\\s+/g, ' ').slice(0, 160)),
        })),
        passes: r.passes.length,
      }))`,
  });

  const { violations, passes } = result.value;

  if (violations.length === 0) {
    console.log(`  ${page.padEnd(16)} 0 violations (${passes} checks passed)`);
    continue;
  }

  failures += violations.length;
  console.error(`\n  ${page} — ${violations.length} violation(s):`);
  for (const violation of violations) {
    console.error(`    [${violation.impact}] ${violation.id}: ${violation.help}`);
    for (const node of violation.nodes) console.error(`        ${node}`);
  }
}

ws.close();
chrome.kill();
server.close();

if (failures) {
  console.error(`\n${failures} accessibility violation(s). The budget is 0 (E12-08).`);
  process.exit(1);
}

console.log(`Accessibility: ${PAGES.length} pages, 0 violations at ${RULE_TAGS.join(', ')}.`);
process.exit(0);
