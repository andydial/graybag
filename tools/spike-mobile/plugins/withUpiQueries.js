/**
 * Expo config plugin adding the Android 11+ `<queries>` block for UPI intent — the fix
 * `E06-29` describes, and the thing `docs/payments-design.md` §3.3 says must not be
 * discovered missing in production.
 *
 * ============================================================================
 * IT IS NOT ENABLED BY DEFAULT, AND THAT IS THE EXPERIMENT.
 * ============================================================================
 *
 * Static analysis of the SDK (2026-08-08) found:
 *
 *   - `react-native-razorpay@3.0.0`'s own AndroidManifest declares ONLY CheckoutActivity.
 *     No <queries>. So the design's assumption is right about the RN wrapper.
 *   - But it depends on `com.razorpay:checkout:1.6.41`, which depends transitively on
 *     `com.razorpay:standard-core`, and THAT AAR's manifest DOES declare a <queries>
 *     block containing `scheme="upi" host="pay"` plus a broad VIEW intent.
 *
 * Android's manifest merger pulls library <queries> into the app manifest, so the chooser
 * may already work with nothing added. Building WITHOUT this plugin first is therefore the
 * only way to learn whether `E06-29` is real work or already solved upstream.
 *
 * Turn it on only if the device shows no UPI app chooser. If enabling it fixes that, the
 * answer to checklist item 2 is "required"; if the chooser worked already, the answer is
 * "supplied by standard-core" — and then `E06-29` becomes a *regression test* asserting the
 * merged manifest still contains it, because that dependency is unpinned (see the runbook).
 *
 * Enable by adding "./plugins/withUpiQueries" to app.json's "plugins" array.
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

module.exports = function withUpiQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest

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

    return cfg
  })
}
