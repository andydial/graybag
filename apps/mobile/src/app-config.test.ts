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
        android?: { buildType?: string };
      }
    >;
    submit: Record<string, { ios?: { appleTeamId?: string } }>;
  };

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
  const { applyIdentity, STAGING_NAME, STAGING_SCHEME } = require('../app.config.js') as {
    applyIdentity: (config: unknown, appEnv: string | undefined) => {
      name: string;
      scheme: string;
      ios: { bundleIdentifier: string };
      android: { package: string };
    };
    STAGING_NAME: string;
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

  it.each(['staging', 'local', undefined])(
    'installs beside the live app when APP_ENV is %s',
    (appEnv) => {
      const out = applyIdentity(base, appEnv);
      expect(out.ios.bundleIdentifier).toBe('com.gracord.graybag.staging');
      expect(out.android.package).toBe('com.Gracord.Graybag.staging');
      expect(out.name).toBe(STAGING_NAME);
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
   * GrayBag is **already live on both stores** as the Bubble build. An upload whose version is
   * not higher than the live one is rejected — after the build has been paid for and waited
   * on, which is the expensive place to discover it.
   *
   * The rebuild therefore starts at 2.x. The build *number* is separate and comes from EAS
   * (`appVersionSource: remote` with `autoIncrement`); this is the marketing version, and it
   * is the one the stores compare.
   */
  it('starts above the live Bubble build', () => {
    const [major] = app.expo.version.split('.').map(Number);
    expect(major).toBeGreaterThanOrEqual(2);
  });

  it('is a three-part version, which is what both stores expect', () => {
    expect(app.expo.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
