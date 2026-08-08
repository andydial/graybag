#!/usr/bin/env node
/**
 * Mirror the legacy Bubble dish images off the Bubble CDN (E16-28, decision AR6).
 *
 * The Bubble CDN dies when the app is decommissioned, so this runs NOW rather than at
 * cutover. It downloads to a directory OUTSIDE the repository and writes a manifest with
 * SHA-256 checksums that IS committed — so the repo records exactly what was mirrored and
 * can verify it later, without carrying ~2 MB of binaries in git history.
 *
 * Upload into Supabase Storage is E16-43 and reads the same manifest.
 *
 * Usage:
 *   node tools/mirror-dish-images/mirror.mjs --dishes <path/to/Dishes.csv> [--out <dir>]
 *   node tools/mirror-dish-images/mirror.mjs --verify            # re-check local files
 *
 * The Dishes.csv path is deliberately not defaulted to anything inside the repo: the export
 * contains children's personal data elsewhere and must never be copied in. Only the photo
 * column is read.
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const MANIFEST = new URL('./manifest.json', import.meta.url).pathname
const DEFAULT_OUT = path.join(process.env.HOME ?? '.', 'graybag-dish-images')

/** Minimal RFC-4180 CSV parser — handles quoted fields and embedded commas/newlines. */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\r') { /* ignore */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  if (!rows.length) return []
  const header = rows[0].map((h) => h.replace(/^\uFEFF/, ''))
  return rows.slice(1)
    .filter((r) => r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

/** Bubble exports photo URLs protocol-relative: `//host/f<id>/<name>`. */
export function toHttps(url) {
  const u = (url ?? '').trim()
  if (!u) return null
  if (u.startsWith('//')) return `https:${u}`
  if (u.startsWith('http://')) return `https://${u.slice(7)}`
  if (u.startsWith('https://')) return u
  return null
}

/**
 * Local filename for a mirrored image. The Bubble file id is globally unique and stable,
 * so it prefixes the (URL-decoded, sanitised) original name — two dishes sharing a name
 * cannot collide, and the mapping back to the source URL stays obvious.
 */
export function localName(url) {
  const parts = new URL(toHttps(url)).pathname.split('/').filter(Boolean)
  const fileId = parts.at(-2) ?? 'unknown'
  const raw = decodeURIComponent(parts.at(-1) ?? 'image')
  const safe = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return `${fileId}__${safe}`
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function fetchImage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    redirect: 'follow',
  })
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') }
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? null : process.argv[i + 1]
}

async function verify() {
  if (!existsSync(MANIFEST)) throw new Error('no manifest.json — run the mirror first')
  const m = JSON.parse(await readFile(MANIFEST, 'utf8'))
  const outDir = arg('out') ?? m.outDir ?? DEFAULT_OUT
  let ok = 0
  const bad = []
  for (const e of m.images.filter((x) => x.status === 'ok')) {
    const p = path.join(outDir, e.file)
    if (!existsSync(p)) { bad.push(`${e.file}: missing`); continue }
    const buf = await readFile(p)
    if (sha256(buf) !== e.sha256) bad.push(`${e.file}: checksum mismatch`)
    else ok++
  }
  console.log(`verify: ${ok} ok, ${bad.length} bad, in ${outDir}`)
  bad.forEach((b) => console.log('  ' + b))
  if (bad.length) process.exitCode = 1
}

async function mirror() {
  const dishesCsv = arg('dishes')
  if (!dishesCsv) throw new Error('--dishes <path to Dishes.csv> is required')
  const outDir = arg('out') ?? DEFAULT_OUT
  await mkdir(outDir, { recursive: true })

  const rows = parseCsv(await readFile(dishesCsv, 'utf8'))
  const images = []
  let ok = 0
  let failed = 0

  for (const r of rows) {
    const url = toHttps(r.photo)
    // `name` is catalogue copy, not personal data — safe to record in the manifest.
    const dish = (r.name ?? '').trim()
    const id = (r['unique id'] ?? '').trim()
    if (!url) { images.push({ dish, id, url: null, status: 'no-url' }); continue }

    const file = localName(url)
    try {
      const { buf, type } = await fetchImage(url)
      await writeFile(path.join(outDir, file), buf)
      images.push({ dish, id, url, file, bytes: buf.length, contentType: type, sha256: sha256(buf), status: 'ok' })
      ok++
    } catch (e) {
      images.push({ dish, id, url, file, status: 'failed', error: e.status ? `HTTP ${e.status}` : e.message })
      failed++
      console.log(`  FAILED ${e.status ?? ''} ${dish}`)
    }
  }

  const manifest = {
    generated: new Date().toISOString().slice(0, 10),
    task: 'E16-28',
    source: 'Bubble CDN (dies when the Bubble app is decommissioned)',
    outDir,
    note: 'Binaries live outside the repo. This manifest is the committed record; E16-43 uploads from it.',
    counts: { total: images.length, ok, failed, noUrl: images.length - ok - failed },
    images,
  }
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  const mb = (images.filter((i) => i.bytes).reduce((s, i) => s + i.bytes, 0) / 1e6).toFixed(2)
  console.log(`mirrored ${ok}/${images.length} images (${mb} MB) -> ${outDir}`)
  console.log(`failed: ${failed}`)
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const run = process.argv.includes('--verify') ? verify : mirror
  run().catch((e) => { console.error(String(e.message ?? e)); process.exit(1) })
}
