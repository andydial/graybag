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
 * ## The iOS half — `LSApplicationQueriesSchemes`
 *
 * Landed with `E06-02`, when the SDK was actually added.
 *
 * iOS is the same problem with different mechanics and a harsher failure. `canOpenURL:` returns
 * **false** for any scheme not declared in `LSApplicationQueriesSchemes`, and it does so
 * silently — no exception, no console warning, just a payment app that "isn't installed". The
 * Razorpay SDK uses exactly that call to decide which UPI apps to show, so an undeclared scheme
 * means a shorter list rather than an error, which is the kind of defect that gets reported as
 * "GPay is missing on iPhone" and chased in the wrong place entirely.
 *
 * Apple caps the array at **50 entries** and silently ignores everything past it — another
 * failure with no error attached — so the list stays deliberately short.
 *
 * A note on what iOS UPI actually is: UPI intent on iOS is far less used than on Android, and
 * `E19-01` confirmed the real payment came back `captured` from a UPI intent on Android. The
 * schemes are declared anyway because the cost is a plist array and the alternative is
 * discovering it from an iPhone user who cannot pay.
 */
const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins')

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

/**
 * The URL schemes `canOpenURL:` must be allowed to ask about.
 *
 * `upi` is the one that matters — it is the generic intent every PSP registers, and the one the
 * Razorpay SDK probes first. The rest are the app-specific schemes for the same six PSPs named
 * in `PSP_PACKAGES`, so the two platforms cover the same wallets and neither can quietly drift
 * into supporting a different set.
 */
const PSP_URL_SCHEMES = [
  'upi',
  'tez', // Google Pay's own scheme, and still `tez` — the app was renamed, the scheme was not
  'phonepe',
  'paytmmp',
  'bhim',
  'amazonpay',
  'credpay',
]

/** Apple ignores everything past the 50th entry, without an error. */
const LSAPPLICATIONQUERIESSCHEMES_LIMIT = 50

/**
 * Pure, for the same reason `applyUpiQueries` is: `withInfoPlist` only registers a callback, so
 * a test that calls the plugin and inspects the result asserts nothing.
 */
function applyUpiSchemes(infoPlist) {
  // Merged, never replaced. `expo-linking` and any other plugin contribute here too, and
  // clobbering the array would break deep links in a way nobody would connect to payments.
  const existing = Array.isArray(infoPlist.LSApplicationQueriesSchemes)
    ? infoPlist.LSApplicationQueriesSchemes
    : []

  const merged = [...existing]
  for (const scheme of PSP_URL_SCHEMES) {
    if (!merged.includes(scheme)) merged.push(scheme)
  }

  if (merged.length > LSAPPLICATIONQUERIESSCHEMES_LIMIT) {
    // Loud, because the alternative is Apple silently truncating and a wallet vanishing from the
    // sheet for reasons no log will ever mention.
    throw new Error(
      `LSApplicationQueriesSchemes has ${merged.length} entries; iOS ignores everything past ` +
        `${LSAPPLICATIONQUERIESSCHEMES_LIMIT} without an error. Remove some before adding more.`,
    )
  }

  infoPlist.LSApplicationQueriesSchemes = merged
  return infoPlist
}

module.exports = function withUpiQueries(config) {
  const withAndroid = withAndroidManifest(config, (cfg) => {
    applyUpiQueries(cfg.modResults.manifest)
    return cfg
  })
  return withInfoPlist(withAndroid, (cfg) => {
    applyUpiSchemes(cfg.modResults)
    return cfg
  })
}

module.exports.PSP_PACKAGES = PSP_PACKAGES
module.exports.PSP_URL_SCHEMES = PSP_URL_SCHEMES
module.exports.applyUpiQueries = applyUpiQueries
module.exports.applyUpiSchemes = applyUpiSchemes
