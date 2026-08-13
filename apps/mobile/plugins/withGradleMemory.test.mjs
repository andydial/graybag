/**
 * Tests for the Gradle memory config plugin (`E14-36`).
 *
 * Through the pure core, like `withUpiQueries`: `withGradleProperties` only registers a callback
 * for prebuild, so calling the plugin and inspecting the returned config asserts nothing about
 * the behaviour worth testing.
 *
 * Registration in `app.json` is asserted separately and matters more here than usual — a plugin
 * that is written, correct and unlisted leaves the build with the default metaspace, and the
 * symptom is a 45-minute timeout rather than an error.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

const { JVM_ARGS, applyGradleMemory } = require('./withGradleMemory.js')

const valueOf = (properties, key) =>
  properties.find((item) => item.type === 'property' && item.key === key)?.value

test('raises MaxMetaspaceSize, which is the thing that was exhausted', () => {
  // The failure was `OutOfMemoryError: Metaspace`, not a heap OOM. Metaspace holds class
  // metadata and is a separate region — raising `-Xmx` alone would have changed nothing, which
  // is the trap in the usual "give Gradle more memory" advice.
  const args = valueOf(applyGradleMemory([]), 'org.gradle.jvmargs')
  const metaspace = /-XX:MaxMetaspaceSize=(\d+)m/.exec(args)
  assert.ok(metaspace, 'MaxMetaspaceSize is not set at all')
  assert.ok(Number(metaspace[1]) >= 1024, `MaxMetaspaceSize is ${metaspace[1]}m, too low to help`)
})

test('sets a heap as well, and keeps both inside the runner’s memory', () => {
  // Overshooting invites the runner's OOM killer, which takes the whole job and fails in a way
  // that looks nothing like this — sending the next person to entirely the wrong place.
  const args = valueOf(applyGradleMemory([]), 'org.gradle.jvmargs')
  const heap = Number(/-Xmx(\d+)m/.exec(args)?.[1])
  const metaspace = Number(/-XX:MaxMetaspaceSize=(\d+)m/.exec(args)?.[1])
  assert.ok(heap >= 2048, 'heap too small for a React Native release build')
  // 16 GB runner, and the Kotlin compile daemon is a SEPARATE JVM not counted here.
  assert.ok(heap + metaspace <= 8192, `${heap + metaspace}m leaves too little for everything else`)
})

test('replaces an existing value in place rather than appending a duplicate', () => {
  // Gradle takes the last occurrence of a duplicated key, so appending would work by accident
  // and read as though it did not — the next person deletes the "redundant" first line and
  // nothing changes, or deletes the second and the timeout returns.
  const before = [{ type: 'property', key: 'org.gradle.jvmargs', value: '-Xmx512m' }]
  const after = applyGradleMemory(before)
  const occurrences = after.filter((i) => i.type === 'property' && i.key === 'org.gradle.jvmargs')
  assert.equal(occurrences.length, 1)
  assert.equal(occurrences[0].value, JVM_ARGS)
})

test('leaves every other property and comment untouched', () => {
  // Expo's template sets a dozen properties here — new architecture, Hermes, AndroidX. Dropping
  // one would change the build in a way that has nothing to do with memory.
  const before = [
    { type: 'comment', value: 'Project-wide Gradle settings' },
    { type: 'property', key: 'android.useAndroidX', value: 'true' },
    { type: 'property', key: 'hermesEnabled', value: 'true' },
  ]
  const after = applyGradleMemory(before)
  assert.equal(valueOf(after, 'android.useAndroidX'), 'true')
  assert.equal(valueOf(after, 'hermesEnabled'), 'true')
  assert.ok(after.some((i) => i.type === 'comment'))
})

test('exits the JVM on OOM rather than thrashing to the job timeout', () => {
  // The half that bounds the damage, and the reason a failure took 45 minutes instead of four.
  // Without this the daemon catches OutOfMemoryError and carries on, so the build neither
  // finishes nor fails. More memory is a guess about how much is enough; this is a guarantee
  // about what happens when the guess is wrong.
  const args = valueOf(applyGradleMemory([]), 'org.gradle.jvmargs')
  assert.match(args, /-XX:\+ExitOnOutOfMemoryError/)
})

test('is idempotent — prebuild may run the mod more than once', () => {
  const once = applyGradleMemory([])
  const thrice = applyGradleMemory(applyGradleMemory(once))
  assert.deepEqual(thrice, once)
})

test('is registered in app.json', () => {
  // A correct, unlisted plugin produces a green suite and a build with the default metaspace —
  // whose symptom is a 45-minute timeout, not an error message.
  const appJson = JSON.parse(readFileSync(join(here, '..', 'app.json'), 'utf8'))
  const names = appJson.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p))
  assert.ok(names.includes('./plugins/withGradleMemory'), 'withGradleMemory is not in app.json')
})
