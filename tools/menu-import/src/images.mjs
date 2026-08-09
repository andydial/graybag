// Matching a folder of images to the dishes that name them (E04-06).
//
// The workflow this serves: a kitchen sends a spreadsheet and a folder of photos. The sheet's
// optional `image_filename` column (E04-05) names one per dish. This module answers "which
// file belongs to which dish, and what does not line up" — and then, like every other part of
// this importer, it produces a PLAN rather than uploading anything (MI8).
//
// WHY MATCHING IS NOT `filename === filename`
//
// The names come from two different humans on two different machines. `Veg Sandwich.JPG` in
// the sheet and `veg-sandwich.jpg` on disk are the same photo, and a matcher that says
// otherwise makes the operator rename fifty files by hand — which they will do inconsistently,
// and then the next import breaks differently. So the comparison is normalised, and every
// relaxation is a rule written down here rather than a regex someone tuned until it worked.
//
// WHAT IT REFUSES TO GUESS
//
// It will not match on dish *name*. A dish called "Veg Sandwich" and a file called
// `veg-sandwich.jpg` look like a pair, and treating that as a match means a sheet with no
// `image_filename` column silently acquires images by coincidence — including the wrong ones,
// on a menu where the wrong picture sits next to allergen information. The sheet says which
// file it means, or there is no match.

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** Formats a browser will render and a pipeline (E04-07) can transcode. */
export const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.heic']

/**
 * The comparison key.
 *
 * Lowercase, drop the extension, and collapse every run of non-alphanumerics to a single
 * hyphen. That makes `Veg Sandwich.JPG`, `veg-sandwich.jpg`, `veg_sandwich.jpeg` and
 * `Veg  Sandwich (1).png` all distinct from each other only where they should be — the last
 * one keeps its `1`, because a `(1)` suffix is usually a duplicate download and silently
 * treating it as the original is how the wrong photo ships.
 */
export function imageKey(filename) {
  const base = path.basename(String(filename ?? ''), path.extname(String(filename ?? '')))
  return base
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function isSupportedImage(filename) {
  return SUPPORTED_EXTENSIONS.includes(path.extname(String(filename ?? '')).toLowerCase())
}

/**
 * Read a folder. Non-recursive, and deliberately so: a kitchen's photo folder is flat, and
 * walking subdirectories would pick up `.thumbnails/` and OS preview caches, which match
 * real filenames and are the wrong file.
 *
 * @returns {{files: Array<{name: string, key: string, path: string, bytes: number}>,
 *            ignored: Array<{name: string, reason: string}>}}
 */
export function readImageFolder(dir, { readDir = readdirSync, stat = statSync } = {}) {
  const files = []
  const ignored = []

  for (const name of readDir(dir)) {
    if (name.startsWith('.')) {
      // `.DS_Store`, `._Veg Sandwich.jpg` (macOS resource forks — these DO have image
      // extensions and would otherwise match a real dish).
      ignored.push({ name, reason: 'dotfile' })
      continue
    }
    const full = path.join(dir, name)
    let info
    try {
      info = stat(full)
    } catch (error) {
      ignored.push({ name, reason: `unreadable: ${error.message}` })
      continue
    }
    if (info.isDirectory()) {
      ignored.push({ name, reason: 'directory (folders are not searched)' })
      continue
    }
    if (!isSupportedImage(name)) {
      ignored.push({ name, reason: `unsupported extension (${SUPPORTED_EXTENSIONS.join(' ')})` })
      continue
    }
    files.push({ name, key: imageKey(name), path: full, bytes: info.size })
  }

  return { files, ignored }
}

/**
 * Match dishes to files.
 *
 * Every dish and every file lands in exactly one bucket — the same accounting rule as `MI3`,
 * because an image importer that quietly drops the four files it did not understand produces
 * a menu that is *almost* illustrated, which is the hardest kind of wrong to notice.
 *
 * @param {Array<{name: string, image_filename: string|null}>} dishes  accepted rows
 * @param {{files: Array<{name: string, key: string, path: string, bytes: number}>}} folder
 */
export function matchImages(dishes, folder) {
  const byKey = new Map()
  const duplicateKeys = new Map()

  for (const file of folder.files) {
    if (byKey.has(file.key)) {
      const seen = duplicateKeys.get(file.key) ?? [byKey.get(file.key).name]
      seen.push(file.name)
      duplicateKeys.set(file.key, seen)
      continue
    }
    byKey.set(file.key, file)
  }

  const matched = []
  const missing = []
  const noImageNamed = []
  const usedKeys = new Set()

  for (const dish of dishes) {
    const named = dish.image_filename
    if (named === null || named === undefined || String(named).trim() === '') {
      noImageNamed.push({ dish: dish.name })
      continue
    }
    const key = imageKey(named)
    const file = byKey.get(key)
    if (!file) {
      missing.push({ dish: dish.name, named: String(named) })
      continue
    }
    usedKeys.add(key)
    matched.push({ dish: dish.name, named: String(named), file: file.name, path: file.path, bytes: file.bytes })
  }

  const orphans = folder.files
    .filter((f) => !usedKeys.has(f.key))
    .filter((f, i, all) => all.findIndex((o) => o.key === f.key) === i)
    .map((f) => ({ file: f.name, bytes: f.bytes }))

  return {
    matched,
    /** The sheet names a file that is not in the folder. */
    missing,
    /** A file nothing references. */
    orphans,
    /** Dishes with no `image_filename` at all — not an error, just unillustrated. */
    noImageNamed,
    /**
     * Two files normalising to one key. NOT resolved by picking one: `veg-sandwich.jpg` and
     * `Veg Sandwich.png` are two different photos and only the operator knows which is
     * current.
     */
    ambiguous: [...duplicateKeys.entries()].map(([key, names]) => ({ key, files: names })),
    summary: {
      matched: matched.length,
      missing: missing.length,
      orphans: orphans.length,
      no_image_named: noImageNamed.length,
      ambiguous: duplicateKeys.size,
      total_bytes: matched.reduce((sum, m) => sum + m.bytes, 0),
    },
  }
}

/**
 * Reasons an image plan must not be applied without an explicit override.
 *
 * Same stance as `planBlockers`: neither is a validation error, both are the shape of "the
 * operator pointed at the wrong folder".
 */
export function imageBlockers(match, { maxMissingShare = 0.5 } = {}) {
  const blockers = []
  const named = match.matched.length + match.missing.length

  if (match.ambiguous.length > 0) {
    blockers.push({
      code: 'ambiguous_filenames',
      message:
        `${match.ambiguous.length} filename(s) differ only by case, punctuation or extension: ` +
        match.ambiguous.map((a) => a.files.join(' / ')).join('; ') +
        `. Only you know which is current — rename or remove one and re-run.`,
    })
  }

  if (named > 0 && match.missing.length / named > maxMissingShare) {
    blockers.push({
      code: 'most_images_missing',
      message:
        `${match.missing.length} of ${named} named images are not in this folder. ` +
        `That is usually the wrong folder rather than a half-finished photo shoot. ` +
        `Re-run with --force if the rest are genuinely still to come.`,
    })
  }

  return blockers
}

/** A human-readable report. Nothing is uploaded; this is what the operator reads first. */
export function renderImageReport(match, dir) {
  const out = []
  const s = match.summary
  const mb = (bytes) => `${(bytes / 1_000_000).toFixed(1)} MB`

  out.push('DISH IMAGE PLAN')
  out.push('='.repeat(64))
  out.push(`folder: ${dir}`)
  out.push('')
  out.push(
    `  ${s.matched} matched (${mb(s.total_bytes)}) · ${s.missing} missing · ` +
      `${s.orphans} unused · ${s.no_image_named} dishes name no image`,
  )
  out.push('')

  if (match.ambiguous.length > 0) {
    out.push('AMBIGUOUS — two files, one name')
    out.push('-'.repeat(64))
    for (const a of match.ambiguous) out.push(`  ${a.files.join('  /  ')}`)
    out.push('    (they differ only by case, punctuation or extension. Nothing is guessed.)')
    out.push('')
  }

  if (match.missing.length > 0) {
    out.push(`NAMED BUT NOT FOUND (${match.missing.length})`)
    out.push('-'.repeat(64))
    for (const m of match.missing) out.push(`  ${m.dish} -> ${m.named}`)
    out.push('')
  }

  if (match.orphans.length > 0) {
    out.push(`IN THE FOLDER, REFERENCED BY NOTHING (${match.orphans.length})`)
    out.push('-'.repeat(64))
    for (const o of match.orphans) out.push(`  ${o.file}`)
    out.push('    (add the filename to the sheet\'s image_filename column to use these.)')
    out.push('')
  }

  if (match.noImageNamed.length > 0) {
    out.push(`NO IMAGE NAMED (${match.noImageNamed.length})`)
    out.push('-'.repeat(64))
    for (const d of match.noImageNamed) out.push(`  ${d.dish}`)
    out.push('')
  }

  out.push('Nothing has been uploaded. This is a plan.')
  return out.join('\n')
}
