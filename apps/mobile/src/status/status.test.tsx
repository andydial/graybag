import { render, screen, fireEvent } from '@testing-library/react-native';

import { Linking } from 'react-native';

import { GRIEVANCE_EMAIL, SUPPORT_EMAIL, SUPPORT_SUBJECTS } from '../support/contact';

// The screen calls `Linking.openURL` directly rather than taking an injectable `openUrl` prop:
// a prop only this file would ever pass is an orphan, and `orphans.test.ts` says so. Mocking
// the platform module keeps the production path and the tested path the same one.
const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

import { CantConnectScreen } from './CantConnectScreen';
import { PolicyGateScreen } from './PolicyGateScreen';
import { SupportScreen } from './SupportScreen';

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

describe('SupportScreen', () => {
  it('says the grievance contact is coming rather than inventing one', async () => {
    await render(<SupportScreen />);
    // A published contact that goes nowhere is a commitment on record we are already failing.
    // Saying "not yet" is honest; a plausible-looking address is worse than useless.
    expect(screen.getByTestId('screen-support-grievance-pending')).toBeTruthy();
  });

  it('publishes the real contact once it has one, and drops the notice', async () => {
    await render(
      <SupportScreen
        grievance={{ designation: 'Grievance Officer', address: 'Mohali, Punjab' }}
      />,
    );
    expect(screen.queryByTestId('screen-support-grievance-pending')).toBeNull();
    expect(screen.getByText('Grievance Officer')).toBeTruthy();
    expect(screen.getByText('Mohali, Punjab')).toBeTruthy();
  });

  it('publishes the officer without a postal address, which is what we have', async () => {
    // `E20-21` stays open for a postal address. One real fact beats two with one invented.
    await render(<SupportScreen grievance={{ designation: 'Grievance Officer' }} />);
    expect(screen.queryByTestId('screen-support-grievance-pending')).toBeNull();
    expect(screen.getByText('Grievance Officer')).toBeTruthy();
  });

  /**
   * **No individual's name reaches this screen.** Andy, 2026-08-15.
   *
   * `GrievanceOfficer.name` carried "Vivek" and is gone from the type, so this is enforced by
   * the compiler as well as here — but the assertion stays, because the compiler protects the
   * prop and this protects the *screen*. A name could equally arrive baked into a
   * `designation` string, and the whole rendered tree is where that would show up.
   */
  it('draws no individual’s name, only a role', async () => {
    const { toJSON } = await render(
      <SupportScreen grievance={{ designation: 'Grievance Officer' }} />,
    );
    const tree = JSON.stringify(toJSON());
    for (const name of ['Vivek', 'Andy', 'Anurag']) {
      expect(tree).not.toContain(name);
    }
  });

  /**
   * **These two assertions replaced their opposites, on Andy's instruction (2026-08-11).**
   *
   * The previous tests asserted that the grievance email *was* rendered, and that no email
   * button appeared unless an address was passed in. Both now assert the reverse: the address
   * is never drawn, and the compose action is always available.
   *
   * Recorded here rather than only in a commit message because a test that reverses direction
   * deserves to say why in the file someone will read it in.
   */
  it('never draws the support address anywhere on the screen', async () => {
    const { toJSON } = await render(
      <SupportScreen
        grievance={{ designation: 'Grievance Officer', address: 'Mohali, Punjab' }}
      />,
    );
    // The whole rendered tree, not just the text nodes we thought to check — an address in an
    // accessibility label or a placeholder is just as scrapeable as one in a paragraph.
    expect(JSON.stringify(toJSON())).not.toContain(SUPPORT_EMAIL);
    expect(JSON.stringify(toJSON())).not.toContain(GRIEVANCE_EMAIL);
    expect(JSON.stringify(toJSON())).not.toContain('@');
  });

  it('always offers a way to reach a person, address or no address', async () => {
    // The contact point is a compliance requirement; it cannot be conditional on a prop that
    // nothing passes. That is precisely how `E20-39` came to be unreachable.
    await render(<SupportScreen />);
    expect(screen.getByTestId('screen-support-email')).toBeTruthy();
    expect(screen.getByTestId('screen-support-grievance-email')).toBeTruthy();
  });

  it('composes to the support address with a subject that says what it is', async () => {
    openURL.mockClear();
    await render(<SupportScreen />);

    fireEvent.press(screen.getByTestId('screen-support-grievance-email'));
    const opened = openURL.mock.calls.map(([url]) => url);
    // **The grievance route, which is `support@graybag.com` since 2026-08-15** — no individual's
    // mailbox in the app. `GRIEVANCE_EMAIL` and `SUPPORT_EMAIL` are now the same address, so the
    // old `not.toContain(SUPPORT_EMAIL)` assertion is gone: it would now be asserting that the
    // button does NOT go where it is supposed to go.
    //
    // The constants stay distinct because the *routing* is: the subject below is what lets a
    // data-protection matter be filtered out of the order-query pile, and DPDP puts those on a
    // statutory clock. This asserts the destination; the subject assertion is the real content.
    expect(opened[0]).toContain(`mailto:${GRIEVANCE_EMAIL}`);
    // DPDP puts a data-protection query on a statutory clock. One undifferentiated inbox is
    // how a deadline gets missed, so the subject carries the reason.
    expect(opened[0]).toContain(encodeURIComponent(SUPPORT_SUBJECTS.grievance));
  });

  it('puts nothing identifying in the subject line', async () => {
    // A subject travels through mail servers in the clear (non-negotiable #4).
    for (const subject of Object.values(SUPPORT_SUBJECTS)) {
      expect(subject).toMatch(/^GrayBag — /);
      expect(subject).not.toMatch(/\d/);
    }
  });
});
