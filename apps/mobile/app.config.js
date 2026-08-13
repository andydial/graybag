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

/**
 * One row per environment, because two of them being ambiguous cost Andy a day.
 *
 * Three builds install side by side and are **distinguishable on the home screen without
 * opening them**. The previous split had only two identities — production and
 * everything-else — so a development build and a staging build both installed as "GrayBag
 * Staging" with the same bundle id: the second overwrote the first, and a bug reported from
 * one was reproduced against the other. Twice.
 *
 * | `APP_ENV` | EAS profile | Home screen | Bundle id suffix | Scheme |
 * |---|---|---|---|---|
 * | `production` | `production` | GrayBag | *(none)* | `graybag` |
 * | `staging` | `staging`, `preview` | GrayBag Staging | `.staging` | `graybag-staging` |
 * | `local` | `development` | GrayBag Dev | `.dev` | `graybag-dev` |
 *
 * The schemes differ for the same reason the ids do: three apps registering `graybag://` is a
 * coin flip as to which one the OS hands a link to.
 */
const IDENTITIES = {
  production: { suffix: '', name: 'GrayBag', scheme: 'graybag' },
  staging: { suffix: '.staging', name: 'GrayBag Staging', scheme: 'graybag-staging' },
  local: { suffix: '.dev', name: 'GrayBag Dev', scheme: 'graybag-dev' },
};

/** Retained: `app-config.test.ts` and `.maestro/*.yaml` both name the staging identity. */
const STAGING_SUFFIX = IDENTITIES.staging.suffix;
const STAGING_NAME = IDENTITIES.staging.name;
const STAGING_SCHEME = IDENTITIES.staging.scheme;

/**
 * The commit this build came from, stamped into the binary.
 *
 * Andy has twice reported a bug from a stale binary that neither of us could identify. A
 * screenshot of the Account screen now says which environment and which commit, so "which
 * build were you on" has an answer that does not depend on anyone remembering.
 *
 * EAS sets `EAS_BUILD_GIT_COMMIT_HASH`. Locally there is no such variable, so it falls back to
 * asking git — and to `unknown` if that fails, because a config that throws produces no build
 * at all, which is a far worse outcome than an unlabelled one.
 */
function gitSha() {
  if (process.env.EAS_BUILD_GIT_COMMIT_HASH) {
    return process.env.EAS_BUILD_GIT_COMMIT_HASH.slice(0, 7);
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require('node:child_process');
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Apply the non-production identity.
 *
 * Pure and exported so `app-config.test.ts` can assert both branches without running Expo —
 * the failure this guards against is silent (a build that installs over the live app looks
 * exactly like one that does not until it is on the phone).
 */
function applyIdentity(config, appEnv, sha = 'unknown') {
  // An unset or unrecognised APP_ENV lands on `local`, not on production. The dangerous
  // identity is the one that can replace a real customer's app, so it has to be asked for.
  const identity = IDENTITIES[appEnv] ?? IDENTITIES.local;
  const resolvedEnv = IDENTITIES[appEnv] ? appEnv : 'local';

  return {
    ...config,
    name: identity.name,
    scheme: identity.scheme,
    ios: {
      ...config.ios,
      bundleIdentifier: `${config.ios.bundleIdentifier}${identity.suffix}`,
    },
    android: {
      ...config.android,
      package: `${config.android.package}${identity.suffix}`,
    },
    extra: {
      ...config.extra,
      // Read by the Account screen's footer. Not secret, and deliberately not behind a
      // `__DEV__` check: the whole point is that a production screenshot identifies itself.
      appEnv: resolvedEnv,
      gitSha: sha,
    },
  };
}

module.exports = ({ config }) => applyIdentity(config, process.env.APP_ENV, gitSha());

module.exports.applyIdentity = applyIdentity;
module.exports.STAGING_SUFFIX = STAGING_SUFFIX;
module.exports.STAGING_NAME = STAGING_NAME;
module.exports.STAGING_SCHEME = STAGING_SCHEME;
module.exports.IDENTITIES = IDENTITIES;
