import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { api } from '@graybag/shared';

import { PolicyGateContainer } from './PolicyGateContainer';

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

const VERSION: api.PendingPolicy = {
  versionId: 'v2',
  policyCode: 'privacy_policy',
  version: '2',
  summaryOfChanges: 'We now say what the kitchen keeps and for how long.',
};

/**
 * `E20-36` — the gate had **no caller**.
 *
 * `PolicyGateScreen` was built, styled and covered by `status.test.tsx`, and `onAccept`,
 * `onNotNow` and `accepting` were passed by nothing anywhere in the app. One of the six v1
 * compliance controls had never run once.
 *
 * So these tests are deliberately about *the wire*, not the screen. A screen test mounts the
 * screen directly, which is exactly the situation a real user is never in — the same lesson
 * `reachability.test.ts` was written for after sign-in shipped behind a wall.
 */
describe('the policy gate, wired', () => {
  /**
   * A fake **transport**, not a stubbed `acceptPolicyVersion`.
   *
   * Two reasons. `api` is an ES module namespace, so its exports are non-configurable and
   * `jest.spyOn` cannot replace one. And more usefully: this exercises the real
   * `acceptPolicyVersion` and the real `invokeFunction`, so the assertion below is that the
   * gate calls **the `policy` Edge Function with the right body** — the actual contract —
   * rather than that it called a function this test replaced.
   */
  const invoke = jest.fn();

  beforeEach(() => {
    mockGoBack.mockClear();
    invoke.mockReset();
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    api.setApiTransport({
      from: () => ({ select: () => ({}) }),
      functions: { invoke },
    } as never);
  });

  afterEach(() => api.setApiTransport(null as never));

  it('records the acceptance through the api module', async () => {
    const onAccepted = jest.fn();
    await render(<PolicyGateContainer version={VERSION} onAccepted={onAccepted} />);

    fireEvent.press(screen.getByTestId('screen-policy-gate-accept'));

    // The contract with the server: the `policy` function, the `accept` action, and the
    // version id — and deliberately nothing else. `source`, `app_version` and the hashes are
    // the server's to set, because evidence a client can author is not evidence.
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('policy', {
        body: { action: 'accept', versionId: 'v2' },
      }),
    );
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith('v2'));
  });

  it('returns the parent to what they were doing after accepting', async () => {
    await render(<PolicyGateContainer version={VERSION} onAccepted={jest.fn()} />);
    fireEvent.press(screen.getByTestId('screen-policy-gate-accept'));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
  });

  it('lets "Not now" through without recording anything', async () => {
    // `AR7`: this blocks ordering, not browsing. The second button is a real answer, and the
    // screen's own note says removing it would turn the gate into a wall.
    await render(<PolicyGateContainer version={VERSION} onAccepted={jest.fn()} />);
    fireEvent.press(screen.getByTestId('screen-policy-gate-not-now'));

    expect(mockGoBack).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('stays open and says why when the write fails', async () => {
    // Navigating back on failure would leave a parent believing they accepted something the
    // database has no record of — and the next refusal would arrive from checkout unexplained.
    invoke.mockResolvedValue({ data: null, error: new Error('We could not reach the server.') });
    const onAccepted = jest.fn();
    await render(<PolicyGateContainer version={VERSION} onAccepted={onAccepted} />);

    fireEvent.press(screen.getByTestId('screen-policy-gate-accept'));

    await waitFor(() =>
      expect(screen.getByTestId('screen-policy-gate-error')).toBeTruthy(),
    );
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it('shows what changed, from the version rather than boilerplate', async () => {
    await render(<PolicyGateContainer version={VERSION} onAccepted={jest.fn()} />);
    expect(
      screen.getByText('We now say what the kitchen keeps and for how long.'),
    ).toBeTruthy();
  });

  it('substitutes a plain summary rather than an empty panel', async () => {
    // A published version may carry no `summary_of_changes`. Asking someone to accept a change
    // we decline to describe is worse than saying plainly that the document changed.
    await render(
      <PolicyGateContainer
        version={{ ...VERSION, summaryOfChanges: null }}
        onAccepted={jest.fn()}
      />,
    );
    expect(screen.getByText(/We have updated this policy/)).toBeTruthy();
  });

  it('renders nothing when there is no pending version', async () => {
    // The route can be reached with an empty context — after accepting, before unmount. It
    // must not render a gate for a policy that is no longer pending.
    await render(<PolicyGateContainer version={null} onAccepted={jest.fn()} />);
    expect(screen.queryByTestId('screen-policy-gate')).toBeNull();
  });
});
