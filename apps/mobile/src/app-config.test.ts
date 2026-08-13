import appJson from '../app.json';

/**
 * `R4`: GrayBag ships as an **update to the existing store listings**, not as new ones, so
 * the bundle identifiers are not ours to choose — they are already owned by the live apps.
 *
 * **The typo in "gracord" is permanent and must not be corrected**, and the Android package
 * carries capitals the iOS one does not. Both facts look like mistakes to anyone reading
 * them cold, which is exactly why they need a test rather than a comment: a well-meaning
 * tidy-up here does not fail the build, it fails at store submission, after a release is
 * cut, and the recovery is a new listing with zero installs.
 */
describe('app.json identity', () => {
  const { expo } = appJson;

  it('uses the existing iOS bundle identifier, typo included', () => {
    expect(expo.ios.bundleIdentifier).toBe('com.gracord.graybag');
  });

  it('uses the existing Android package, capitals included', () => {
    expect(expo.android.package).toBe('com.Gracord.Graybag');
  });

  it('does not accidentally make the two identifiers agree', () => {
    // They genuinely differ in case. If someone "fixes" one to match the other, this fails.
    expect(expo.ios.bundleIdentifier).not.toBe(expo.android.package);
    expect(expo.ios.bundleIdentifier.toLowerCase()).toBe(expo.android.package.toLowerCase());
  });

  /**
   * **iPhone only, and that matches the live listing** — `E17-36`.
   *
   * Verified against App Store Connect by Andy on **2026-08-11**: the live app does not support
   * iPad, and there is no intention to add it. Recorded because the value was previously
   * *assumed* — `supportsTablet: false` was written without anyone checking, and if the live
   * listing had been iPad-enabled this update would have dropped a device family from under
   * existing users, which Apple permits and users do not forgive.
   *
   * This is the same class as the version floor above: a constant about the outside world is
   * only an assertion once somebody has looked. The difference is that this one now says who
   * looked and when.
   */
  it('is iPhone only, matching the live listing', () => {
    expect(expo.ios.supportsTablet).toBe(false);
  });

  // S11: light mode only in v1. Left to the OS default, an Android 10+ device in dark mode
  // renders the app's own light surfaces against dark system chrome, which is the one
  // combination the contrast work (E13-13) has never measured.
  it('pins the interface style to light', () => {
    expect(expo.userInterfaceStyle).toBe('light');
  });
});

/**
 * `E14-11` — the OTA configuration, asserted because every one of these is invisible until it
 * is wrong, and each is wrong in a different expensive way.
 */
describe('app.json OTA configuration', () => {
  const { expo } = appJson as unknown as {
    expo: {
      owner: string;
      runtimeVersion: { policy: string };
      updates: { url: string; fallbackToCacheTimeout: number };
      extra: { eas: { projectId: string } };
    };
  };

  it('belongs to the Expo account that owns the store listings', () => {
    expect(expo.owner).toBe('anuragdial');
  });

  /**
   * The safety property of the whole feature. An update only reaches builds carrying the
   * same app version, so a JS bundle can never land on a binary whose native side it needs.
   * Switching this to `nativeVersion` or a fixed string would let a bundle that expects a new
   * native module ship to a binary without one — which crashes on launch, for everyone, with
   * no way to push a fix except a store release.
   */
  it('pins runtimeVersion to the app version', () => {
    expect(expo.runtimeVersion.policy).toBe('appVersion');
  });

  it('points updates at this project and nothing else', () => {
    // A URL carrying another project's id publishes into somebody else's app.
    expect(expo.updates.url).toBe(`https://u.expo.dev/${expo.extra.eas.projectId}`);
  });

  it('does not block the splash screen indefinitely on a bad connection', () => {
    // R2 halts a rollout on Sentry error spikes; an update check that blocks startup on a
    // slow connection would itself be the spike. Non-zero so a fast network still gets the
    // newest bundle immediately, bounded so a slow one starts anyway.
    expect(expo.updates.fallbackToCacheTimeout).toBeGreaterThan(0);
    expect(expo.updates.fallbackToCacheTimeout).toBeLessThanOrEqual(15_000);
  });
});

/**
 * `eas.json`. The build profiles carry `APP_ENV`, which `packages/shared/src/env.ts` checks
 * against the Razorpay key prefix (`EN2`) — so a profile with the wrong one produces a build
 * that refuses to start, which is the correct and loud failure.
 */
describe('eas.json profiles', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const eas = require('../eas.json') as {
    cli: { appVersionSource: string };
    build: Record<
      string,
      {
        channel?: string;
        env?: { APP_ENV?: string };
        extends?: string;
        environment?: string;
        autoIncrement?: boolean;
        android?: { buildType?: string };
      }
    >;
    submit: Record<string, { ios?: { appleTeamId?: string; ascAppId?: string } }>;
  };

  /**
   * **Every build profile must name the EAS environment it loads variables from.**
   *
   * 2026-08-11, caught minutes before a TestFlight build was paid for. No profile declared an
   * `environment`, so EAS resolved **`production`** for all of them — and the `production`
   * environment on EAS is empty, while the staging values live in `preview`. `eas
   * build:version:get` said so itself:
   *
   *     Resolved "production" environment for the build.
   *     No environment variables ... found for the "production" environment on EAS.
   *
   * The build would have shipped with `EXPO_PUBLIC_SUPABASE_URL`, `_ANON_KEY` and `_APP_ENV`
   * all undefined. `configureApiFromEnvironment()` returns false for that, so the app opens on
   * `CantConnectScreen` — a tester installs it and sees "we can't connect", nothing else.
   *
   * The defect is the **default**: omitting the field is silently "production", which is the
   * one environment a staging build must never read. So the field is required here rather than
   * left to a default nobody can see in the file.
   */
  it.each(['development', 'staging', 'preview', 'production'])(
    'the %s profile names its EAS environment rather than defaulting to production',
    (profile) => {
      expect(eas.build[profile]?.environment).toBeDefined();
    },
  );

  it('never points a non-production profile at the production environment', () => {
    // The specific mistake, stated directly. `preview` builds the staging identity and must
    // load staging values; production is the only profile that may read production.
    for (const profile of ['development', 'staging', 'preview']) {
      expect(eas.build[profile]?.environment).not.toBe('production');
    }
    expect(eas.build.production?.environment).toBe('production');
  });

  /**
   * `appVersionSource: remote` means EAS owns the build number — and **without
   * `autoIncrement` it hands back the same integer every time**. `eas build:version:get`
   * reported `iOS buildNumber - 1` for a profile that had already produced a build.
   *
   * The first submit to a fresh App Store Connect record succeeds; the second is rejected as a
   * duplicate binary, after the build has been paid for and waited on. `production` had this
   * right from the start and the two internal profiles did not, which is backwards — internal
   * builds are the ones that get made repeatedly.
   */
  it.each(['staging', 'preview', 'production'])(
    'the %s profile increments its build number',
    (profile) => {
      expect(eas.build[profile]?.autoIncrement).toBe(true);
    },
  );

  it('has one profile per environment, each naming its APP_ENV', () => {
    expect(eas.build.development?.env?.APP_ENV).toBe('local');
    expect(eas.build.staging?.env?.APP_ENV).toBe('staging');
    expect(eas.build.production?.env?.APP_ENV).toBe('production');
  });

  it('gives each profile its own update channel', () => {
    // Channels are what keep a staging update off production installs. Two profiles sharing
    // a channel means an internal build's bundle reaches customers.
    const channels = ['development', 'staging', 'production'].map((p) => eas.build[p]?.channel);
    expect(channels).toEqual(['development', 'staging', 'production']);
    expect(new Set(channels).size).toBe(3);
  });

  it('takes the build number from EAS rather than from the repo', () => {
    // `appVersionSource: remote` stops two machines minting the same build number, which the
    // stores reject on submit — after the build has been paid for and waited on.
    expect(eas.cli.appVersionSource).toBe('remote');
  });

  it('carries the Apple team id for submission', () => {
    expect(eas.submit.production?.ios?.appleTeamId).toBe('F247T8Y2NT');
  });

  /**
   * **`ITMS-90054`, 2026-08-11.** `preview` was made a store-distribution build so it could
   * reach TestFlight, but it still carries the *staging* identity — and its submit profile
   * pointed at `6749555467`, the App Store Connect record for the **live** app. One record
   * accepts exactly one bundle id, so every preview submission was rejected on arrival.
   *
   * The fix is a second App Store Connect record, `6800175123`, whose bundle id is
   * `com.gracord.graybag.staging`. Staging now has its own TestFlight and its own testers,
   * and no path from an internal build touches the live listing.
   *
   * These are asserted as a **pairing**, not as two constants. The defect was never a wrong
   * number in isolation; it was a record and a bundle id that disagreed, which is invisible
   * until Apple says so. `applyIdentity` is the same function the build uses, so this reads
   * the bundle id each profile really produces rather than restating it.
   */
  describe('each submit profile targets the record that accepts its bundle id', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { applyIdentity } = require('../app.config.js');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const appJsonExpo = (require('../app.json') as { expo: unknown }).expo;

    const bundleIdFor = (profile: string) => {
      // `preview` inherits its environment from `staging` via `extends`, exactly as the build
      // does. Resolving it here means the test cannot drift from what EAS actually builds.
      const build = eas.build[profile];
      const appEnv = build?.env?.APP_ENV ?? eas.build[build?.extends ?? '']?.env?.APP_ENV;
      return applyIdentity(appJsonExpo, appEnv).ios.bundleIdentifier;
    };

    it.each([
      ['production', 'com.gracord.graybag', '6749555467'],
      ['preview', 'com.gracord.graybag.staging', '6800175123'],
    ])('%s builds %s and submits to %s', (profile, bundleId, ascAppId) => {
      expect(bundleIdFor(profile)).toBe(bundleId);
      expect(eas.submit[profile]?.ios?.ascAppId).toBe(ascAppId);
    });

    it('never submits two different bundle ids to one record', () => {
      // The shape of the failure, stated directly: if these ever agree again, some profile is
      // submitting a staging binary to the live app's record — or the reverse, which is worse.
      expect(bundleIdFor('preview')).not.toBe(bundleIdFor('production'));
      expect(eas.submit.preview?.ios?.ascAppId).not.toBe(eas.submit.production?.ios?.ascAppId);
    });
  });

  // `preview` is the name Andy uses for "a build to hand round". It extends `staging` rather
  // than restating it, so there is one description of an internal APK and not two that drift.
  it('has a preview profile that is the staging build under the name people ask for', () => {
    expect(eas.build.preview?.extends).toBe('staging');
    expect(eas.build.preview?.channel).toBe('staging');
  });

  it('still resolves preview onto the staging environment, not production', () => {
    // `extends` is what makes this true, so it is asserted rather than assumed: a preview
    // build that inherited production would put live Razorpay keys on a handset being passed
    // around an office.
    const base = eas.build[eas.build.preview?.extends ?? ''];
    expect(base?.env?.APP_ENV).toBe('staging');
    expect(base?.android?.buildType).toBe('apk');
  });
});

/**
 * The non-production identity split (`E17-28`).
 *
 * A build that installs **over** the live App Store app looks exactly like one that installs
 * beside it, right up until it is on the phone and the real app is gone. Andy has lost his
 * live app twice this way, so the rule is asserted rather than described.
 */
describe('app.config.js identity split', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { applyIdentity, STAGING_SCHEME } = require('../app.config.js') as {
    applyIdentity: (
      config: unknown,
      appEnv: string | undefined,
      /** The commit stamped into `extra.gitSha` for the on-screen build label. */
      sha?: string,
    ) => {
      name: string;
      scheme: string;
      ios: { bundleIdentifier: string };
      android: { package: string };
      extra: { appEnv: string; gitSha: string };
    };
    STAGING_SCHEME: string;
  };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const base = (require('../app.json') as { expo: unknown }).expo;

  it('leaves production exactly as app.json describes it', () => {
    // `R4`: the live listings own these identifiers. Production is not ours to decorate.
    const out = applyIdentity(base, 'production');
    expect(out.ios.bundleIdentifier).toBe('com.gracord.graybag');
    expect(out.android.package).toBe('com.Gracord.Graybag');
    expect(out.name).toBe('GrayBag');
    expect(out.scheme).toBe('graybag');
  });

  /**
   * Three identities, not two.
   *
   * This used to assert that `staging`, `local` and `undefined` all produced the SAME
   * `.staging` identity, which is exactly the ambiguity that cost Andy a day: a development
   * build and a staging build installed as the same app with the same name, so the second
   * silently replaced the first and a bug reported from one was reproduced against the other.
   * The behaviour changed deliberately, and this case changed with it.
   */
  it.each([
    ['production', 'com.gracord.graybag', 'com.Gracord.Graybag', 'GrayBag', 'graybag'],
    ['staging', 'com.gracord.graybag.staging', 'com.Gracord.Graybag.staging', 'GrayBag Staging', 'graybag-staging'],
    ['local', 'com.gracord.graybag.dev', 'com.Gracord.Graybag.dev', 'GrayBag Dev', 'graybag-dev'],
  ])('gives %s its own id, name and scheme', (appEnv, iosId, androidId, name, scheme) => {
    const out = applyIdentity(base, appEnv);
    expect(out.ios.bundleIdentifier).toBe(iosId);
    expect(out.android.package).toBe(androidId);
    expect(out.name).toBe(name);
    expect(out.scheme).toBe(scheme);
  });

  it('makes all three installable side by side', () => {
    // The property that matters, stated once rather than inferred from the rows above: no two
    // environments may share a bundle id, a display name or a scheme.
    const all = ['production', 'staging', 'local'].map((env) => applyIdentity(base, env));
    for (const field of [
      (c: ReturnType<typeof applyIdentity>) => c.ios.bundleIdentifier,
      (c: ReturnType<typeof applyIdentity>) => c.android.package,
      (c: ReturnType<typeof applyIdentity>) => c.name,
      (c: ReturnType<typeof applyIdentity>) => c.scheme,
    ]) {
      expect(new Set(all.map(field)).size).toBe(3);
    }
  });

  it('stamps the environment and commit into extra, for the on-screen build label', () => {
    // Two bug reports have been chased against the wrong binary. `BuildLabel` reads these.
    const out = applyIdentity(base, 'staging', 'abc1234');
    expect(out.extra.appEnv).toBe('staging');
    expect(out.extra.gitSha).toBe('abc1234');
  });

  it('labels an unrecognised APP_ENV as local rather than inventing an environment', () => {
    const out = applyIdentity(base, 'wat', 'abc1234');
    expect(out.extra.appEnv).toBe('local');
    expect(out.name).toBe('GrayBag Dev');
  });

  it.each(['local', undefined])(
    'still installs beside the live app when APP_ENV is %s',
    (appEnv) => {
      const out = applyIdentity(base, appEnv);
      expect(out.ios.bundleIdentifier).not.toBe('com.gracord.graybag');
      expect(out.name).not.toBe('GrayBag');
    },
  );

  it('defaults to the harmless identity when APP_ENV is missing', () => {
    // The dangerous identity is the one that can replace a customer's app, so it is the one
    // that has to be asked for. A forgotten env var must not produce it.
    expect(applyIdentity(base, undefined).ios.bundleIdentifier).not.toBe('com.gracord.graybag');
  });

  it('gives the two apps different URL schemes', () => {
    // Both are installed at once now. Two apps claiming `graybag://` is a coin flip as to
    // which one the OS hands a link to, and the loser is whichever one the user meant.
    const staging = applyIdentity(base, 'staging');
    const production = applyIdentity(base, 'production');
    expect(staging.scheme).toBe(STAGING_SCHEME);
    expect(staging.scheme).not.toBe(production.scheme);
  });

  it('keeps the two platforms suffixed identically', () => {
    // They differ in case and always have (`R4`). What they must not do is differ in whether
    // they were split at all — a half-applied split is how one platform quietly keeps the trap.
    const out = applyIdentity(base, 'staging');
    expect(out.ios.bundleIdentifier.toLowerCase()).toBe(out.android.package.toLowerCase());
  });
});

describe('the store version floor', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const app = require('../app.json') as { expo: { version: string } };

  /**
   * The live version **on the App Store**, read off App Store Connect on 2026-08-11, not
   * assumed. Google Play is a separate number and is deliberately not covered here — see
   * `LIVE_PLAY` below.
   *
   * This is the whole point of the constant. The previous rule here was `major >= 2`, written
   * when nobody had looked — and `2.0.0` passed it, was submitted, and came back as
   * `ITMS-90062`/`90186`/`90478`: the live Bubble app is **3.7.0**, so 2.0.0 is a *downgrade*.
   * The test was green for weeks while asserting a guess. A constant checked against an
   * assumption is not an assertion; it is the assumption, restated somewhere it looks
   * authoritative.
   *
   * If the live version moves, change this number and say where the new one was read from.
   * Nothing else in the repo may be the source for it — App Store Connect is.
   */
  const LIVE_STORE_VERSION = '3.7.0';

  /** Numeric compare, so `3.10.0 > 3.7.0` rather than the string ordering that says otherwise. */
  const parts = (v: string): [number, number, number] => {
    const [major = 0, minor = 0, patch = 0] = v.split('.').map(Number);
    return [major, minor, patch];
  };
  const compare = (a: string, b: string) => {
    const x = parts(a);
    const y = parts(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  };

  /**
   * GrayBag is **already live on both stores** as the Bubble build. An upload whose version is
   * not higher than the live one is rejected — after the build has been paid for and waited
   * on, which is the expensive place to discover it.
   *
   * The build *number* is separate and comes from EAS (`appVersionSource: remote` with
   * `autoIncrement`); this is the marketing version, and it is the one the stores compare.
   */
  it(`is strictly greater than the live store version ${LIVE_STORE_VERSION}`, () => {
    expect(compare(app.expo.version, LIVE_STORE_VERSION)).toBeGreaterThan(0);
  });

  it('rejects a version that merely equals the live one', () => {
    // Equal is not greater, and the stores treat it as a duplicate. Asserted because the
    // obvious implementation of the rule above — `>=` — is wrong in exactly this case.
    expect(compare(LIVE_STORE_VERSION, LIVE_STORE_VERSION)).toBe(0);
    expect(compare('3.6.9', LIVE_STORE_VERSION)).toBeLessThan(0);
    expect(compare('3.10.0', LIVE_STORE_VERSION)).toBeGreaterThan(0);
  });

  it('is a three-part version, which is what both stores expect', () => {
    expect(app.expo.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  /**
   * **Google Play has its own floor, and we do not know it yet (`E17-33`).**
   *
   * Found auditing the release config after `ITMS-90062`. The iOS floor above is now real, and
   * it is easy to read it as covering "the stores" — it does not. Play differs twice over:
   *
   * 1. Its live `versionName` need not equal the App Store's `3.7.0`. Two listings updated by
   *    hand over fourteen months drift, and nobody has looked at the Play Console.
   * 2. **Play rejects on `versionCode`, an integer, not on `versionName`.** `appVersionSource:
   *    remote` with `autoIncrement` means EAS mints that integer from its own counter, which
   *    began at 1 for this project. The live Bubble app's `versionCode` is some number nobody
   *    has read, and any upload at or below it is rejected — the identical failure to the one
   *    Apple just sent us, with a different error string, waiting on the first Play submit.
   *
   * So both are held as `null` rather than guessed, the way `check-supabase-config.mjs` holds
   * `SUPABASE_PRODUCTION_REF` empty rather than inventing a project ref. **The assertions
   * below are already written and activate the moment the numbers are filled in** — the gap is
   * the missing fact, not missing code, and filling one in cannot be done without the check.
   *
   * **`versionCode` filled in 2026-08-12**: Andy read `1777726914` off the Play Console. It is a
   * Unix timestamp — Bubble minted the build number from the clock — which is why it is nine
   * digits and why the obvious "start at 1" default is nowhere near it.
   *
   * `versionName` is **still null**, and deliberately: nobody has relayed it. The number that
   * arrived is the one Play actually rejects on, and 3.7.0 is the *App Store's* version. Copying
   * it across is precisely the guess the paragraph above exists to forbid.
   */
  const LIVE_PLAY: { versionName: string | null; versionCode: number | null } = {
    versionName: null,
    versionCode: 1_777_726_914,
  };

  /**
   * The value pushed to EAS's remote counter on **2026-08-13** with `eas build:version:set
   * -p android -e production`, read back with `build:version:get` to confirm it landed.
   *
   * It is recorded here because `appVersionSource: remote` puts the live number **on EAS's
   * servers**, where no test can see it and no commit can change it. Before this, the counter
   * stood at **1** — `build:version:set` said so itself — so every production submission would
   * have been rejected against a floor nine digits higher.
   *
   * Also a Unix timestamp, continuing Bubble's convention: it clears the floor by construction,
   * and `autoIncrement` only ever moves it further up. Android's ceiling is 2100000000, which
   * this leaves 313 million builds of headroom below.
   */
  const EAS_REMOTE_VERSION_CODE = 1_786_591_932;

  it('may know the Play versionCode without the versionName, but never the reverse', () => {
    // This was symmetric — "both numbers or neither" — and that was wrong in one direction.
    //
    // The dangerous half-filled state is a `versionName` typed in from memory with no
    // `versionCode`: a floor that *looks* covered while the number Play actually rejects on is
    // still unknown. The reverse is the safe half, and it is the state we are now in. A rule
    // that also blocked the safe direction would have meant either leaving the real number out
    // or inventing the other one, and the second is what this whole block exists to prevent.
    if (LIVE_PLAY.versionName !== null) expect(LIVE_PLAY.versionCode).not.toBeNull();
  });

  it('pushed a remote versionCode above the live one', () => {
    // `E17-30`. The relationship, not the constants: whatever was set had to clear the floor.
    expect(EAS_REMOTE_VERSION_CODE).toBeGreaterThan(LIVE_PLAY.versionCode as number);
    // Android's hard ceiling. A fat-fingered extra digit sails past the floor and is rejected
    // by Play for the opposite reason, which is a confusing morning.
    expect(EAS_REMOTE_VERSION_CODE).toBeLessThan(2_100_000_000);
  });

  it('clears the live Play versionName once it is known', () => {
    if (LIVE_PLAY.versionName === null) return; // E17-33 — nobody has read the Play Console
    expect(compare(app.expo.version, LIVE_PLAY.versionName)).toBeGreaterThan(0);
  });

  it('holds the live Play versionCode as the number Play rejects on, not a guess', () => {
    // Superseded the placeholder `> 0`, which went from "inactive" to "tautologically true" the
    // moment the real number arrived — the worst state for a guard to be in, because the suite
    // turns green on it. The floor's own shape is what is assertable here: nine digits, a Unix
    // timestamp, and nowhere near a counter that starts at 1.
    expect(LIVE_PLAY.versionCode).toBe(1_777_726_914);
  });
});
