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
// Exit codes: 0 clean, 1 one or more rows failed validation, 2 the file could not be read.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { importMenuWorkbook } from './import.mjs'
import { renderReport } from './report.mjs'

const USAGE = `usage: node tools/menu-import/src/cli.mjs <file.xlsx> [--sheet NAME] [--json PATH]
                                            [--stdout-json] [--allow-new-categories] [--quiet]`

function parseArgs(argv) {
  const options = { file: null, sheet: undefined, json: null, stdoutJson: false, allowNewCategories: false, quiet: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--sheet': options.sheet = argv[++i]; break
      case '--json': options.json = argv[++i]; break
      case '--stdout-json': options.stdoutJson = true; break
      case '--allow-new-categories': options.allowNewCategories = true; break
      case '--quiet': options.quiet = true; break
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

  return result.rejected.length > 0 ? 1 : 0
}

process.exitCode = main(process.argv.slice(2))
