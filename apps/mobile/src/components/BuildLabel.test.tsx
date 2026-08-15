import { render, screen } from '@testing-library/react-native';

import { BuildLabel, buildLabelText, type BuildIdentity } from './BuildLabel';

/**
 * `E17-54`. **The label has to be able to say the JS is not the binary's.**
 *
 * `gitSha` is stamped at build time and never moves when an OTA lands, so a build running a
 * bundle published half an hour ago still displays the commit its binary came from. Andy is
 * testing against TestFlight build 12 and shipping JS-only fixes over the air on top of it; if
 * the label cannot distinguish those two states, "did the update apply?" is answered by hoping.
 *
 * It is also self-proving in the one way that matters: **build 12 was compiled before this
 * segment existed**, so the segment can only appear on that binary if an update replaced its
 * JS. Seeing `· OTA 4625c38` at all *is* the proof, with nothing else to check.
 *
 * The logic is tested through `buildLabelText` rather than through a prop on the component. The
 * prop was tried and `orphans.test.ts` refused it — correctly, since nothing but a test would
 * ever pass it, which is the `E05-45` dead-props smell exactly.
 */
const NO_PII = /^[A-Za-z]+ · [^·]+( · (bundled|OTA [0-9a-f]{7}))?$/;

const SHA = '394dd2f';
const UPDATE = '4625c384-1f2e-4a7b-9c3d-8e5f60718293';

describe('buildLabelText', () => {
  it('says "bundled" when running the JS baked into the binary', () => {
    expect(buildLabelText('Production', SHA, { enabled: true, embedded: true, updateId: null })).toBe(
      'Production · 394dd2f · bundled',
    );
  });

  it('names the update, seven characters, when running a downloaded one', () => {
    // Seven to match the commit beside it — long enough to find in `eas update:list`, short
    // enough to read off a photograph of somebody's phone.
    expect(
      buildLabelText('Production', SHA, { enabled: true, embedded: false, updateId: UPDATE }),
    ).toBe('Production · 394dd2f · OTA 4625c38');
  });

  it('omits the segment entirely when updates are disabled', () => {
    // Expo Go and dev clients. "bundled" here is a true sentence that reads as a claim about an
    // update channel which is not running, so it says nothing instead.
    expect(buildLabelText('Dev', SHA, { enabled: false, embedded: true, updateId: null })).toBe(
      'Dev · 394dd2f',
    );
  });

  it('falls back to "bundled" when updates are on but no id is reported', () => {
    // A real state: `isEmbeddedLaunch` can be false while `updateId` is still unavailable on
    // some build configurations. Rendering `OTA null` would be worse than saying nothing new.
    expect(
      buildLabelText('Production', SHA, { enabled: true, embedded: false, updateId: null }),
    ).toBe('Production · 394dd2f · bundled');
  });

  // R6 / non-negotiable #4. This label is about the binary, never about whoever holds it — and
  // it is the one diagnostic deliberately visible in production, so every state it can reach is
  // checked rather than just the interesting one.
  it.each([
    ['embedded', { enabled: true, embedded: true, updateId: null }],
    ['updated', { enabled: true, embedded: false, updateId: UPDATE }],
    ['disabled', { enabled: false, embedded: true, updateId: null }],
  ] as [string, BuildIdentity][])('carries no personal data when %s', (_name, identity) => {
    expect(buildLabelText('Production', SHA, identity)).toMatch(NO_PII);
  });
});

describe('BuildLabel', () => {
  it('renders what it computes, under the id the Account screen points at', async () => {
    // `render` is async on RNTL v14 — docs/learnings.md 2026-08-09. The component reads the real
    // `expo-updates` here, so this covers the wiring and the testID, not the branches above.
    await render(<BuildLabel />);
    expect(screen.getByTestId('build-label')).toHaveTextContent(/·/);
  });
});
