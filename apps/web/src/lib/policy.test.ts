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

  it('reports the placeholders each document still carries', () => {
    // These are drafts (E20-01). If this ever returns zero, the documents have been finalised
    // and the pre-launch notice should come off — which is a deliberate change, not a silent one.
    for (const key of keys) {
      expect(renderPolicy(key, repoRoot).placeholders.length).toBeGreaterThan(0);
    }
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

  it('is what actually stops the real documents reaching production today', () => {
    // The point of the gate, asserted against the real files rather than a fixture: as things
    // stand, all three would fail a production build. That is correct and must stay true until
    // a lawyer has been through them.
    for (const key of keys) {
      expect(() => assertPublishable(renderPolicy(key, repoRoot), true)).toThrow(/E20-22/);
    }
  });
});
