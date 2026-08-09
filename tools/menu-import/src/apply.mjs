// Applying a reviewed plan (E04-04).
//
// The write path is deliberately split in two: this module decides *what* happens and in
// what order, and an `executor` passed in performs it. That is not ceremony — it is what
// lets every rule below be tested without a database, including the ones that only matter
// when something fails halfway. A write path exercised only against a live Postgres is a
// write path whose failure modes are exercised never.
//
// WHAT "NEVER SILENTLY OVERWRITE" MEANS HERE, CONCRETELY:
//
//   1. Applying requires a plan, and the plan carries a fingerprint of the workbook it came
//      from. Apply refuses if the workbook has changed since the plan was reviewed — the
//      operator approved a diff, not a filename.
//   2. Blockers must be explicitly overridden, and the override is recorded in the receipt.
//   3. Nothing is ever deleted. Absence deactivates, and only when asked.
//   4. The receipt lists what actually happened, per dish, including failures. A partial
//      apply is a normal outcome on an unreliable connection and must be legible after the
//      fact, not inferred from the database.

import { createHash } from 'node:crypto'

/**
 * Fingerprint the source workbook.
 *
 * Content, not path or mtime. The failure this prevents: an operator previews a diff,
 * someone re-exports the sheet over the same filename, and apply then writes changes nobody
 * reviewed — which is exactly the silent overwrite the whole design exists to stop.
 */
export function fingerprint(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Step kind -> the receipt list it lands in. Spelled out rather than derived from the
 *  kind, because `${kind}d` is clever, silently returns undefined for a fifth kind, and
 *  would drop that kind from the receipt without failing. */
const RECEIPT_BUCKET = {
  create: 'created',
  update: 'updated',
  reactivate: 'reactivated',
  deactivate: 'deactivated',
}

export class PlanMismatchError extends Error {
  constructor(expected, actual) {
    super(
      `The workbook has changed since this plan was reviewed.\n` +
        `  plan was built from: ${expected}\n` +
        `  file is now:         ${actual}\n` +
        `Re-run the preview and read the diff again. The plan you approved is not the ` +
        `change this file would make.`,
    )
    this.name = 'PlanMismatchError'
  }
}

export class BlockedPlanError extends Error {
  constructor(blockers) {
    super(
      `Refusing to apply:\n` +
        blockers.map((b) => `  [${b.code}] ${b.message}`).join('\n') +
        `\nPass force: true only if each of those is genuinely what you intend.`,
    )
    this.name = 'BlockedPlanError'
    this.blockers = blockers
  }
}

/**
 * Apply a plan.
 *
 * @param {object} plan                  from `buildPlan`
 * @param {object} executor              { createDish, updateDish, deactivateDish, reactivateDish }
 * @param {object} [options]
 * @param {string} [options.sourceFingerprint]  the workbook's hash right now
 * @param {string} [options.planFingerprint]    the hash recorded when the plan was built
 * @param {Array}  [options.blockers]           from `planBlockers`
 * @param {boolean}[options.force]              override blockers, recorded in the receipt
 * @param {boolean}[options.dryRun]             decide everything, execute nothing
 */
export async function applyPlan(plan, executor, options = {}) {
  const { sourceFingerprint, planFingerprint, blockers = [], force = false, dryRun = false } = options

  if (planFingerprint && sourceFingerprint && planFingerprint !== sourceFingerprint) {
    throw new PlanMismatchError(planFingerprint, sourceFingerprint)
  }
  if (blockers.length > 0 && !force) throw new BlockedPlanError(blockers)

  const receipt = {
    dry_run: dryRun,
    forced: force && blockers.length > 0,
    overridden_blockers: force ? blockers.map((b) => b.code) : [],
    created: [],
    updated: [],
    reactivated: [],
    deactivated: [],
    failed: [],
  }

  // Order matters and it is not arbitrary. Creates and updates first, deactivations last:
  // if the run dies partway, the menu has too MANY dishes rather than too few. An operator
  // can spot and remove a stale dish; a child cannot order lunch from an empty menu, and
  // nobody notices an absence until the orders do not arrive.
  const steps = [
    ...plan.create.map((e) => ({ kind: 'create', entry: e })),
    ...plan.update.map((e) => ({ kind: 'update', entry: e })),
    ...plan.reactivate.map((e) => ({ kind: 'reactivate', entry: e })),
    ...plan.deactivate.map((e) => ({ kind: 'deactivate', entry: e })),
  ]

  for (const { kind, entry } of steps) {
    try {
      if (dryRun) {
        receipt[RECEIPT_BUCKET[kind]].push({ name: entry.name, id: entry.id ?? null, simulated: true })
        continue
      }

      if (kind === 'create') {
        const id = await executor.createDish(entry.dish)
        receipt.created.push({ name: entry.name, id })
      } else if (kind === 'update') {
        await executor.updateDish(entry.id, entry.changes)
        receipt.updated.push({ name: entry.name, id: entry.id, fields: entry.changes.map((c) => c.field) })
      } else if (kind === 'reactivate') {
        await executor.reactivateDish(entry.id, entry.changes)
        receipt.reactivated.push({ name: entry.name, id: entry.id })
      } else {
        await executor.deactivateDish(entry.id)
        receipt.deactivated.push({ name: entry.name, id: entry.id })
      }
    } catch (error) {
      // One bad row does not abandon the rest. The alternative — stop on first error —
      // leaves the menu in a state that is neither the old one nor the new one AND gives
      // the operator no list of what still needs doing. Recording and continuing means the
      // receipt is a to-do list.
      receipt.failed.push({
        kind,
        name: entry.name,
        id: entry.id ?? null,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  receipt.summary = {
    created: receipt.created.length,
    updated: receipt.updated.length,
    reactivated: receipt.reactivated.length,
    deactivated: receipt.deactivated.length,
    failed: receipt.failed.length,
  }

  return receipt
}
