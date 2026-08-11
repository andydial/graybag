import { render, screen } from '@testing-library/react-native';
import { POLICY_DOCUMENTS, type PolicyKey } from '@graybag/shared';

import { PolicyDocumentScreen, blocks } from './PolicyDocumentScreen';

const KEYS: PolicyKey[] = ['privacy', 'terms', 'refund'];

/**
 * `E20-38` — `AccountScreen.onPolicy` had no caller, so nothing in the app opened any of the
 * three documents.
 */
describe('PolicyDocumentScreen', () => {
  it.each(KEYS)('renders %s with its real text, not a placeholder screen', async (which) => {
    await render(<PolicyDocumentScreen which={which} />);
    expect(screen.getByText(POLICY_DOCUMENTS[which].title)).toBeTruthy();
    // The document must actually be on screen. A title and an empty body would pass a
    // reachability check and fail a parent.
    expect(screen.getByTestId('screen-policy-document-block-0')).toBeTruthy();
  });

  it('says plainly when a document is still a draft', async () => {
    // All three carry «…-PENDING-…» tokens until `E20-01` returns. Rendering those inside a
    // paragraph and hoping nobody reads that far is how a placeholder reaches a store review.
    await render(<PolicyDocumentScreen which="privacy" />);
    expect(POLICY_DOCUMENTS.privacy.hasPendingTokens).toBe(true);
    expect(screen.getByTestId('screen-policy-document-draft')).toBeTruthy();
  });

  describe('the markdown reduction', () => {
    it('does not render a whole document as one paragraph', () => {
      // The failure that is easy to miss by eye and trivial to assert here.
      const parsed = blocks(POLICY_DOCUMENTS.privacy.markdown);
      expect(parsed.length).toBeGreaterThan(20);
      expect(parsed.some((b) => b.kind === 'h1' || b.kind === 'h2')).toBe(true);
    });

    it('joins hard-wrapped prose back into sentences', () => {
      // The source is wrapped at 90 columns. One block per source line would break every
      // sentence in the document at an arbitrary point.
      expect(blocks('One line\nsecond line')).toEqual([{ kind: 'p', text: 'One line second line' }]);
    });

    it('keeps headings and list items apart from prose', () => {
      expect(blocks('## A heading')).toEqual([{ kind: 'h2', text: 'A heading' }]);
      expect(blocks('- an item')).toEqual([{ kind: 'li', text: '•  an item' }]);
    });

    it('strips emphasis and link syntax rather than showing it', () => {
      expect(blocks('**bold** and [a link](https://example.com) and `code`')).toEqual([
        { kind: 'p', text: 'bold and a link and code' },
      ]);
    });
  });
});

/**
 * `E20-27` — the production guard.
 *
 * A placeholder is a value nobody has approved. One inside a published policy is a compliance
 * problem, not a typo, and the store forms are answered *from* these documents.
 */
describe('no policy document reaches production with a placeholder in it', () => {
  it.each(KEYS)('%s', (which) => {
    const doc = POLICY_DOCUMENTS[which];
    if (process.env.EXPO_PUBLIC_APP_ENV !== 'production') {
      // Outside production a pending token is the expected state, and the screen says so. What
      // is asserted here is that the flag and the text agree — a document that carries tokens
      // but reports `hasPendingTokens: false` would disarm the guard below silently.
      expect(doc.hasPendingTokens).toBe(doc.pendingTokens.length > 0);
      expect(doc.pendingTokens.length > 0).toBe(/«[^»]*PENDING[^»]*»/.test(doc.markdown));
      return;
    }
    expect(doc.pendingTokens).toEqual([]);
    expect(doc.hasPendingTokens).toBe(false);
  });
});
