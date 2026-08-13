import { describe, expect, it } from 'vitest';

import { POLICIES, assertPublishable, findPlaceholders, renderPolicy, type PolicyKey } from './policy.js';

/** `docs/` is two levels above `apps/web`. Same computation the page route makes. */
const repoRoot = new URL('../../../../', import.meta.url);

const keys = Object.keys(POLICIES) as PolicyKey[];

describe('findPlaceholders', () => {
  it('finds a guillemet token', () => {
    expect(findPlaceholders('effective «DATE-PENDING-E20-12» ok')).toEqual(['«DATE-PENDING-E20-12»']);
  });

  it('deduplicates and sorts, so the count is a count of distinct unknowns', () => {
    expect(findPlaceholders('«B» then «A» then «B»')).toEqual(['«A»', '«B»']);
  });

  it('finds nothing in a finished document', () => {
    expect(findPlaceholders('Effective 1 April 2026. Contact grievance@graybag.com.')).toEqual([]);
  });

  it('matches on the delimiters, not on the word PENDING', () => {
    // A token written without "PENDING" is still a token, and still must not be published.
    expect(findPlaceholders('«GRIEVANCE-OFFICER-NAME»')).toEqual(['«GRIEVANCE-OFFICER-NAME»']);
  });
});

describe('renderPolicy', () => {
  it.each(keys)('renders %s to HTML', (key) => {
    const policy = renderPolicy(key, repoRoot);
    expect(policy.html).toContain('<h1');
    expect(policy.html.length).toBeGreaterThan(1000);
  });

  it.each(keys)('strips the YAML frontmatter from %s', (key) => {
    const policy = renderPolicy(key, repoRoot);
    // `sources:` and `covers:` are frontmatter keys; leaking them would publish internal notes.
    expect(policy.html).not.toContain('covers: E20');
    expect(policy.html).not.toMatch(/<p>status: DRAFT/);
  });

  it.each(keys)('rewrites %s cross-references to web paths, never .md', (key) => {
    const policy = renderPolicy(key, repoRoot);
    // A markdown path that reaches the website is a 404 on a legal document — the build's
    // link check found exactly three of these.
    expect(policy.html).not.toMatch(/href="[^"]*\.md"/);
  });

  it('rewrites the Terms link to the refund policy specifically', () => {
    // PP1: refund detail lives only in the refund policy and Terms §6 links to it. If that link
    // breaks, the Terms make a promise the reader cannot follow.
    expect(renderPolicy('terms', repoRoot).html).toContain('href="/refunds"');
  });

  /**
   * **Which documents are still drafts — the deliberate change this test asked for.**
   *
   * This used to assert that *all three* carry placeholders, with the note: "if this ever
   * returns zero, the documents have been finalised and the pre-launch notice should come off —
   * which is a deliberate change, not a silent one." That is what has now happened, and this is
   * the deliberate change.
   *
   * `E20-45`/`C17` landed the lawyer's text verbatim for the **privacy policy** and the **refund
   * policy**, so those two carry no unresolved tokens. The **terms** still carry nine and are
   * still a draft.
   *
   * Held as data rather than a blanket rule so the tripwire survives: when the terms are
   * finalised this list is wrong, the test below fails, and somebody has to come here and take
   * the pre-launch notice off on purpose. A `toBeGreaterThanOrEqual(0)` would have made it green
   * forever and told nobody.
   */
  const STILL_DRAFT: Record<string, boolean> = { privacy: false, terms: true, refunds: false };

  it.each(keys)('%s carries placeholders only while it is still a draft', (key) => {
    const count = renderPolicy(key, repoRoot).placeholders.length;
    if (STILL_DRAFT[key]) expect(count).toBeGreaterThan(0);
    else expect(count).toBe(0);
  });

  it('still has at least one draft, so the pre-launch notice is still warranted', () => {
    // The moment this fails, every policy document is finished and the notice must come off.
    expect(Object.values(STILL_DRAFT).some(Boolean)).toBe(true);
  });
});

describe('assertPublishable', () => {
  const withPlaceholders = {
    html: '',
    title: 'Privacy policy',
    description: '',
    path: '/privacy',
    placeholders: ['«GRIEVANCE-OFFICER-NAME-PENDING-E20-21»'],
  };

  it('refuses a production build that still contains a placeholder', () => {
    expect(() => assertPublishable(withPlaceholders, true)).toThrow(/unresolved placeholder/);
  });

  it('names the offending tokens in the failure, so the fix is obvious', () => {
    expect(() => assertPublishable(withPlaceholders, true)).toThrow(/GRIEVANCE-OFFICER-NAME/);
  });

  it('allows a non-production build, so the pages can be reviewed before E20-01 returns', () => {
    expect(() => assertPublishable(withPlaceholders, false)).not.toThrow();
  });

  it('allows a production build of a finished document', () => {
    expect(() => assertPublishable({ ...withPlaceholders, placeholders: [] }, true)).not.toThrow();
  });

  it.each(keys)('gates the real %s on whether it is finished, not on a guess', (key) => {
    // The point of the gate, asserted against the real files rather than a fixture. This used to
    // say "all three would fail a production build"; two of them now pass it, because `E20-45`
    // landed the lawyer's text for the privacy and refund policies.
    //
    // Derived from the document itself rather than from a second hand-maintained list: the rule
    // is "unresolved tokens are what blocks publication", and restating which files those are
    // gives two lists to keep in step, one of which will be wrong.
    const rendered = renderPolicy(key, repoRoot);
    if (rendered.placeholders.length > 0) {
      expect(() => assertPublishable(rendered, true)).toThrow(/E20-22/);
    } else {
      expect(() => assertPublishable(rendered, true)).not.toThrow();
    }
  });

  it('still blocks a production build of the site as a whole', () => {
    // What actually matters for the DNS cutover (`E12-10`, `[WEB-05]`): the *site* cannot go live
    // while any one document is unfinished. Asserted as a property of the set, so finishing two
    // of three cannot be mistaken for clearing the gate.
    const blocked = keys.filter((key) => renderPolicy(key, repoRoot).placeholders.length > 0);
    expect(blocked.length).toBeGreaterThan(0);
  });
});
