// Human-readable rendering of an import result. Plain text on purpose: this gets
// pasted into a message to whoever maintains the spreadsheet, and it has to be
// readable without the JSON next to it.

import { formatPaise } from './money.mjs'

export function renderReport(result) {
  const lines = []
  const say = (s = '') => lines.push(s)
  const { meta } = result

  say('GrayBag menu import — validation report')
  say('='.repeat(56))
  say(`source            ${meta.source_file ?? '(buffer)'}`)
  say(`sheet             ${meta.sheet ?? '(first)'}`)
  say(`header row        ${meta.header_row}`)
  say(`rows below header ${meta.rows_below_header}`)
  say(`accepted          ${meta.accepted}`)
  say(`rejected          ${meta.rejected}`)
  say(`skipped (blank)   ${meta.skipped}`)
  say(`warnings          ${meta.warnings}`)
  say()

  if (result.file_issues.length > 0) {
    say('File-level notes')
    say('-'.repeat(56))
    for (const issue of result.file_issues) say(`  [${issue.code}] ${issue.message}`)
    say()
  }

  if (result.rejected.length > 0) {
    say(`Rejected rows (${result.rejected.length}) — every one, nothing is truncated`)
    say('-'.repeat(56))
    for (const row of result.rejected) {
      say(`  row ${row.row}: ${row.name ?? '(no name)'}`)
      for (const error of row.errors) say(`      ✗ ${error.code} (${error.field}) — ${error.message}`)
      for (const hint of row.hints ?? []) say(`      · ${hint}`)
    }
    say()
  }

  if (result.warnings.length > 0) {
    say(`Warnings (${result.warnings.length}) — the row was accepted anyway`)
    say('-'.repeat(56))
    for (const warning of result.warnings) {
      say(`  row ${warning.row}: ${warning.code} (${warning.field}) — ${warning.message}`)
    }
    say()
  }

  say('Allergen column analysis  — this is the input to [DM-13]')
  say('-'.repeat(56))
  const a = result.allergen_report
  say(`  blank cells (meaning unknown, not none): ${a.blank_cells}`)
  say(`  cells explicitly declaring none:         ${a.declared_none}`)
  say()
  say('  Codes seen in the data:')
  if (a.codes_used.length === 0) say('    (none)')
  for (const entry of a.codes_used) say(`    ${entry.code.padEnd(14)} ${entry.count}`)
  if (a.codes_unused.length > 0) {
    say(`  Seeded codes never used: ${a.codes_unused.join(', ')}`)
  }
  say()
  say('  Distinct fragments after splitting:')
  for (const f of a.fragments) {
    const target = f.outcome === 'mapped' ? `-> ${f.code}` : `-> ${f.outcome.toUpperCase()}`
    say(`    ${f.fragment.padEnd(24)} ${String(f.count).padStart(3)}  ${target}`)
  }
  say()
  if (a.uncoded.length > 0) {
    say('  ⚠ Recognised allergens with NO code in the seed list:')
    for (const entry of a.uncoded) say(`    ${entry.token} (${entry.count})`)
    say('    -> add these to the `allergen` table before importing, or the dish ships unwarned.')
    say()
  }
  if (a.unmapped.length > 0) {
    say('  ⚠ Text that could not be interpreted at all:')
    for (const entry of a.unmapped) say(`    "${entry.token}" (${entry.count})`)
    say('    -> either a synonym to add to allergens.mjs, or a typo in the spreadsheet.')
    say()
  }
  if (a.uncoded.length === 0 && a.unmapped.length === 0) {
    say('  ✓ Every allergen fragment mapped to a seeded code.')
    say()
  }

  if (result.dishes.length > 0) {
    say(`Accepted dishes (${result.dishes.length})`)
    say('-'.repeat(56))
    for (const dish of result.dishes) {
      const tags = dish.allergens.map((t) => (t.presence === 'contains' ? t.code : `${t.code}?`)).join(' ')
      say(
        `  ${String(dish.row).padStart(4)}  ${dish.name.padEnd(34).slice(0, 34)}  ` +
          `${formatPaise(dish.price_paise).padStart(10)}  ${dish.category_code.padEnd(12)}  ${tags}`,
      )
    }
    say('  (a trailing "?" on an allergen means may_contain)')
    say()
  }

  say(
    result.rejected.length === 0
      ? '✓ Every row passed validation.'
      : `✗ ${result.rejected.length} row(s) need fixing in the spreadsheet before import.`,
  )
  return lines.join('\n')
}
