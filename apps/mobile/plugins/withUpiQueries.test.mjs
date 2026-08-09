/**
 * Tests for the UPI package-visibility config plugin (`E06-29`).
 *
 * Tested through its pure core rather than through Expo's mod pipeline:
 * `withAndroidManifest` only *registers* a callback to be run during prebuild, so calling
 * the plugin and inspecting the returned config asserts nothing about what the callback
 * does — which is the entire behaviour worth testing.
 *
 * Registration is covered separately, by reading `app.json`. Writing a correct plugin and
 * forgetting to list it is a real and silent failure mode: everything typechecks, the suite
 * passes, and the build comes out without it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

const { PSP_PACKAGES, applyUpiQueries } = require('./withUpiQueries.js')

/** The android:scheme values declared across every intent in a manifest object. */
const schemesIn = (manifest) =>
  (manifest.queries?.[0]?.intent ?? []).flatMap((i) =>
    (i.data ?? []).map((d) => d.$['android:scheme']),
  )

const packagesIn = (manifest) =>
  (manifest.queries?.[0]?.package ?? []).map((p) => p.$['android:name'])

test('adds the upi scheme intent and every PSP package to an empty manifest', () => {
  const manifest = applyUpiQueries({})
  assert.ok(schemesIn(manifest).includes('upi'))
  assert.deepEqual(packagesIn(manifest), PSP_PACKAGES)
})

test('declares host=pay alongside the scheme', () => {
  const manifest = applyUpiQueries({})
  const upi = manifest.queries[0].intent.find((i) =>
    i.data?.some((d) => d.$['android:scheme'] === 'upi'),
  )
  assert.equal(upi.data[0].$['android:host'], 'pay')
  assert.equal(upi.action[0].$['android:name'], 'android.intent.action.VIEW')
})

test("merges into Expo's existing queries rather than replacing them", () => {
  // Expo contributes a browser query for expo-linking. Clobbering it would break deep links
  // — a failure with no visible connection to payments, which is how it would stay unfixed.
  const manifest = {
    queries: [
      {
        intent: [
          {
            action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
            data: [{ $: { 'android:scheme': 'https' } }],
          },
        ],
      },
    ],
  }
  applyUpiQueries(manifest)

  assert.deepEqual(schemesIn(manifest), ['https', 'upi'])
  assert.equal(manifest.queries.length, 1, 'must not add a second <queries> element')
})

test('preserves package entries contributed by something else', () => {
  const manifest = { queries: [{ package: [{ $: { 'android:name': 'com.example.other' } }] }] }
  applyUpiQueries(manifest)
  assert.deepEqual(packagesIn(manifest), ['com.example.other', ...PSP_PACKAGES])
})

test('is idempotent — prebuild may run the mod more than once', () => {
  const manifest = applyUpiQueries({})
  applyUpiQueries(manifest)
  applyUpiQueries(manifest)
  assert.deepEqual(packagesIn(manifest), PSP_PACKAGES)
  assert.equal(schemesIn(manifest).filter((s) => s === 'upi').length, 1)
})

test('the plugin covers every package the artefact check requires', async () => {
  // scripts/verify-apk-upi-queries.mjs holds its own copy of this list on purpose, so that
  // deleting an entry here cannot delete the assertion along with it. This is the test that
  // stops the two drifting apart.
  const { REQUIRED_PSP_PACKAGES } = await import('../../../scripts/verify-apk-upi-queries.mjs')
  for (const pkg of REQUIRED_PSP_PACKAGES) {
    assert.ok(
      PSP_PACKAGES.includes(pkg),
      `${pkg} is asserted by scripts/verify-apk-upi-queries.mjs but no longer declared by the plugin`,
    )
  }
})

test('is registered in app.json', () => {
  // A plugin that is written, correct and unlisted produces a green suite and a build with
  // no UPI visibility in it. Nothing else in the repo would notice.
  const appJson = JSON.parse(readFileSync(join(here, '..', 'app.json'), 'utf8'))
  const names = appJson.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p))
  assert.ok(names.includes('./plugins/withUpiQueries'), 'withUpiQueries is not in app.json')
})
