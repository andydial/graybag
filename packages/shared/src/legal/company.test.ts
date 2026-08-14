import { describe, expect, it } from 'vitest';

import { COMPANY, GRIEVANCE_OFFICER, RESOLVED, resolveTokens, unresolvedTokens } from './company.js';

describe('one source for the company identity', () => {
  it('resolves the same fact to the same value in both documents', () => {
    // The whole point of `E12-25`. `terms.md` and `gst-invoicing.md` use different token names
    // for the same three facts, and an invoice whose GSTIN disagrees with the terms is worse
    // than either being blank.
    expect(RESOLVED['«GRAYBAG-LEGAL-ENTITY-NAME-PENDING-E20-01»'])
      .toBe(RESOLVED['«LEGAL-NAME-PENDING-E00-10»']);
    expect(RESOLVED['«GRAYBAG-GSTIN-PENDING-E00-10»'])
      .toBe(RESOLVED['«GSTIN-PENDING-E00-10»']);
    expect(RESOLVED['«GRAYBAG-REGISTERED-ADDRESS-PENDING-E20-01»'])
      .toBe(RESOLVED['«ADDRESS-PENDING-E00-10»']);
  });

  it('leaves an unanswered token exactly as it is', () => {
    // Never an empty string. A blank where a GSTIN belongs reads as a formatting bug; the token
    // reads as an unanswered question, and `assertPublishable` refuses to publish it.
    const before = 'GSTIN «GRAYBAG-GSTIN-PENDING-E00-10» filed at «GRAYBAG-REGISTERED-ADDRESS-PENDING-E20-01».';
    expect(resolveTokens(before)).toBe(before);
  });

  it('substitutes an answered one', () => {
    expect(resolveTokens('Write to «GRAYBAG-SUPPORT-EMAIL-PENDING-E20-01».'))
      .toBe('Write to info@graybag.com.');
  });

  it('passes an unknown token through untouched', () => {
    // Not `undefined`, which is what a regex-and-lookup implementation does when it misses.
    expect(resolveTokens('«SOMETHING-ELSE-PENDING-E99-99»')).toBe('«SOMETHING-ELSE-PENDING-E99-99»');
  });

  it('names the grievance officer the published privacy policy names', () => {
    // Copied, not decided again. An internal record that disagrees with the published notice is
    // the document we would be judged against.
    expect(GRIEVANCE_OFFICER.email).toBe('vivek@graybag.com');
    expect(GRIEVANCE_OFFICER.name).toBe('Vivek');
  });

  it('has no support address that a reply would bounce off', () => {
    // `U4`: no `no-reply@` anywhere in the product.
    expect(COMPANY.supportEmail).not.toMatch(/no-?reply/i);
  });

  it('still knows what it does not know', () => {
    // If this list empties, every published document is answerable — and if something is quietly
    // defaulted to `''` one day, this test is what notices.
    expect(unresolvedTokens()).toContain('«GRAYBAG-GSTIN-PENDING-E00-10»');
    expect(unresolvedTokens()).toContain('«GRAYBAG-REGISTERED-ADDRESS-PENDING-E20-01»');
  });
});
