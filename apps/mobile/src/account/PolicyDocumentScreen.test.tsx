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

  /**
   * **Terms, not privacy.** This assertion used to name `privacy`, and it was right to: all
   * three documents were `E20-24` templates full of «…-PENDING-…» placeholders.
   *
   * On 2026-08-11 Andy supplied the lawyer-drafted privacy and refund policies, so those two
   * are now real published documents and carry no banner. Terms has no lawyer baseline yet and
   * is still the template, so it is what proves the banner still works.
   */
  it('says plainly when a document is still a draft', async () => {
    await render(<PolicyDocumentScreen which="terms" />);
    expect(POLICY_DOCUMENTS.terms.hasPendingTokens).toBe(true);
    expect(screen.getByTestId('screen-policy-document-draft')).toBeTruthy();
  });

  it.each(['privacy', 'refund'] as const)(
    'shows no draft banner on %s, which is lawyer-approved',
    async (which) => {
      // The published documents are the baseline in `docs/legal/` plus a tracked change log
      // (`C17`). A banner on them would tell a parent the lawyer's text is provisional.
      await render(<PolicyDocumentScreen which={which} />);
      expect(POLICY_DOCUMENTS[which].hasPendingTokens).toBe(false);
      expect(screen.queryByTestId('screen-policy-document-draft')).toBeNull();
    },
  );

  it('carries the three tracked changes into the app, not just into docs/', async () => {
    // The whole point of generating from `docs/`: what a parent reads and what the lawyer
    // approved are one string. If the change log ever stops reaching the app, this fails.
    const { markdown } = POLICY_DOCUMENTS.privacy;
    expect(markdown).toContain('under 18');
    expect(markdown).toContain('vivek@graybag.com');
    expect(markdown).toContain('when the guardian link ends');

    /**
     * Retention defers to the law and **names no period** — corrected 2026-08-11.
     *
     * This assertion used to be `toContain('7 years')`, which is how a number nobody had
     * verified became load-bearing. Andy supplied the figure, withdrew it three days later, and
     * it may be *below* the floor: the Companies Act 2013 requires books of account for eight
     * years and the GST record period is 72 months from the annual return. A published
     * commitment shorter than the law requires is worse than one that does not commit.
     *
     * So the body is asserted to carry the deferring wording and **not** a bare number. The
     * negative half is the half that matters: without it the figure walks back in the first
     * time somebody "improves" the copy, and the test that should have caught it would be the
     * test asserting it.
     *
     * Sliced past the change log, which quotes the withdrawn figure in order to record the
     * correction — the same reason the refund address is asserted on the body below.
     */
    const privacyBody = markdown.slice(markdown.indexOf('## 4') === -1 ? 0 : markdown.indexOf('## 4'));
    expect(privacyBody).toContain('as long as Indian tax and company law requires');
    expect(privacyBody).not.toMatch(/\b(7|seven)[ -]years?\b/i);
    // The corrected address. Asserted on the **body** — everything after the change log's
    // `---` — because the change log itself quotes the old address in order to record the
    // correction, which is what a tracked change is for. What must never carry it is the
    // policy a parent acts on.
    const refund = POLICY_DOCUMENTS.refund.markdown;
    const body = refund.slice(refund.indexOf('\n---\n') + 5);
    expect(body).toContain('info@graybag.com');
    expect(body).not.toContain('info@graybag.in');
    // And the change log does record it, so the correction is auditable rather than silent.
    expect(refund.slice(0, refund.indexOf('\n---\n'))).toContain('info@graybag.in');
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
