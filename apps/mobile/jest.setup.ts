// Jest setup for the mobile app.
//
// Two things that cost a debugging round each and are written up in docs/learnings.md:
//
// 1. `@testing-library/react-native/extend-expect` does **not** exist on v12.4+ — the
//    matchers (`toBeOnTheScreen`, `toHaveStyle`) are built in and register themselves. Most
//    tutorials still import it, and the failure is a confusing "cannot find module" thrown
//    from this file, which makes every suite fail and none of them the one at fault.
//
// 2. **Reanimated is not mocked, and must not be.** The obvious setup —
//    `jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'))`
//    — is what every tutorial shows and it throws on Reanimated 4: the mock imports the real
//    index, which pulls in `react-native-worklets`, which reaches for a native module that
//    does not exist under jest (`Cannot read properties of undefined (reading 'loadUnpackers')`).
//    The fix is the resolver `react-native-worklets/jest/resolver.js`, wired in
//    `package.json` — it strips `.native` extensions for that package so jest resolves the
//    non-native implementation. Animations then really run, which is what `S27` needs:
//    `resolveDuration` returns `duration.instant` rather than skipping, so completion
//    callbacks still fire and a component whose state advance hangs off one still works.
//
// Nothing else is mocked. A setup file that mocks things "just in case" is how a suite
// stops testing the thing it names.

/**
 * `expo-image` IS mocked, and the contrast with Reanimated above is the point.
 *
 * Reanimated is not mocked because its *behaviour* is under test — completion callbacks have
 * to fire (`S27`). expo-image has no behaviour worth simulating here: there is no decoding,
 * no disk cache and no network in jest, and its real module throws on import anyway
 * (`observe.getIntegrations is not a function`) because the native side is absent.
 *
 * The mock renders a `View` and **passes every prop through**, so the things that actually
 * matter — `recyclingKey` set from the dish id, `cachePolicy: 'memory-disk'`, the requested
 * size — are assertable. A mock that swallowed props would make `DishImage`'s tests
 * tautological, which is worse than not testing it.
 */
jest.mock('expo-image', () => {
  const { View } = jest.requireActual('react-native');
  return { __esModule: true, Image: View };
});

/**
 * `react-native-razorpay` builds a `NativeEventEmitter` **at import time**, and under Jest the
 * native module behind it is `null` — so merely importing it throws
 * `Invariant Violation: new NativeEventEmitter() requires a non-null argument`.
 *
 * That is not a failure in the file importing it. It took down `RootNavigator.test.tsx` and the
 * whole a11y audit the moment checkout was wired, because both render the navigator and the
 * navigator now reaches the SDK three imports away. **Thirty-six tests stopped running and the
 * suite still said "844 passed"** — a suite that fails to load reports no failures of its own.
 *
 * Mocked globally rather than per-file for exactly that reason: any screen that ends up on a path
 * to checkout would otherwise fail on import, and the failure names the SDK rather than the
 * change that caused it. `src/checkout/razorpay.test.ts` overrides this with its own mock to
 * assert what is actually sent.
 */
jest.mock('react-native-razorpay', () => ({
  __esModule: true,
  default: {
    open: jest.fn(() =>
      Promise.reject(
        new Error('react-native-razorpay is mocked in jest.setup.ts — mock it in the test instead'),
      ),
    ),
  },
}));
