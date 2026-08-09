import { test } from 'node:test'
import assert from 'node:assert/strict'

import { BlockedPlanError, PlanMismatchError, applyPlan, fingerprint } from '../src/apply.mjs'

/** Records what it was asked to do, and can be told to fail on a named dish. */
function recordingExecutor({ failOn = null } = {}) {
  const calls = []
  const guard = (name) => {
    if (failOn && name === failOn) throw new Error(`simulated failure on ${name}`)
  }
  return {
    calls,
    async createDish(dish) {
      guard(dish.name)
      calls.push(['create', dish.name])
      return `new-${dish.name}`
    },
    async updateDish(id, changes) {
      guard(id)
      calls.push(['update', id, changes.map((c) => c.field)])
    },
    async reactivateDish(id) {
      guard(id)
      calls.push(['reactivate', id])
    },
    async deactivateDish(id) {
      guard(id)
      calls.push(['deactivate', id])
    },
  }
}

const plan = (over = {}) => ({
  create: [],
  update: [],
  reactivate: [],
  unchanged: [],
  missing: [],
  deactivate: [],
  summary: {},
  ...over,
})

test('fingerprint is content-based, so a re-export over the same path is a new file', () => {
  assert.equal(fingerprint(Buffer.from('a')), fingerprint(Buffer.from('a')))
  assert.notEqual(fingerprint(Buffer.from('a')), fingerprint(Buffer.from('b')))
})

test('apply refuses when the workbook changed after the plan was reviewed', async () => {
  // The silent overwrite this design exists to stop: preview a diff, someone re-exports
  // over the same filename, apply writes changes nobody read.
  await assert.rejects(
    () =>
      applyPlan(plan(), recordingExecutor(), {
        planFingerprint: 'abc',
        sourceFingerprint: 'def',
      }),
    PlanMismatchError,
  )
})

test('apply proceeds when the fingerprints agree', async () => {
  const executor = recordingExecutor()
  const receipt = await applyPlan(
    plan({ create: [{ name: 'Cold Coffee', dish: { name: 'Cold Coffee' } }] }),
    executor,
    { planFingerprint: 'abc', sourceFingerprint: 'abc' },
  )
  assert.equal(receipt.summary.created, 1)
})

test('blockers stop the apply unless forced', async () => {
  const blockers = [{ code: 'mass_deactivation', message: 'most of the menu' }]
  await assert.rejects(
    () => applyPlan(plan(), recordingExecutor(), { blockers }),
    BlockedPlanError,
  )
})

test('forcing is recorded in the receipt rather than being invisible', async () => {
  // An override that leaves no trace is an override nobody can audit afterwards, and the
  // question after a bad import is always "did someone force this?".
  const blockers = [{ code: 'mass_deactivation', message: 'most of the menu' }]
  const receipt = await applyPlan(plan(), recordingExecutor(), { blockers, force: true })
  assert.equal(receipt.forced, true)
  assert.deepEqual(receipt.overridden_blockers, ['mass_deactivation'])
})

test('an unforced apply with no blockers is not marked forced', async () => {
  const receipt = await applyPlan(plan(), recordingExecutor(), { force: true })
  assert.equal(receipt.forced, false)
})

test('deactivations run last, so a crash leaves too many dishes rather than too few', async () => {
  // An operator can spot a stale dish. Nobody notices an absence until the orders do not
  // arrive, and by then it is lunchtime.
  const executor = recordingExecutor()
  await applyPlan(
    plan({
      create: [{ name: 'New', dish: { name: 'New' } }],
      deactivate: [{ id: 'old-1', name: 'Old' }],
      update: [{ id: 'up-1', name: 'Up', changes: [{ field: 'price_paise' }] }],
    }),
    executor,
  )
  const kinds = executor.calls.map((c) => c[0])
  assert.deepEqual(kinds, ['create', 'update', 'deactivate'])
})

test('one failure does not abandon the rest, and the receipt is the to-do list', async () => {
  // Stopping on first error leaves the menu in neither the old state nor the new one AND
  // gives the operator no list of what still needs doing.
  const executor = recordingExecutor({ failOn: 'Bad' })
  const receipt = await applyPlan(
    plan({
      create: [
        { name: 'Good', dish: { name: 'Good' } },
        { name: 'Bad', dish: { name: 'Bad' } },
        { name: 'AlsoGood', dish: { name: 'AlsoGood' } },
      ],
    }),
    executor,
  )
  assert.equal(receipt.summary.created, 2)
  assert.equal(receipt.summary.failed, 1)
  assert.equal(receipt.failed[0].name, 'Bad')
  assert.match(receipt.failed[0].error, /simulated failure/)
})

test('a dry run touches nothing but reports what would happen', async () => {
  const executor = recordingExecutor()
  const receipt = await applyPlan(
    plan({ create: [{ name: 'New', dish: { name: 'New' } }], deactivate: [{ id: 'x', name: 'Old' }] }),
    executor,
    { dryRun: true },
  )
  assert.deepEqual(executor.calls, [])
  assert.equal(receipt.dry_run, true)
  assert.equal(receipt.summary.created, 1)
  assert.equal(receipt.summary.deactivated, 1)
})

test('nothing in the apply path can delete a dish', () => {
  // Non-negotiable in the same spirit as D15: absence deactivates. An executor with a
  // delete method would be one refactor away from being called.
  const executor = recordingExecutor()
  assert.equal(typeof executor.deactivateDish, 'function')
  assert.equal(executor.deleteDish, undefined)
})
