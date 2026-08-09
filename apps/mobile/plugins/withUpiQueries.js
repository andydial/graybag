/**
 * Expo config plugin adding the Android 11+ `<queries>` block for UPI intent.
 *
 * Part of `E06-29`. Android 11 (API 30) made the package list opaque by default: an app can
 * only see other apps it declares an interest in. Razorpay's checkout resolves `upi://pay`
 * to decide which PSP apps to offer, so without a `<queries>` block that resolution comes
 * back empty and the sheet silently degrades to UPI collect / QR — the flow `E06-02` exists
 * to replace. It does not error. It just gets worse.
 *
 * ## Why this is on permanently, rather than conditionally
 *
 * It began as an experiment. Static analysis on 2026-08-08 found that the block is probably
 * already supplied for us: `react-native-razorpay@3.0.0`'s own manifest declares only
 * `CheckoutActivity`, but its transitive `com.razorpay:standard-core` AAR declares a
 * `<queries>` block including `scheme="upi" host="pay"`. Android's manifest merger pulls
 * library `<queries>` into the app manifest, so the chooser may work with nothing added.
 * The spike therefore shipped with this plugin OFF, so that a working chooser would tell us
 * who was responsible for it.
 *
 * **The handset session could not answer that question and never will.** The test device had
 * a single UPI app installed, so Android launched straight into it instead of showing a
 * list — the observation is consistent with both a working chooser and a broken one. Rather
 * than chase a second handset, `[PAY-01]` was resolved by construction (Andy's ruling,
 * 2026-08-09): turn the plugin on permanently and the ambiguity stops mattering. It is
 * already written, already verified against a local prebuild, and it costs nothing —
 * `<queries>` entries are declarations, not permissions. There is no runtime cost, no
 * user-visible prompt, and nothing to review in the store listing.
 *
 * Note what this does and does not buy: it guarantees *we* declare the visibility. It does
 * not guarantee the merged manifest that reaches a device contains it, because a config
 * plugin can silently stop applying across an Expo upgrade. That is what
 * `scripts/verify-apk-upi-queries.mjs` asserts, against the built artefact rather than
 * against this file (`E06-32`).
 *
 * ## Belt and braces, on purpose
 *
 * Two mechanisms, because they fail differently:
 *
 *   - the **scheme query** ("any activity that can VIEW a `upi://` URI") covers every PSP,
 *     including ones that did not exist when this was written;
 *   - the **explicit package list** covers the case where an OEM build or a future Android
 *     release narrows what a scheme query returns. It is what Razorpay's own documentation
 *     shows, and a stale entry here is inert rather than harmful.
 *
 * iOS's `LSApplicationQueriesSchemes` is the other half of `E06-29` and is not done here —
 * it lands with `E06-02`, when the SDK is actually added to this app.
 */
const { withAndroidManifest } = require('expo/config-plugins')

/** The explicit PSP packages, for the case where the scheme-based query is not enough. */
const PSP_PACKAGES = [
  'com.google.android.apps.nbu.paisa.user', // Google Pay (India)
  'com.phonepe.app',
  'net.one97.paytm',
  'in.org.npci.upiapp', // BHIM
  'com.amazon.mShop.android.shopping', // Amazon Pay
  'com.dreamplug.androidapp', // CRED
]

/**
 * The whole transform, as a pure function over Expo's parsed manifest object.
 *
 * Split out from the plugin so it can be unit-tested without standing up Expo's mod
 * pipeline: `withAndroidManifest` only *registers* a callback, so a test that calls the
 * plugin and inspects what comes back tests nothing at all.
 */
function applyUpiQueries(manifest) {
  // Merge into whatever is already there. Expo itself contributes a `<queries>` block for
  // the browser and for `expo-linking`; replacing it would break deep links in a way that
  // has nothing to do with payments and would be attributed to something else entirely.
  manifest.queries = manifest.queries ?? [{}]
  const q = manifest.queries[0]

  // Scheme-based: "any activity that can VIEW a upi:// URI".
  q.intent = q.intent ?? []
  const hasUpiIntent = q.intent.some((i) =>
    i?.data?.some((d) => d?.$?.['android:scheme'] === 'upi'),
  )
  if (!hasUpiIntent) {
    q.intent.push({
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      data: [{ $: { 'android:scheme': 'upi', 'android:host': 'pay' } }],
    })
  }

  // Package-based: belt and braces, and what the Razorpay docs show.
  q.package = q.package ?? []
  for (const name of PSP_PACKAGES) {
    if (!q.package.some((p) => p?.$?.['android:name'] === name)) {
      q.package.push({ $: { 'android:name': name } })
    }
  }

  return manifest
}

module.exports = function withUpiQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    applyUpiQueries(cfg.modResults.manifest)
    return cfg
  })
}

module.exports.PSP_PACKAGES = PSP_PACKAGES
module.exports.applyUpiQueries = applyUpiQueries
