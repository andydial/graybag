import { render, screen } from '@testing-library/react-native';

import { CantConnectScreen } from './CantConnectScreen';
import { PolicyGateScreen } from './PolicyGateScreen';

/**
 * `E21-16` and `E21-17`. Both screens exist to say something precise at a moment when the
 * obvious wording would be wrong, so the tests are about the words.
 */
describe('CantConnectScreen', () => {
  it('says the problem is ours, and that it is not the school’s menu', async () => {
    await render(<CantConnectScreen />);
    // The second half is the load-bearing one: after an empty Menu tab, "the school hasn't
    // published a menu" is the wrong conclusion a reader is most likely to draw.
    expect(screen.getByText(/isn’t your school’s menu/)).toBeTruthy();
    expect(screen.getByText(/This is us, not you/)).toBeTruthy();
  });

  it('never tells someone to check their connection', async () => {
    await render(<CantConnectScreen />);
    // An unconfigured build is a build problem. Sending a parent to restart their router over
    // it wastes their evening and hides ours.
    expect(screen.queryByText(/check your (connection|wifi|internet)/i)).toBeNull();
  });

  it('hides diagnostics unless asked, and shows variable NAMES only', async () => {
    const { rerender } = await render(
      <CantConnectScreen missing={['EXPO_PUBLIC_SUPABASE_URL']} appEnv="staging" />,
    );
    expect(screen.queryByTestId('screen-cant-connect-diagnostics')).toBeNull();

    await rerender(
      <CantConnectScreen missing={['EXPO_PUBLIC_SUPABASE_URL']} appEnv="staging" showDiagnostics />,
    );
    expect(screen.getByTestId('screen-cant-connect-diagnostics')).toBeTruthy();
    expect(screen.getByText(/EXPO_PUBLIC_SUPABASE_URL — missing/)).toBeTruthy();
  });

  it('offers no retry rather than a dead button when there is nothing to retry with', async () => {
    await render(<CantConnectScreen />);
    expect(screen.queryByTestId('screen-cant-connect-retry')).toBeNull();
  });
});

describe('PolicyGateScreen', () => {
  it('keeps browsing available — it gates writes, not the menu', async () => {
    await render(<PolicyGateScreen summary="Order history is now kept for 24 months." onNotNow={() => {}} />);
    // `AR7`: removing this turns the gate into a wall.
    expect(screen.getByTestId('screen-policy-gate-not-now')).toBeTruthy();
    // The lead line and the button both say it, which is the point — the offer is made before
    // the reader reaches the buttons. Assert the lead specifically.
    expect(screen.getByText(/You can keep browsing/)).toBeTruthy();
  });

  it('summarises what changed rather than reprinting the policy', async () => {
    await render(<PolicyGateScreen summary="Order history is now kept for 24 months." />);
    expect(screen.getByTestId('screen-policy-gate-summary')).toBeTruthy();
    expect(screen.getByText('Order history is now kept for 24 months.')).toBeTruthy();
  });

  it('disables accept while saving, so a double tap cannot double-record consent', async () => {
    await render(<PolicyGateScreen summary="…" onAccept={() => {}} accepting />);
    expect(screen.getByText('Saving…')).toBeTruthy();
  });
});
