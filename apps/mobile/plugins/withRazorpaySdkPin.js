/**
 * Expo config plugin pinning Razorpay's Android payment SDK to an exact version — `E19-08`.
 *
 * ## The problem
 *
 * `com.razorpay:checkout:1.6.41`'s POM declares its dependency on the SDK that actually
 * implements payment as:
 *
 *     <dependency>
 *       <groupId>com.razorpay</groupId>
 *       <artifactId>standard-core</artifactId>
 *       <version>LATEST</version>
 *     </dependency>
 *
 * `LATEST`, not a version. So two builds a week apart can embed different payment SDK code
 * with no change on our side and **nothing in `package-lock.json` to show it**. The npm
 * lockfile pins `react-native-razorpay`, which pins `com.razorpay:checkout` — and the chain
 * of determinism ends exactly one link before the code that touches money.
 *
 * Three things follow from that, in ascending order of seriousness:
 *
 *   1. a build cannot be reproduced, so "it worked last Tuesday" is not a statement about
 *      any artefact we can rebuild;
 *   2. the `<queries>` block this SDK contributes (see `withUpiQueries`) can change under
 *      us, silently degrading checkout to UPI collect / QR;
 *   3. a compromised or simply broken Razorpay publish reaches our users on the next build,
 *      with no review and no diff.
 *
 * ## The pin
 *
 * `1.7.18`, published 2026-08-04, and the version `LATEST` resolved to for the `E19-01`
 * spike build on 2026-08-08 — nothing newer had been published, so the APK on which a real
 * ₹1 UPI payment captured cleanly and whose signature verified is running exactly this code.
 * That is the reason for choosing it over "whatever is newest today": it is the only version
 * of this SDK we have evidence about.
 *
 * `com.razorpay:checkout` itself needs no pin — `react-native-razorpay` declares it at an
 * exact version and npm pins the wrapper.
 *
 * ## Upgrading
 *
 * Deliberately. Bump `STANDARD_CORE_VERSION`, rebuild, re-run
 * `scripts/verify-apk-upi-queries.mjs` against the new artefact, and put a real test-mode
 * payment through the handset harness before it reaches production. The whole point of the
 * pin is that this becomes a decision with a date on it rather than a side effect of
 * building on a Thursday.
 */
const { withAppBuildGradle } = require('expo/config-plugins')

/**
 * The pinned payment SDK version. Single source of truth — the tests assert the emitted
 * Gradle matches it, so this cannot drift from what is actually forced.
 */
const STANDARD_CORE_VERSION = '1.7.18'

const BEGIN = '// >>> GrayBag E19-08: pin the Razorpay payment SDK >>>'
const END = '// <<< GrayBag E19-08 <<<'

/** The Gradle appended to `android/app/build.gradle`. Exported so the tests can read it. */
function pinSnippet(version = STANDARD_CORE_VERSION) {
  return [
    '',
    BEGIN,
    '// com.razorpay:checkout declares standard-core at version LATEST. Without this force,',
    '// the code that handles payment is whatever Razorpay published most recently.',
    'configurations.all {',
    '    resolutionStrategy {',
    `        force 'com.razorpay:standard-core:${version}'`,
    '    }',
    '}',
    END,
    '',
  ].join('\n')
}

/**
 * Append the pin to a `build.gradle`'s contents, once. Pure, so the idempotency and the
 * emitted Gradle can be asserted without Expo's mod pipeline.
 */
function applyPin(contents) {
  // Prebuild is not guaranteed to start from a clean template, so appending blindly would
  // stack duplicate blocks across runs.
  if (contents.includes(BEGIN)) return contents
  return contents + pinSnippet()
}

module.exports = function withRazorpaySdkPin(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      // Expo has only ever generated Groovy here. If that changes, fail loudly rather than
      // return a config whose pin silently did not apply — an unpinned payment SDK that
      // nobody notices is the exact failure this plugin exists to prevent.
      throw new Error(
        `withRazorpaySdkPin: expected a Groovy build.gradle, got "${cfg.modResults.language}". ` +
          'The pin was NOT applied. Port the snippet before shipping a payment build.',
      )
    }

    cfg.modResults.contents = applyPin(cfg.modResults.contents)
    return cfg
  })
}

module.exports.STANDARD_CORE_VERSION = STANDARD_CORE_VERSION
module.exports.pinSnippet = pinSnippet
module.exports.applyPin = applyPin
module.exports.BEGIN = BEGIN
