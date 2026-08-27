#!/usr/bin/env node
/**
 * A screenshot of the prototype and the live screen, side by side — `E10-55`.
 *
 *     node scripts/parity-shot.mjs                # every screen
 *     node scripts/parity-shot.mjs menus dishes   # named screens
 *
 * Andy, 2026-08-27:
 *
 * > *"The check that would have caught this is opening the live screen next to the prototype.
 * > Build that into your own process — a screenshot pair per screen in the PR — rather than
 * > relying on me noticing."*
 *
 * ## Why this exists
 *
 * The back office shipped built to the prototype's *concept* and not its design: no sidebar, none
 * of its components, no page subtitles, and a header 120px out of line. Every automated check
 * passed, because every automated check asked "does this screen work?" and the answer was yes.
 * Smoke, the unit tests, the a11y sweep and my own DOM probes are all blind to "this does not look
 * like the thing we agreed on", and no amount of more of them would have caught it.
 *
 * The one check that would have is looking. This makes looking cheap and repeatable, and puts the
 * result in the pull request where it is reviewed rather than in a terminal where it is not.
 *
 * ## One image, not two
 *
 * Both panes are rendered as `<iframe>`s inside a single composite page, which is then captured
 * whole. Two separate PNGs would need an image library to join and would be compared by flicking
 * between them; a single image is comparable at a glance, which is the entire point.
 *
 * The prototype pane is driven by calling its own `go('menus')` from the composite page. The admin
 * prototype has **no** hash routing — that is the parent-facing prototype, and assuming otherwise
 * is what made the first run of this tool photograph the Dishes screen and label it Menus. It also
 * renders at a fixed 1180px, so the pane is scaled to fit rather than cropped: a cropped pane
 * hides exactly the right-hand column the comparison is about.
 *
 * ## It also asserts the page is *styled at all*
 *
 * The screenshots alone were not enough, and the way they failed is worth stating. `/orders`
 * reached production rendering as raw HTML. This tool photographed it — the image was written,
 * correct, and showed the problem plainly. **Nobody opened it.** I reported "all fifteen routes on
 * the shell, verified", and what I had actually verified was that the markup was right and the
 * console was clean, neither of which an unstyled page violates.
 *
 * So a tool whose only output is pictures is a tool whose value depends on somebody looking at
 * every picture, every time. Below, each route is also **measured**: if the shell's stylesheet did
 * not load, every computed style falls back to the user agent's, and that is checkable without
 * eyes. The screenshots stay — they catch what measurement cannot — but the obvious catastrophe
 * now fails loudly in a terminal.
 *
 * ## What it still does not do
 *
 * It does not diff, score or gate on appearance. A pixel threshold between a hand-built prototype
 * and a real implementation would be noise, and a red build nobody believes is worse than no
 * check. Judgement about whether a screen *looks right* stays with a person; only "this page has
 * no styling" is automated, because that one needs no judgement.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/prototype-parity');
const DIST = join(ROOT, 'apps/web/dist');
const PROTOTYPE = join(ROOT, 'docs/prototype/graybag-admin-prototype.html');

/**
 * **Every back-office route**, not only the ones the prototype drew — `E10-60`.
 *
 * The first version of this list held the prototype's ten screens, and that turned out to be the
 * bug rather than the scope. Andy, 2026-08-28:
 *
 * > *"A screenshot tool that only photographs the screens you already know about can't find the
 * > ones you forgot… it found three defects on screens it covers, while the screens it doesn't
 * > cover shipped visibly broken."*
 *
 * Order alerts, Sales, Configuration, Allergens and the Packing sheet have no prototype screen, so
 * they were never photographed, so nobody looked at them, so they went to production with the
 * shell around raw markup. The list is now the **nav**, and a route with no design still gets a
 * picture — captioned as having none, and shot full width because there is nothing to sit beside.
 */
const SCREENS = [
  // Run the day.
  { key: 'kitchen', live: '/kitchen.html?state=demo', prototype: null },
  { key: 'sheet', live: '/kitchen/sheet.html?state=demo', prototype: null },
  { key: 'orders', live: '/orders.html?state=demo', prototype: 'orders' },
  // Understand.
  { key: 'reports', live: '/reports.html?state=demo', prototype: 'reports' },
  { key: 'sales', live: '/admin/sales.html?state=demo', prototype: null },
  { key: 'growth', live: '/admin/growth.html?state=demo', prototype: 'growth' },
  // The catalogue.
  { key: 'dishes', live: '/admin/dishes.html?state=demo', prototype: 'dishes' },
  { key: 'menus', live: '/admin/menus.html?state=demo', prototype: 'menus' },
  { key: 'schools', live: '/admin/schools.html?state=demo', prototype: 'schools' },
  { key: 'config', live: '/admin/config.html?state=demo', prototype: null },
  { key: 'allergens', live: '/admin/allergens.html?state=demo', prototype: null },
  // Admin.
  { key: 'people', live: '/admin/people.html?state=demo', prototype: 'people' },
  { key: 'import', live: '/admin/import.html?state=demo', prototype: 'import' },
  { key: 'alerts', live: '/admin/alerts.html?state=demo', prototype: null },
  // The landing page, which is not in the nav because it is what the nav hangs off.
  { key: 'today', live: '/dashboard.html?state=demo', prototype: 'today' },
  // In the prototype and not built at all.
  { key: 'packs', live: '/admin/packs.html?state=demo', prototype: 'packs' },
];

const PORT = 8971;
const WIDTH = 1440;
const HEIGHT = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function composite(screen, origin) {
  const solo = screen.prototype === null;
  const right = screen.live
    ? `<iframe id="live" src="${origin}${screen.live}"></iframe>`
    : `<div class="missing"><b>Not built</b><span>${screen.key}</span></div>`;
  return `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{margin:0;font:600 13px/1.4 ui-sans-serif,system-ui;background:#0e1512;color:#cfe0d7;
         display:grid;grid-template-rows:auto 1fr;height:${HEIGHT}px}
    .bar{display:grid;grid-template-columns:${solo ? '1fr' : '1fr 1fr'};gap:2px;padding:8px 10px 0}
    .bar span{padding:4px 8px}
    .panes{display:grid;grid-template-columns:${solo ? '1fr' : '1fr 1fr'};gap:2px;padding:6px 10px 10px;min-height:0}
    .pane{position:relative;overflow:hidden;border-radius:8px;background:#fff}
    /* The prototype is a fixed 1180px app; scale it to the pane rather than crop it. */
    #proto{width:1520px;height:${Math.round(HEIGHT / 0.46)}px;transform:scale(.46);
           transform-origin:top left;border:0}
    /*
     * The live pane is scaled the same way as the prototype's, and for a sharper reason: the back
     * office collapses its sidebar to a strip below 60rem, so an unscaled 720px pane photographs
     * the *narrow* layout and makes it look as though no sidebar was built.
     */
    /*
     * A realistic desktop viewport, scaled to the pane — never a viewport nobody owns.
     * The first solo shot rendered 3160px wide, which made the content look as though it stretched
     * badly when the real cause was the harness inventing a screen twice the size of a laptop.
     */
    #live{width:${solo ? 1560 : 1520}px;height:${Math.round(HEIGHT / (solo ? 0.9 : 0.46))}px;
          transform:scale(${solo ? 0.9 : 0.46});transform-origin:top left;border:0;background:#fff}
    .missing{width:100%;height:100%;border:0;border-radius:8px}
    .missing{display:flex;flex-direction:column;align-items:center;justify-content:center;
             gap:6px;color:#8f271c;background:#fbecea;font-size:20px}
    .missing span{font-size:13px;color:#7b8a83}
  </style>
  <div class="bar">${solo
      ? `<span>NO PROTOTYPE SCREEN — judged against the shell's own vocabulary · ${screen.live}</span>`
      : `<span>PROTOTYPE — #${screen.prototype}</span><span>LIVE — ${screen.live ?? 'nothing built'}</span>`}</div>
  <div class="panes">${solo ? '' : `<div class="pane"><iframe id="proto" src="file://${PROTOTYPE}"></iframe></div>`}
  <div class="pane">${right}</div></div>`;
}

const wanted = process.argv.slice(2);
const list = wanted.length > 0 ? SCREENS.filter((s) => wanted.includes(s.key)) : SCREENS;
if (list.length === 0) {
  console.error(`No screen matched. Known: ${SCREENS.map((s) => s.key).join(', ')}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

// A file server over `dist`, so the live pane is the built output rather than a dev server that
// serves different bytes.
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIST, stdio: 'ignore' });
const origin = `http://127.0.0.1:${PORT}`;

const chrome = spawn(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
   `--remote-debugging-port=9781`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'gb-parity-'))}`,
   'about:blank'],
  { stdio: 'ignore' },
);

let ws = null;
for (let i = 0; i < 80 && !ws; i += 1) {
  try {
    const tabs = await fetch('http://127.0.0.1:9781/json/list').then((r) => r.json());
    ws = tabs.find((t) => t.type === 'page')?.webSocketDebuggerUrl ?? null;
  } catch { /* chrome is still starting */ }
  if (!ws) await sleep(200);
}
if (!ws) { console.error('Chrome did not start.'); process.exit(1); }

const sock = new WebSocket(ws);
await new Promise((r) => sock.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
sock.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (!m.id || !pending.has(m.id)) return;
  const p = pending.get(m.id); pending.delete(m.id);
  if (m.error) p.reject(new Error(JSON.stringify(m.error)));
  else p.resolve(m.result);
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, { resolve: res, reject: rej });
  sock.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
});

/** Routes whose stylesheet did not apply. These fail the run — see the header. */
const unstyled = [];

for (const screen of list) {
  /*
   * Measure the route on its own before compositing.
   *
   * It cannot be measured through the composite: that page is `file://` and the pane is `http://`,
   * so `contentDocument` is cross-origin and null — which the first version of this reported as
   * "the live pane did not load" for every route, including the healthy ones. A check that cries
   * wolf on everything is worse than none, so the page is visited directly instead.
   */
  if (screen.live) {
    await send('Page.navigate', { url: `${origin}${screen.live}` });
    await sleep(3500);
    /*
     * A redirect is not a pass.
     *
     * `/orders` has no demo fixture, so it bounces to `/signin` — and the first version of this
     * check found no `.bo` there, concluded "not a shell page", and passed. That is how the tool
     * photographed a sign-in form and called the route healthy while the real page was raw HTML on
     * production. Absence of the shell on a route that should have it is a failure, and comparing
     * the landing path to the requested one says which kind of failure it is.
     *
     * The evaluated expression below stays free of prose deliberately: a backtick in a comment
     * inside a template literal ends the literal, which is exactly how this broke the first time.
     */
    const expectedPath = screen.live.split('?')[0];
    const { result } = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        if (!location.pathname.startsWith(${JSON.stringify(expectedPath)})) {
          return { ok: false, why: 'redirected to ' + location.pathname +
            ' - cannot verify; this route needs a ?state=demo fixture' };
        }
        const bo = document.querySelector('.bo');
        if (!bo) return { ok: false, why: 'no .bo root - this route is not on the shell' };
        const nav = document.querySelector('.bo__nav');
        if (!nav) return { ok: false, why: 'the shell has no sidebar element' };
        const bg = getComputedStyle(nav).backgroundColor;
        const display = getComputedStyle(bo).display;
        if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
          return { ok: false, why: 'the sidebar has no background - the stylesheet did not apply' };
        }
        if (display !== 'flex') {
          return { ok: false, why: 'the shell is not laid out - the stylesheet did not apply' };
        }
        return { ok: true, why: 'styled' };
      })()`,
    });
    const verdict = result?.value ?? { ok: false, why: 'could not measure the page' };
    if (!verdict.ok) unstyled.push(`${screen.key}: ${verdict.why}`);
  }

  const page = join(tmpdir(), `gb-parity-${screen.key}.html`);
  writeFileSync(page, composite(screen, origin));
  await send('Page.navigate', { url: `file://${page}` });
  await sleep(2500);
  /*
   * Drive the prototype to the screen under comparison, and hide its state rail — that rail is
   * prototype tooling, not a design element, and it eats a third of the pane.
   */
  await send('Runtime.evaluate', {
    expression: `(() => { const p = document.getElementById('proto'); if (!p) return 'solo';
      const w = p.contentWindow;
      const r = w.document.getElementById('rail'); if (r) r.style.display = 'none';
      const a = w.document.getElementById('app'); if (a) { a.style.maxWidth = 'none'; a.style.height = '1900px'; }
      if (typeof w.go === 'function') { w.go(${JSON.stringify(screen.prototype)}); return 'ok'; }
      return 'no go()'; })()`,
    returnByValue: true,
  });
  // Both panes boot a script and fetch a fixture; this is generous on purpose, because a shot of a
  // half-rendered page is worse than no shot — it reads as a missing feature.
  await sleep(6000);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const file = join(OUT, `${screen.key}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`  ${screen.key.padEnd(9)} -> docs/prototype-parity/${screen.key}.png`);
}

chrome.kill();
server.kill();

if (unstyled.length > 0) {
  console.error(`\n${unstyled.length} route(s) rendered UNSTYLED:`);
  for (const line of unstyled) console.error(`  ✗ ${line}`);
  console.error(
    '\nThis is the failure that put /orders on production as raw HTML. A screenshot showed it and\n' +
      'nobody opened the screenshot, so it is measured here as well as photographed.',
  );
  process.exit(1);
}

console.log(`\n${list.length} pair(s) written, every route styled.`);
console.log('The measurement only proves the CSS applied. Open the images before claiming parity.');
process.exit(0);
