/**
 * Tests for the Razorpay payment-SDK version pin (`E19-08`).
 *
 * Tested through its pure core rather than through Expo's mod pipeline, for the same reason
 * as `withUpiQueries.test.mjs`: `withAppBuildGradle` registers a callback, it does not run
 * one, so asserting on the returned config would assert nothing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

const { STANDARD_CORE_VERSION, pinSnippet, applyPin, BEGIN } = require('./withRazorpaySdkPin.js')

test('forces an exact standard-core version', () => {
  const gradle = applyPin('apply plugin: "com.android.application"\n')
  assert.match(gradle, /force 'com\.razorpay:standard-core:\d+\.\d+\.\d+'/)
  assert.ok(gradle.includes(`force 'com.razorpay:standard-core:${STANDARD_CORE_VERSION}'`))
})

test('the pinned version is a concrete version, never a Gradle placeholder', () => {
  // The whole point of E19-08 is that `LATEST` is not a version. A dynamic selector here
  // would reintroduce exactly what the pin exists to remove, while looking pinned.
  assert.match(STANDARD_CORE_VERSION, /^\d+\.\d+\.\d+$/)
  assert.ok(!/[+]|LATEST|RELEASE/.test(STANDARD_CORE_VERSION))
})

test('keeps the existing build.gradle and appends', () => {
  const original = 'apply plugin: "com.android.application"\ndependencies {}\n'
  const gradle = applyPin(original)
  assert.ok(gradle.startsWith(original))
})

test('is idempotent — a second prebuild must not stack a duplicate block', () => {
  const once = applyPin('dependencies {}\n')
  const twice = applyPin(once)
  assert.equal(once, twice)
  assert.equal(twice.split(BEGIN).length - 1, 1)
})

test('emits a resolutionStrategy inside configurations.all', () => {
  const gradle = pinSnippet('9.9.9')
  assert.match(gradle, /configurations\.all\s*\{[\s\S]*resolutionStrategy\s*\{/)
  assert.ok(gradle.includes("force 'com.razorpay:standard-core:9.9.9'"))
})

test('is registered in app.json', () => {
  const appJson = JSON.parse(readFileSync(join(here, '..', 'app.json'), 'utf8'))
  const names = appJson.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p))
  assert.ok(
    names.includes('./plugins/withRazorpaySdkPin'),
    'withRazorpaySdkPin is not in app.json — the payment SDK is unpinned in every build',
  )
})
