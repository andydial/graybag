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
 * ## What it does not do
 *
 * It does not diff, score or gate. A pixel threshold between a hand-built prototype and a real
 * implementation would be noise, and a red build nobody believes is worse than no check. This
 * produces evidence for a person to look at; the judgement stays with the person.
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
 * Which live page answers which prototype screen.
 *
 * `live: null` means the prototype has a screen we have not built. It is still shot — a pane
 * reading "not built" beside the design is the most honest thing this tool can say about it.
 */
const SCREENS = [
  { key: 'today', live: '/dashboard.html?state=demo' },
  { key: 'dishes', live: '/admin/dishes.html?state=demo' },
  { key: 'menus', live: '/admin/menus.html?state=demo' },
  { key: 'schools', live: '/admin/schools.html?state=demo' },
  { key: 'packs', live: null },
  { key: 'orders', live: '/orders.html?state=demo' },
  { key: 'reports', live: '/reports.html?state=demo' },
  { key: 'growth', live: '/admin/growth.html?state=demo' },
  { key: 'people', live: '/admin/people.html?state=demo' },
  { key: 'import', live: '/admin/import.html?state=demo' },
];

const PORT = 8971;
const WIDTH = 1440;
const HEIGHT = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function composite(screen, origin) {
  const right = screen.live
    ? `<iframe id="live" src="${origin}${screen.live}"></iframe>`
    : `<div class="missing"><b>Not built</b><span>${screen.key}</span></div>`;
  return `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{margin:0;font:600 13px/1.4 ui-sans-serif,system-ui;background:#0e1512;color:#cfe0d7;
         display:grid;grid-template-rows:auto 1fr;height:${HEIGHT}px}
    .bar{display:grid;grid-template-columns:1fr 1fr;gap:2px;padding:8px 10px 0}
    .bar span{padding:4px 8px}
    .panes{display:grid;grid-template-columns:1fr 1fr;gap:2px;padding:6px 10px 10px;min-height:0}
    .pane{position:relative;overflow:hidden;border-radius:8px;background:#fff}
    /* The prototype is a fixed 1180px app; scale it to the pane rather than crop it. */
    #proto{width:1520px;height:${Math.round(HEIGHT / 0.46)}px;transform:scale(.46);
           transform-origin:top left;border:0}
    /*
     * The live pane is scaled the same way as the prototype's, and for a sharper reason: the back
     * office collapses its sidebar to a strip below 60rem, so an unscaled 720px pane photographs
     * the *narrow* layout and makes it look as though no sidebar was built.
     */
    #live{width:1520px;height:${Math.round(HEIGHT / 0.46)}px;transform:scale(.46);
          transform-origin:top left;border:0;background:#fff}
    .missing{width:100%;height:100%;border:0;border-radius:8px}
    .missing{display:flex;flex-direction:column;align-items:center;justify-content:center;
             gap:6px;color:#8f271c;background:#fbecea;font-size:20px}
    .missing span{font-size:13px;color:#7b8a83}
  </style>
  <div class="bar"><span>PROTOTYPE — #${screen.key}</span><span>LIVE — ${screen.live ?? 'nothing built'}</span></div>
  <div class="panes"><div class="pane"><iframe id="proto" src="file://${PROTOTYPE}"></iframe></div>
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

for (const screen of list) {
  const page = join(tmpdir(), `gb-parity-${screen.key}.html`);
  writeFileSync(page, composite(screen, origin));
  await send('Page.navigate', { url: `file://${page}` });
  await sleep(2500);
  /*
   * Drive the prototype to the screen under comparison, and hide its state rail — that rail is
   * prototype tooling, not a design element, and it eats a third of the pane.
   */
  await send('Runtime.evaluate', {
    expression: `(() => { const w = document.getElementById('proto').contentWindow;
      const r = w.document.getElementById('rail'); if (r) r.style.display = 'none';
      const a = w.document.getElementById('app'); if (a) { a.style.maxWidth = 'none'; a.style.height = '1900px'; }
      if (typeof w.go === 'function') { w.go(${JSON.stringify(screen.key)}); return 'ok'; }
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
console.log(`\n${list.length} pair(s) written. Open them next to each other before claiming parity.`);
process.exit(0);
