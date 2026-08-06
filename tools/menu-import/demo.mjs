#!/usr/bin/env node
// Runs the importer against the synthetic sample sheet and prints the report, so the
// output can be reviewed before the real GrayBag_School_Menu file is available.
//
//   node tools/menu-import/demo.mjs            # text report
//   node tools/menu-import/demo.mjs --json     # the JSON an import would consume
//   node tools/menu-import/demo.mjs --write    # also drop the .xlsx next to this file
//
// The data is invented. See test/sample-menu.mjs.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { makeWorkbook } from './test/make-workbook.mjs'
import { SAMPLE_ROWS } from './test/sample-menu.mjs'
import { importMenuWorkbook } from './src/import.mjs'
import { renderReport } from './src/report.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const bytes = makeWorkbook([{ name: 'Menu', rows: SAMPLE_ROWS }])

if (process.argv.includes('--write')) {
  const out = join(here, 'sample-menu.xlsx')
  writeFileSync(out, bytes)
  process.stderr.write(`wrote ${out}\n`)
}

const result = importMenuWorkbook(bytes, { sourceName: 'sample-menu.xlsx (SYNTHETIC)' })

process.stdout.write(
  process.argv.includes('--json')
    ? `${JSON.stringify(result, null, 2)}\n`
    : `${renderReport(result)}\n`,
)
process.exitCode = result.rejected.length > 0 ? 1 : 0
