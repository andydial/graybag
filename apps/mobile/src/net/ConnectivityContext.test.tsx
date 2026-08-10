import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  ConnectivityProvider,
  isNetworkFailure,
  useConnectivity,
} from './ConnectivityContext';

/**
 * `E14-26`. The behaviour worth pinning is not "does it detect wifi" — it measures whether our
 * own backend is reachable, which is the more useful question and a weaker signal. What must
 * not regress is the honesty: unknown is not offline, and a server that answers is not offline.
 */
function Probe() {
  const { status, offline } = useConnectivity();
  return <Text testID="status">{`${status}:${String(offline)}`}</Text>;
}

const mount = (props: Partial<React.ComponentProps<typeof ConnectivityProvider>> = {}) =>
  render(
    <ConnectivityProvider probeUrl="https://example.invalid" {...props}>
      <Probe />
    </ConnectivityProvider>,
  );

describe('isNetworkFailure', () => {
  it('treats fetch’s own failure as a network failure', () => {
    expect(isNetworkFailure(new TypeError('Network request failed'))).toBe(true);
    expect(isNetworkFailure(new Error('Failed to fetch'))).toBe(true);
    expect(isNetworkFailure(new Error('Unable to resolve host "x"'))).toBe(true);
  });

  /**
   * The distinction that stops us blaming a parent's signal for our bug: a 404 or a 403 is the
   * server *answering*. The connection worked perfectly. Calling that offline sends someone to
   * reboot their router over a missing grant.
   */
  it('does not treat a server answering with an error as offline', () => {
    expect(isNetworkFailure(new Error('permission denied for table school'))).toBe(false);
    expect(isNetworkFailure(new Error('Requested function was not found'))).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
  });
});

describe('ConnectivityProvider', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('starts unknown, and unknown is not offline', async () => {
    // Never resolves: the probe is still in flight, which is exactly the first moment of the
    // app's life. A screen must not say "you are offline" before anything has been tried.
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    await mount({ initial: 'unknown' });

    expect(screen.getByTestId('status')).toHaveTextContent('unknown:false');
  });

  it('reports offline when the probe fails in a network-shaped way', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    await mount();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('offline:true'));
  });

  it('reports online when the host answers at all', async () => {
    global.fetch = jest.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;

    await mount();

    // A 404 from the REST root is the server answering. Reachable.
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('online:false'));
  });

  it('stays unknown rather than claiming offline when no backend is configured', async () => {
    // An unconfigured build is a build problem, not a phone problem — `Can't connect` (§5.20)
    // is the screen for it, and telling someone to check their wifi would be a wrong answer
    // delivered confidently.
    global.fetch = jest.fn() as unknown as typeof fetch;

    await mount({ probeUrl: undefined });

    expect(screen.getByTestId('status')).toHaveTextContent('unknown:false');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
