#!/usr/bin/env node
// Usage:
//   node tools/menu-import/src/cli.mjs <file.xlsx> [options]
//
//   --sheet <name>            sheet to read (default: the first)
//   --json <path>             write the full result as JSON (default: stdout only with --stdout-json)
//   --stdout-json             print the JSON result instead of the text report
//   --allow-new-categories    accept categories not in the seed list, as warnings
//   --quiet                   suppress the text report
//
// Diffing against what is already stored (E04-04):
//   --against <snapshot.json> current dishes for this kitchen; produces a PLAN, not a write
//   --plan <path>             write the plan (with the workbook's fingerprint) for review
//   --images <folder>         match dishes to a folder of photos by filename (E04-06);
//                             reports matched / missing / unused and uploads nothing
//   --deactivate-missing      treat a dish absent from the sheet as retired. OFF by default:
//                             a partial sheet is the ordinary case, and treating absence as
//                             deletion turns that into an emptied menu
//
// This command NEVER writes to the database. It produces a plan a human reads; applying it
// is a separate act against that plan, and apply re-checks the workbook's fingerprint so the
// change applied is the change that was reviewed. See src/apply.mjs.
//
// Exit codes: 0 clean, 1 one or more rows failed validation OR the plan has blockers,
//             2 the file could not be read.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { importMenuWorkbook } from './import.mjs'
import { renderReport } from './report.mjs'
import { buildPlan, planBlockers } from './diff.mjs'
import { fingerprint } from './apply.mjs'
import { renderPlan } from './plan-report.mjs'
import { imageBlockers, matchImages, readImageFolder, renderImageReport } from './images.mjs'

const USAGE = `usage: node tools/menu-import/src/cli.mjs <file.xlsx> [--sheet NAME] [--json PATH]
                                            [--stdout-json] [--allow-new-categories] [--quiet]
                                            [--against SNAPSHOT.json] [--plan PATH]
                                            [--deactivate-missing] [--images FOLDER]`

function parseArgs(argv) {
  const options = {
    file: null, sheet: undefined, json: null, stdoutJson: false,
    allowNewCategories: false, quiet: false,
    against: null, plan: null, deactivateMissing: false, images: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--sheet': options.sheet = argv[++i]; break
      case '--json': options.json = argv[++i]; break
      case '--stdout-json': options.stdoutJson = true; break
      case '--allow-new-categories': options.allowNewCategories = true; break
      case '--quiet': options.quiet = true; break
      case '--against': options.against = argv[++i]; break
      case '--plan': options.plan = argv[++i]; break
      case '--deactivate-missing': options.deactivateMissing = true; break
      case '--images': options.images = argv[++i]; break
      case '-h':
      case '--help': options.help = true; break
      default:
        if (arg.startsWith('-')) throw new Error(`unknown option "${arg}"\n${USAGE}`)
        if (options.file !== null) throw new Error(`more than one input file given\n${USAGE}`)
        options.file = arg
    }
  }
  return options
}

function main(argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }
  if (options.help || options.file === null) {
    process.stdout.write(`${USAGE}\n`)
    return options.help ? 0 : 2
  }

  const path = resolve(options.file)
  let bytes
  try {
    bytes = readFileSync(path)
  } catch (error) {
    if (error.code === 'ENOENT') {
      process.stderr.write(
        `error: ${options.file} does not exist.\n\n` +
          'If you are looking for the legacy menu: "GrayBag_School_Menu 1 1.xlsx" is NOT in\n' +
          'this repository. See tools/menu-import/README.md §"The source file is missing".\n' +
          'To see the tool working against a synthetic sample:\n' +
          '  node tools/menu-import/demo.mjs\n',
      )
      return 2
    }
    process.stderr.write(`error: could not read ${options.file}: ${error.message}\n`)
    return 2
  }

  let result
  try {
    result = importMenuWorkbook(bytes, {
      sheet: options.sheet,
      sourceName: options.file,
      allowNewCategories: options.allowNewCategories,
    })
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`)
    return 2
  }

  if (options.json) {
    const out = resolve(options.json)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`)
    if (!options.quiet) process.stderr.write(`wrote ${options.json}\n`)
  }
  if (options.stdoutJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else if (!options.quiet) {
    process.stdout.write(`${renderReport(result)}\n`)
  }

  // E04-06. Independent of --against: an operator often wants to check the photo folder
  // before they have a snapshot to diff against, and the two questions do not depend on
  // each other.
  let imageExit = 0
  if (options.images !== null) {
    try {
      const dir = resolve(options.images)
      const folder = readImageFolder(dir)
      const match = matchImages(result.dishes, folder)
      const blockers = imageBlockers(match)

      if (!options.quiet && !options.stdoutJson) {
        process.stdout.write(`${renderImageReport(match, dir)}\n`)
        for (const ignored of folder.ignored) {
          process.stderr.write(`  ignored ${ignored.name}: ${ignored.reason}\n`)
        }
        for (const b of blockers) process.stderr.write(`  [${b.code}] ${b.message}\n`)
      }
      if (blockers.length > 0) imageExit = 1
    } catch (error) {
      process.stderr.write(`error: could not read --images ${options.images}: ${error.message}\n`)
      return 2
    }
  }

  // No --against means "validate this file", which is the Q08 behaviour and still useful
  // on its own. With it, we can say what would actually change.
  if (options.against === null) return result.rejected.length > 0 || imageExit ? 1 : 0

  // A plan built from a file that failed validation would be a plan to write bad rows.
  if (result.rejected.length > 0) {
    process.stderr.write(
      `error: ${result.rejected.length} row(s) failed validation, so no plan was built.\n` +
        `Fix the sheet and re-run. A plan from a file with rejected rows is a plan with holes in it.\n`,
    )
    return 1
  }

  let snapshot
  try {
    snapshot = JSON.parse(readFileSync(resolve(options.against), 'utf8'))
    if (!Array.isArray(snapshot)) throw new Error('expected a JSON array of dishes')
  } catch (error) {
    process.stderr.write(`error: could not read --against ${options.against}: ${error.message}\n`)
    return 2
  }

  const plan = buildPlan(result.dishes, snapshot, { deactivateMissing: options.deactivateMissing })
  const blockers = planBlockers(plan, snapshot)
  plan.source = { name: options.file, fingerprint: fingerprint(bytes) }
  plan.blockers = blockers

  if (options.plan) {
    const out = resolve(options.plan)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`)
    if (!options.quiet) process.stderr.write(`wrote ${options.plan}\n`)
  }
  if (!options.quiet && !options.stdoutJson) process.stdout.write(`${renderPlan(plan)}\n`)

  return blockers.length > 0 || imageExit ? 1 : 0
}

process.exitCode = main(process.argv.slice(2))
