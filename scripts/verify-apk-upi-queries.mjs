#!/usr/bin/env node
/**
 * `E06-32` — assert that a **built APK** declares the UPI package visibility checkout needs.
 *
 *     node scripts/verify-apk-upi-queries.mjs path/to/app.apk
 *
 * ## Why against the artefact
 *
 * Android 11 made the installed-package list opaque. Razorpay's checkout resolves `upi://pay`
 * to decide which PSP apps to offer; with no `<queries>` declaration that resolution returns
 * nothing and the sheet quietly degrades to UPI collect / QR. **It does not error.** Nobody
 * gets a crash report. The first signal is a conversion rate that is worse than it should be,
 * months later — which is exactly the failure `E06-02` exists to remove.
 *
 * Two independent things can cause it, and neither shows up in source:
 *
 *   1. **Our config plugin stops applying.** `withUpiQueries` runs during prebuild on EAS. An
 *      Expo upgrade that changes plugin ordering or the shape of `modResults` can make it a
 *      no-op, and a no-op plugin is indistinguishable from a working one in `app.json`.
 *   2. **The upstream AAR changes.** `com.razorpay:checkout` pulls `standard-core` at version
 *      `LATEST` (`E19-08`), and that AAR contributes its own `<queries>` block to the merge.
 *      `E19-08` pins it, but a pin is a line in a Gradle file — this is the check that the
 *      pin had the effect it claims.
 *
 * Reading `app.json`, or the plugin source, or the dependency version, catches none of that.
 * The merged manifest inside the APK is the only artefact that reflects all of it at once,
 * which is why `docs/spike-runbook.md` §1.3 insisted the assertion be made here.
 *
 * ## What it asserts
 *
 * Two things, separately, because they fail for different reasons and the distinction is the
 * diagnosis:
 *
 *   - **the `upi` scheme query** — the functional requirement. Contributed by our plugin
 *     *and* by `standard-core`, so it survives either one going missing;
 *   - **the explicit PSP package list** — contributed by our plugin alone. It is therefore
 *     the canary for cause (1): if the scheme query is present but the packages are gone,
 *     the plugin stopped applying and only upstream is carrying us.
 *
 * Exits 0 with a summary, or 1 with what is missing and which cause it points at.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

import { readEntry } from './lib/zip.mjs'
import { parseAxml, findElements, androidAttr, ANDROID_NS } from './lib/axml.mjs'

/**
 * The packages the built artefact must declare.
 *
 * This list is the **contract**, held here rather than imported from the plugin on purpose:
 * if the verifier read its expectations out of the thing it is verifying, deleting an entry
 * from the plugin would delete the assertion along with it and the suite would stay green.
 * `apps/mobile/plugins/withUpiQueries.test.mjs` asserts the plugin covers every entry below,
 * so the two cannot drift apart silently in either direction.
 */
const REQUIRED_PSP_PACKAGES = [
  'com.google.android.apps.nbu.paisa.user', // Google Pay (India)
  'com.phonepe.app',
  'net.one97.paytm',
  'in.org.npci.upiapp', // BHIM
  'com.amazon.mShop.android.shopping', // Amazon Pay
  'com.dreamplug.androidapp', // CRED
]

/**
 * Inspect a parsed manifest. Pure, so the tests can drive it with synthetic manifests and
 * never need a checked-in APK.
 */
export function inspectManifest(manifest) {
  const queries = findElements(manifest, 'queries')

  const schemes = new Set()
  for (const q of queries) {
    for (const data of findElements(q, 'data')) {
      const scheme = androidAttr(data, 'scheme')
      if (scheme) schemes.add(scheme)
    }
  }

  const declaredPackages = new Set()
  for (const q of queries) {
    for (const pkg of findElements(q, 'package')) {
      const name = androidAttr(pkg, 'name')
      if (name) declaredPackages.add(name)
    }
  }

  return {
    hasQueriesElement: queries.length > 0,
    hasUpiScheme: schemes.has('upi'),
    declaredPackages: [...declaredPackages],
    missingPackages: REQUIRED_PSP_PACKAGES.filter((p) => !declaredPackages.has(p)),
  }
}

/** Read and parse `AndroidManifest.xml` out of an APK on disk. */
export function readApkManifest(apkPath) {
  const apk = readFileSync(apkPath)
  const entry = readEntry(apk, 'AndroidManifest.xml')
  if (!entry) throw new Error(`${basename(apkPath)} contains no AndroidManifest.xml`)
  return parseAxml(entry)
}

function main(argv) {
  const apkPath = argv[2]
  if (!apkPath) {
    console.error('usage: node scripts/verify-apk-upi-queries.mjs <path-to.apk>')
    return 2
  }

  const result = inspectManifest(readApkManifest(apkPath))
  const name = basename(apkPath)

  // Two severities, because they mean different things and the headline has to be true.
  // A missing `upi` scheme is a broken checkout. Missing PSP packages with the scheme still
  // present is a regression in our plugin that upstream is currently masking — serious,
  // because the masking is a floating dependency, but not a degraded build today.
  const failures = []

  if (!result.hasQueriesElement) {
    failures.push({
      severity: 'BROKEN',
      text:
        'No <queries> element at all. Neither our config plugin nor com.razorpay:standard-core\n' +
        '  contributed one. On Android 11+ the UPI app list will be empty and checkout will\n' +
        '  silently degrade to UPI collect / QR.',
    })
  } else if (!result.hasUpiScheme) {
    failures.push({
      severity: 'BROKEN',
      text:
        'A <queries> element exists but declares no android:scheme="upi" data element.\n' +
        '  Checkout cannot resolve upi://pay and will offer no PSP apps.',
    })
  }

  if (result.missingPackages.length > 0) {
    failures.push({
      severity: 'REGRESSED',
      text:
        `${result.missingPackages.length} of ${REQUIRED_PSP_PACKAGES.length} required PSP packages are not declared:\n` +
        result.missingPackages.map((p) => `    - ${p}`).join('\n') +
        '\n  These come from apps/mobile/plugins/withUpiQueries.js and nowhere else, so their\n' +
        '  absence means that plugin did not apply to this build. If the upi scheme above is\n' +
        '  still present, com.razorpay:standard-core is the only thing carrying UPI visibility\n' +
        '  — and E19-08 exists because that is a dependency we do not control.',
    })
  }

  console.log(`UPI package visibility — ${name}`)
  console.log(`  <queries> element        ${result.hasQueriesElement ? 'present' : 'MISSING'}`)
  console.log(`  android:scheme="upi"     ${result.hasUpiScheme ? 'present' : 'MISSING'}`)
  console.log(
    `  PSP packages declared    ${REQUIRED_PSP_PACKAGES.length - result.missingPackages.length}/${REQUIRED_PSP_PACKAGES.length}`,
  )
  if (result.declaredPackages.length > 0) {
    for (const p of result.declaredPackages.sort()) console.log(`    - ${p}`)
  }

  if (failures.length === 0) {
    console.log('\nOK — this artefact declares everything a UPI app chooser needs.')
    return 0
  }

  const broken = failures.some((f) => f.severity === 'BROKEN')
  console.error(
    broken
      ? '\nFAILED — this build degrades to UPI collect / QR:\n'
      : '\nFAILED — UPI visibility is not being declared by us:\n',
  )
  for (const f of failures) console.error(`  ${f.text}\n`)
  console.error(
    'Do not ship it. See docs/payments-design.md §3.3 and docs/spike-runbook.md §1.3.',
  )
  return 1
}

export { REQUIRED_PSP_PACKAGES, ANDROID_NS }

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv))
}
