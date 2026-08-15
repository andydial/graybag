import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '@graybag/shared';

import { VersionGate } from './VersionGate';

/**
 * `E17-46` / `E01-28`. **The gate must not lock anybody out.**
 *
 * This file was missing, and that is the defect it exists to correct: `E17-46` shipped with tests
 * for the API function (`app-version.test.ts`) and for the screen (`update-required.test.tsx`) and
 * **none for the component that decides**. The api function returning `supported: true` proves
 * nothing about whether the component renders its children, and the component is what sits above
 * the entire app in `App.tsx`.
 *
 * The failure this guards is asymmetric and that asymmetry is the whole design:
 *
 * - A build wrongly **admitted** gets an app that mostly works.
 * - A parent wrongly **blocked** has no route back. The screen says update; the store says they
 *   are already on the latest build. They cannot order lunch and cannot fix it.
 *
 * So every uncertain path — no version, an unparseable one, a failed check, a transport that
 * cannot do RPCs at all — must render the children. Only an explicit `supported: false` blocks.
 */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const CHILD = 'the-app-behind-the-gate';

const show = async () =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <VersionGate>
        <Text testID={CHILD}>Menu</Text>
      </VersionGate>
    </SafeAreaProvider>,
  );

/** A transport whose `rpc` answers however the case needs. */
const withRpc = (impl: () => unknown) =>
  api.setApiTransport({
    from: () => {
      throw new Error('the version gate must not read a table');
    },
    rpc: impl,
  } as never);

afterEach(() => api.setApiTransport(null));

describe('VersionGate — admit on anything uncertain', () => {
  it('renders the app while the answer is still unknown', async () => {
    // `AR7`: nothing is a wall in front of browsing. A spinner here would be one, for every
    // parent, on every cold start, for a condition that is false almost always.
    withRpc(() => new Promise(() => {}) as never); // never resolves
    await show();
    expect(screen.getByTestId(CHILD)).toBeOnTheScreen();
  });

  it('renders the app when the build states no version', async () => {
    // The case `E01-28` is about. A build that cannot read its own version — or a harness that
    // strips it — must not be locked out.
    const seen: unknown[] = [];
    withRpc(((_fn: string, args: Record<string, unknown>) => {
      seen.push(args?.p_version);
      return Promise.resolve({
        data: { supported: true, minimum_version: '4.0.0', reason: 'version_not_stated' },
        error: null,
      });
    }) as never);

    await show();
    await waitFor(() => expect(seen.length).toBe(1));
    expect(screen.getByTestId(CHILD)).toBeOnTheScreen();
    expect(screen.queryByTestId('screen-update-required')).toBeNull();
  });

  it('renders the app when the server cannot parse the version', async () => {
    withRpc((() =>
      Promise.resolve({
        data: { supported: true, minimum_version: '4.0.0', reason: 'version_not_stated' },
        error: null,
      })) as never);
    await show();
    await waitFor(() => expect(screen.getByTestId(CHILD)).toBeOnTheScreen());
  });

  it('renders the app when the check fails outright', async () => {
    // An outage must not lock every parent out using the mechanism whose job is to tell them
    // how to keep ordering.
    withRpc((() =>
      Promise.resolve({ data: null, error: { message: 'network is down', code: 'PGRST000' } })) as never);
    await show();
    await waitFor(() => expect(screen.getByTestId(CHILD)).toBeOnTheScreen());
  });

  it('renders the app when the transport cannot call RPCs at all', async () => {
    // A build whose transport predates `rpc`, or a test double that never had it.
    api.setApiTransport({ from: () => ({ select: () => ({}) }) } as never);
    await show();
    await waitFor(() => expect(screen.getByTestId(CHILD)).toBeOnTheScreen());
  });

  it('renders the app when the api module was never configured', async () => {
    // **The Maestro-shaped case.** A launch where `configureApi` has not run — or ran and
    // failed — makes `getTransport()` throw. If that threw out of the gate rather than being
    // swallowed, the entire app would be a blank screen on every affected build.
    api.setApiTransport(null);
    await show();
    await waitFor(() => expect(screen.getByTestId(CHILD)).toBeOnTheScreen());
  });

  it('renders the app when the answer is malformed', async () => {
    withRpc((() => Promise.resolve({ data: 'not an object', error: null })) as never);
    await show();
    await waitFor(() => expect(screen.getByTestId(CHILD)).toBeOnTheScreen());
  });

  it('renders the app when the rpc throws synchronously', async () => {
    withRpc((() => {
      throw new Error('exploded');
    }) as never);
    await show();
    await waitFor(() => expect(screen.getByTestId(CHILD)).toBeOnTheScreen());
  });
});

describe('VersionGate — blocks only on an explicit refusal', () => {
  it('blocks, and shows the update screen, when the server says false', async () => {
    // The feature has to actually work, or the 19th is a store listing and an email.
    withRpc((() =>
      Promise.resolve({
        data: { supported: false, minimum_version: '4.0.0', message: 'Please update GrayBag.' },
        error: null,
      })) as never);

    await show();
    await waitFor(() => expect(screen.getByTestId('screen-update-required')).toBeOnTheScreen());
    expect(screen.queryByTestId(CHILD)).toBeNull();
  });

  it('carries the server’s sentence and the floor onto the gated screen', async () => {
    withRpc((() =>
      Promise.resolve({
        data: { supported: false, minimum_version: '4.0.0', message: 'Please update GrayBag.' },
        error: null,
      })) as never);

    await show();
    await waitFor(() =>
      expect(screen.getByTestId('screen-update-required-message')).toHaveTextContent(
        'Please update GrayBag.',
      ),
    );
    expect(screen.getByTestId('screen-update-required-minimum')).toHaveTextContent(/4\.0\.0/);
  });

  it('does not block before the answer arrives, even when the answer will be false', async () => {
    // The ordering matters: a gate that rendered its blocking state optimistically would flash
    // "update required" at every parent on every launch.
    let resolve!: (v: unknown) => void;
    withRpc((() => new Promise((r) => { resolve = r; })) as never);

    await show();
    expect(screen.getByTestId(CHILD)).toBeOnTheScreen();

    resolve({ data: { supported: false, minimum_version: '4.0.0' }, error: null });
    await waitFor(() => expect(screen.getByTestId('screen-update-required')).toBeOnTheScreen());
  });
});
