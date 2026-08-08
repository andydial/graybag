// Jest setup for the mobile app.
//
// Reanimated ships its own mock and it must be installed before any module that calls
// `useAnimatedStyle` is imported, which is why this runs in `setupFilesAfterEach` rather than
// inside a test file. Without it every component touching motion throws on import, and the
// failure looks like a broken component instead of a missing test harness.
// Note: `@testing-library/react-native/extend-expect` does **not** exist on v12.4+ — the
// matchers (`toBeOnTheScreen`, `toHaveStyle`) are built in and register themselves. Most
// tutorials still import it, and the failure is a confusing "cannot find module" from the
// setup file rather than from a test.

// `S25`: the motion module owns every duration and curve. Under test the animations must still
// *run* — `E13-12`/`S27` is explicit that a zero-duration transition still fires its completion
// callback, and several components advance state on that callback. So this is a real mock, not
// a no-op that strips animation out.
// `jest.requireActual` rather than a bare `require()`: the factory is hoisted above the
// imports so it cannot close over one, and `require()` is banned repo-wide by
// `@typescript-eslint/no-require-imports`. This form satisfies both.
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));
