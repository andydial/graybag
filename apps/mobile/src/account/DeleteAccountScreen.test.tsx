import { Linking } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

import { DeleteAccountScreen } from './DeleteAccountScreen';
import { SUPPORT_EMAIL, SUPPORT_SUBJECTS } from '../support/contact';

const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

/**
 * `E20-37` — `AccountScreen.onDeleteAccount` had no caller, so the danger row rendered in red
 * and did nothing. A store reviewer taps this during submission.
 *
 * These are about what the screen **commits to**, because the failure mode here is not a crash
 * — it is telling a parent something about their data that is not true.
 */
describe('DeleteAccountScreen', () => {
  beforeEach(() => openURL.mockClear());

  it('says what is kept, not only what is deleted', async () => {
    // Statutory retention under Indian tax law. A parent is entitled to know before they ask,
    // and "your data is gone" while the invoices remain is worse than saying nothing.
    await render(<DeleteAccountScreen />);
    expect(screen.getByTestId('screen-delete-account-what-stays')).toBeTruthy();
    expect(screen.getByText(/Invoices and payment records/)).toBeTruthy();
  });

  it('promises no timeline it cannot keep', async () => {
    // `data_subject_request.due_at` has no legal number yet — it comes from `E20-01`, and
    // `E20-40` puts it here. Printing "within 30 days" would be a confident constant standing
    // in for an unanswered question, which is the defect that cost us this week.
    const { toJSON } = await render(<DeleteAccountScreen />);
    const rendered = JSON.stringify(toJSON());
    expect(rendered).not.toMatch(/\b\d+\s*(days?|hours?|weeks?|months?)\b/i);
    expect(rendered).not.toMatch(/immediately|straight away|instantly/i);
  });

  it('opens a composed request rather than pretending to delete', async () => {
    await render(<DeleteAccountScreen />);
    fireEvent.press(screen.getByTestId('screen-delete-account-request'));

    const [url] = openURL.mock.calls[0] ?? [];
    expect(url).toContain(`mailto:${SUPPORT_EMAIL}`);
    // A distinct subject: a deletion request must not be lost in a general support inbox.
    expect(url).toContain(encodeURIComponent(SUPPORT_SUBJECTS.deleteAccount));
  });

  it('never draws the support address', async () => {
    const { toJSON } = await render(<DeleteAccountScreen />);
    expect(JSON.stringify(toJSON())).not.toContain(SUPPORT_EMAIL);
  });
});
