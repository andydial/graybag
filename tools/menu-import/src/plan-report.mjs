// Rendering a plan for a human to read before anything is written (E04-04).
//
// The report is the control. "Never silently overwrite" is only true if the operator can
// actually see what is about to change, and a 50-row diff printed as raw JSON is a diff
// nobody reads. So: the two kinds of change that can hurt someone are printed first and in
// full, and everything else is summarised.

import { MONEY_FIELDS, SAFETY_FIELDS } from './diff.mjs'

const rupees = (paise) =>
  paise == null ? '—' : `Rs ${(paise / 100).toFixed(2)}`

function formatValue(field, value) {
  if (value == null) return '—'
  if (MONEY_FIELDS.includes(field)) return rupees(value)
  if (field === 'allergens') {
    const codes = (value ?? []).map((t) => (typeof t === 'string' ? t : t.code))
    return codes.length === 0 ? '(none listed)' : codes.join(', ')
  }
  if (field === 'available_days') return (value ?? []).join(',')
  if (field === 'allergens_declared_none') return value ? 'declared none' : 'NOT declared'
  return String(value)
}

const line = (change) =>
  `      ${change.field}: ${formatValue(change.field, change.before)} -> ${formatValue(change.field, change.after)}`

export function renderPlan(plan) {
  const out = []
  const s = plan.summary

  out.push('MENU IMPORT PLAN')
  out.push('='.repeat(64))
  if (plan.source) {
    out.push(`source:      ${plan.source.name}`)
    out.push(`fingerprint: ${plan.source.fingerprint.slice(0, 16)}…`)
  }
  out.push('')
  out.push(
    `  ${s.create} to create · ${s.update} to update · ${s.reactivate} to reactivate · ` +
      `${s.deactivate} to deactivate · ${s.unchanged} unchanged`,
  )
  out.push('')

  // Safety first, literally. A wrong allergen is a child in hospital, and it must not be
  // something an operator has to scroll past forty price changes to notice.
  const safety = [...plan.update, ...plan.reactivate]
    .map((e) => ({ e, changes: e.changes.filter((c) => SAFETY_FIELDS.includes(c.field)) }))
    .filter((x) => x.changes.length > 0)

  if (safety.length > 0) {
    out.push('ALLERGEN CHANGES — read every one of these')
    out.push('-'.repeat(64))
    for (const { e, changes } of safety) {
      out.push(`  ${e.name}`)
      for (const c of changes) out.push(line(c))
    }
    out.push('')
  }

  const money = plan.update
    .map((e) => ({ e, changes: e.changes.filter((c) => MONEY_FIELDS.includes(c.field)) }))
    .filter((x) => x.changes.length > 0)

  if (money.length > 0) {
    out.push('PRICE CHANGES')
    out.push('-'.repeat(64))
    for (const { e, changes } of money) {
      for (const c of changes) out.push(`  ${e.name}: ${formatValue(c.field, c.before)} -> ${formatValue(c.field, c.after)}`)
    }
    out.push('')
  }

  if (plan.create.length > 0) {
    out.push(`NEW DISHES (${plan.create.length})`)
    out.push('-'.repeat(64))
    for (const e of plan.create) out.push(`  + ${e.name}`)
    out.push('')
  }

  if (plan.reactivate.length > 0) {
    out.push(`BACK ON SALE (${plan.reactivate.length})`)
    out.push('-'.repeat(64))
    for (const e of plan.reactivate) out.push(`  ^ ${e.name}`)
    out.push('')
  }

  const otherUpdates = plan.update.filter((e) =>
    e.changes.some((c) => !SAFETY_FIELDS.includes(c.field) && !MONEY_FIELDS.includes(c.field)),
  )
  if (otherUpdates.length > 0) {
    out.push(`OTHER EDITS (${otherUpdates.length})`)
    out.push('-'.repeat(64))
    for (const e of otherUpdates) {
      const fields = e.changes
        .filter((c) => !SAFETY_FIELDS.includes(c.field) && !MONEY_FIELDS.includes(c.field))
        .map((c) => c.field)
      out.push(`  ~ ${e.name} (${fields.join(', ')})`)
    }
    out.push('')
  }

  // Missing is reported even when nothing will be done about it, because "the sheet does
  // not mention these" is the single most useful signal that the wrong file was exported.
  if (plan.missing.length > 0) {
    const willDeactivate = plan.deactivate.length > 0
    out.push(
      willDeactivate
        ? `TO BE RETIRED (${plan.deactivate.length}) — absent from the sheet`
        : `ABSENT FROM THE SHEET (${plan.missing.length}) — left alone`,
    )
    out.push('-'.repeat(64))
    for (const e of plan.missing) out.push(`  ${willDeactivate ? '-' : '?'} ${e.name}`)
    if (!willDeactivate) {
      out.push('    (nothing happens to these. --deactivate-missing retires them.)')
    }
    out.push('')
  }

  if (plan.blockers?.length > 0) {
    out.push('BLOCKED')
    out.push('='.repeat(64))
    for (const b of plan.blockers) out.push(`  [${b.code}] ${b.message}`)
    out.push('')
  }

  out.push('Nothing has been written. This is a plan.')
  return out.join('\n')
}
