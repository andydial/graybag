#!/usr/bin/env node
// Serves the backlog and persists every tick straight to disk.
//
//   node scripts/serve-backlog.mjs        -> http://localhost:4321/backlog.html
//
// Leave it running. It is an idle socket listener: ~10 MB RSS, 0% CPU when nobody
// is clicking. Every save also lands in .backlog-history/ as a timestamped copy.

import { createServer } from 'node:http';
import { readFile, writeFile, stat, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_WEB = join(ROOT, 'planning');
const STATE = join(ROOT_WEB, 'backlog-state.json');
const HIST = join(ROOT_WEB, '.backlog-history');
const PORT = Number(process.env.PORT || 4321);
const KEEP = 60;

const TYPES = { '.html': 'text/html', '.json': 'application/json', '.js': 'text/javascript',
                '.mjs': 'text/javascript', '.css': 'text/css', '.md': 'text/plain',
                '.svg': 'image/svg+xml', '.png': 'image/png' };

async function snapshot(text) {
  await mkdir(HIST, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(join(HIST, `backlog-state.${stamp}.json`), text);
  const files = (await readdir(HIST)).filter((f) => f.endsWith('.json')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
    await unlink(join(HIST, f)).catch(() => {});
  }
}

createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'POST' && url === '/state') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const out = JSON.stringify(
          { updated: new Date().toISOString(), done: parsed.done || {} }, null, 2) + '\n';
        await writeFile(STATE, out);
        await snapshot(out);
        const n = Object.keys(parsed.done || {}).length;
        process.stdout.write(`\r  saved — ${n} done                    `);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: n }));
      } catch (e) {
        res.writeHead(400); res.end(String(e.message));
      }
    });
    return;
  }

  if (url === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    try { res.end(await readFile(STATE)); } catch { res.end('{"done":{}}'); }
    return;
  }

  let rel = decodeURIComponent(url);
  if (rel === '/') rel = '/backlog.html';
  const path = join(ROOT_WEB, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  try {
    if ((await stat(path)).isDirectory()) throw new Error('dir');
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`\n  Backlog   http://localhost:${PORT}/backlog.html`);
  console.log(`  Yours     http://localhost:${PORT}/backlog.html#mine`);
  console.log(`\n  Ticks save straight to backlog-state.json. Leave this running.\n`);
});
