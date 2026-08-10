/**
 * Dynamic app config — the **non-production identity split** (`E17-28`).
 *
 * ## The problem it fixes
 *
 * Every build so far carried `com.gracord.graybag`, which is the identifier the **live App
 * Store listing** is attached to. Installing an internal build therefore replaces the live
 * app on the device, and getting the live app back means deleting the test build. Andy has
 * had to do that twice.
 *
 * A staging build now installs **beside** the live app instead of on top of it:
 *
 * | | production | everything else |
 * |---|---|---|
 * | iOS bundle id | `com.gracord.graybag` | `com.gracord.graybag.staging` |
 * | Android package | `com.Gracord.Graybag` | `com.Gracord.Graybag.staging` |
 * | Display name | GrayBag | GrayBag Staging |
 * | URL scheme | `graybag` | `graybag-staging` |
 *
 * **Android is split too**, though only iOS was asked for. The hazard is identical — the live
 * Play listing is attached to `com.Gracord.Graybag`, so a preview APK overwrites the live app
 * on any device that has it. Splitting one platform and not the other would leave the same
 * trap on the platform that gets the most internal builds.
 *
 * **The scheme has to move with them.** Two installed apps registering `graybag://` is a coin
 * flip as to which one iOS hands a link to. Nothing consumes the scheme yet — sign-in is email
 * OTP and no deep link is wired — so this is the free moment to do it. Whatever `E03-12`
 * (Google) and `E03-13` (Apple) register later must register both.
 *
 * ## Why the default is staging, not production
 *
 * `APP_ENV` unset means staging. The dangerous identity is the one that can replace a real
 * customer's app, so it requires saying so explicitly; a forgotten environment variable
 * produces a harmless build rather than one that overwrites the live listing. This is the same
 * reasoning `packages/shared/src/env.ts` uses for `EN2`.
 *
 * ## Why `app.json` stays
 *
 * It is still the base config and still the single description of the **production** identity —
 * `app-config.test.ts` reads it directly to assert the typo in "gracord" and the capitals in
 * the Android package, neither of which is ours to change (`R4`). This file is an overlay on
 * top of it, not a replacement, so there is one description of the app and one rule for how
 * non-production differs from it.
 */

/** The suffix both platforms take. One constant, because they must never drift apart. */
const STAGING_SUFFIX = '.staging';
const STAGING_NAME = 'GrayBag Staging';
const STAGING_SCHEME = 'graybag-staging';

/**
 * Apply the non-production identity.
 *
 * Pure and exported so `app-config.test.ts` can assert both branches without running Expo —
 * the failure this guards against is silent (a build that installs over the live app looks
 * exactly like one that does not until it is on the phone).
 */
function applyIdentity(config, appEnv) {
  if (appEnv === 'production') return config;

  return {
    ...config,
    name: STAGING_NAME,
    scheme: STAGING_SCHEME,
    ios: {
      ...config.ios,
      bundleIdentifier: `${config.ios.bundleIdentifier}${STAGING_SUFFIX}`,
    },
    android: {
      ...config.android,
      package: `${config.android.package}${STAGING_SUFFIX}`,
    },
  };
}

module.exports = ({ config }) => applyIdentity(config, process.env.APP_ENV);

module.exports.applyIdentity = applyIdentity;
module.exports.STAGING_SUFFIX = STAGING_SUFFIX;
module.exports.STAGING_NAME = STAGING_NAME;
module.exports.STAGING_SCHEME = STAGING_SCHEME;
