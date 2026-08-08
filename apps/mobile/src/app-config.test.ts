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
