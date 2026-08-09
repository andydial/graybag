// Turning a parsed workbook into a plan against what is already in the database
// (E04-04: validate, preview a diff, then apply — never silently overwrite).
//
// This module is pure. It takes the dishes `import.mjs` produced and a snapshot of the
// dishes currently stored for one kitchen, and returns a plan. It performs no I/O and
// knows nothing about Supabase, which is what makes every rule below testable without a
// database and what keeps the dangerous decisions out of the code that holds a connection.
//
// THE RULE THE WHOLE FILE SERVES. An import must never change something the operator did
// not see. That is stronger than "ask before overwriting": it means every field-level
// change is enumerated in the plan with its before and after, and applying is a separate
// act against a plan whose source workbook is fingerprinted. An importer that silently
// updates is indistinguishable from one that silently corrupts until someone checks a
// price, and by then the orders have been placed at it.

/**
 * How a workbook row is matched to an existing dish.
 *
 * `lower(name)` within a kitchen, which is exactly `uq_dish_kitchen_name` in
 * `0001_initial_schema.sql`. Matching on anything else would let the importer create a row
 * the database then rejects — the schema already decided what identity means here, and a
 * second opinion in the importer is how "re-running the import duplicates everything"
 * happens.
 *
 * `Item No.` is deliberately NOT the key. It is a spreadsheet ordinal: it renumbers when
 * somebody sorts the sheet, and the legacy file has no guarantee it is stable between
 * versions. Keying on it would rename dishes wholesale on the first re-sort.
 */
export function matchKey(name) {
  return String(name ?? '').trim().toLowerCase()
}

/** Fields compared between a workbook row and a stored dish, in report order. */
export const COMPARED_FIELDS = [
  'name',
  'description',
  'ingredients_text',
  'calories_kcal',
  'portion_text',
  'category_code',
  'price_paise',
  'image_filename',
  'available_days',
  'allergens',
  'allergens_declared_none',
]

/**
 * Fields whose change is called out separately in the preview.
 *
 * Not a severity system — every change is shown. This is about what an operator scanning a
 * 50-row diff must not be able to miss. `MI2`'s rule is that what fails versus what warns is
 * decided by whether being wrong could hurt someone, and the same question decides what gets
 * its own heading: a wrong price is money, and a wrong allergen is a child in hospital.
 */
export const SAFETY_FIELDS = ['allergens', 'allergens_declared_none']
export const MONEY_FIELDS = ['price_paise']

function normaliseForCompare(field, value) {
  if (value === undefined) return null
  if (field === 'allergens') {
    // Order is not meaningful — the tags are a set. Comparing arrays positionally would
    // report a change every time the source cell listed the same allergens differently.
    const codes = (value ?? []).map((t) => (typeof t === 'string' ? t : t.code)).filter(Boolean)
    return [...codes].sort().join(',')
  }
  if (field === 'available_days') {
    return [...(value ?? [])].map(Number).sort((a, b) => a - b).join(',')
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  return value ?? null
}

/** The changed fields between a stored dish and an incoming row, with before and after. */
function fieldChanges(existing, incoming) {
  const changes = []
  for (const field of COMPARED_FIELDS) {
    const before = normaliseForCompare(field, existing[field])
    const after = normaliseForCompare(field, incoming[field])
    if (before !== after) {
      changes.push({ field, before: existing[field] ?? null, after: incoming[field] ?? null })
    }
  }
  return changes
}

/**
 * Build the plan.
 *
 * @param {Array<object>} dishes           accepted rows from `importWorkbook`
 * @param {Array<object>} snapshot         dishes currently stored for this kitchen
 * @param {{deactivateMissing?: boolean}} [options]
 *   `deactivateMissing` defaults to **false**. A partial sheet is the ordinary case — a
 *   kitchen sends the ten dishes that changed — and treating absence as "delete the rest"
 *   turns that ordinary case into an emptied menu. Absence is reported either way; acting
 *   on it is opt-in.
 */
export function buildPlan(dishes, snapshot, options = {}) {
  const deactivateMissing = options.deactivateMissing ?? false

  const byKey = new Map()
  for (const row of snapshot) byKey.set(matchKey(row.name), row)

  const create = []
  const update = []
  const unchanged = []
  const reactivate = []
  const seen = new Set()

  for (const incoming of dishes) {
    const key = matchKey(incoming.name)
    seen.add(key)
    const existing = byKey.get(key)

    if (!existing) {
      create.push({ key, name: incoming.name, dish: incoming })
      continue
    }

    const changes = fieldChanges(existing, incoming)

    // A dish that was deactivated and is back in the sheet is being brought back. That is a
    // change even when no field moved, and it must appear in the plan — reactivating a dish
    // silently is how a withdrawn item returns to sale without anybody deciding to.
    if (existing.is_active === false) {
      reactivate.push({ key, id: existing.id, name: incoming.name, changes })
      continue
    }

    if (changes.length === 0) unchanged.push({ key, id: existing.id, name: incoming.name })
    else update.push({ key, id: existing.id, name: incoming.name, changes })
  }

  const missing = snapshot
    .filter((row) => row.is_active !== false && !seen.has(matchKey(row.name)))
    .map((row) => ({ key: matchKey(row.name), id: row.id, name: row.name }))

  const plan = {
    create,
    update,
    reactivate,
    unchanged,
    /** Present in the database, absent from the sheet. */
    missing,
    /** What will actually happen to `missing` — nothing, unless asked. */
    deactivate: deactivateMissing ? missing : [],
    summary: {
      create: create.length,
      update: update.length,
      reactivate: reactivate.length,
      unchanged: unchanged.length,
      missing: missing.length,
      deactivate: deactivateMissing ? missing.length : 0,
      safety_changes: 0,
      money_changes: 0,
    },
  }

  for (const entry of [...update, ...reactivate]) {
    for (const change of entry.changes) {
      if (SAFETY_FIELDS.includes(change.field)) plan.summary.safety_changes++
      if (MONEY_FIELDS.includes(change.field)) plan.summary.money_changes++
    }
  }

  return plan
}

/**
 * Reasons a plan must not be applied without an explicit override.
 *
 * These are not validation errors — the plan is internally fine. They are the shapes that
 * mean *the operator probably imported the wrong file*, and each one is cheap to wave
 * through and expensive to discover afterwards.
 */
export function planBlockers(plan, snapshot, options = {}) {
  const blockers = []
  const activeCount = snapshot.filter((row) => row.is_active !== false).length

  // A sheet that deactivates most of a live menu is a partial export, nine times in ten.
  // The tenth time it is a genuine menu retirement, and typing --force is not a hardship.
  if (plan.deactivate.length > 0 && activeCount > 0) {
    const share = plan.deactivate.length / activeCount
    const limit = options.maxDeactivateShare ?? 0.25
    if (share > limit) {
      blockers.push({
        code: 'mass_deactivation',
        message:
          `This plan deactivates ${plan.deactivate.length} of ${activeCount} active dishes ` +
          `(${Math.round(share * 100)}%). A sheet missing most of the menu is usually a ` +
          `partial export rather than a retirement. Re-run with --force if it is genuinely ` +
          `the whole menu.`,
      })
    }
  }

  // An import that does nothing at all, against a menu that exists, is almost always the
  // wrong sheet name or a missed header row — "no changes" and "I read the wrong tab" look
  // identical from outside, and only one of them is harmless.
  //
  // **Deactivations count as doing something.** Retiring a single dish while every other
  // row matches is a legitimate and completely ordinary import, and an earlier version of
  // this check blocked it — caught by `a proportionate deactivation does not block`.
  const actions =
    plan.create.length + plan.update.length + plan.reactivate.length + plan.deactivate.length
  if (actions === 0 && activeCount > 0) {
    blockers.push({
      code: 'no_changes_but_menu_exists',
      message:
        'The sheet produced no creates, updates or reactivations. Nothing would change. ' +
        'Check the sheet name and the header row before assuming the menu is already current.',
    })
  }

  return blockers
}
