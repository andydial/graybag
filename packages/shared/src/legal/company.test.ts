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
    // Never an empty string. A blank where a value belongs reads as a formatting bug; the token
    // reads as an unanswered question, and `assertPublishable` refuses to publish it.
    //
    // Written against whatever is *currently* unanswered rather than a hardcoded token — an
    // earlier version pinned the GSTIN and broke the day Andy supplied it, which tested the data
    // rather than the behaviour.
    const [stillOpen] = unresolvedTokens();
    expect(stillOpen, 'nothing is unanswered — see the note below').toBeDefined();
    expect(resolveTokens(`before ${stillOpen} after`)).toBe(`before ${stillOpen} after`);
  });

  it('substitutes an answered one', () => {
    // Was `info@graybag.com` until `E20-51` routed every support and grievance action to
    // `support@graybag.com` and privacy notice version 3 published the same. Asserted against
    // `COMPANY` rather than a literal, so the next change to that one source moves this with it
    // instead of breaking it — the same lesson as the unanswered-token test above.
    expect(resolveTokens('Write to «GRAYBAG-SUPPORT-EMAIL-PENDING-E20-01».'))
      .toBe(`Write to ${COMPANY.supportEmail}.`);
    expect(COMPANY.supportEmail).toBe('support@graybag.com');
  });

  it('passes an unknown token through untouched', () => {
    // Not `undefined`, which is what a regex-and-lookup implementation does when it misses.
    expect(resolveTokens('«SOMETHING-ELSE-PENDING-E99-99»')).toBe('«SOMETHING-ELSE-PENDING-E99-99»');
  });

  it('names the grievance OFFICE, as the published privacy policy does', () => {
    // Copied, not decided again. An internal record that disagrees with the published notice is
    // the document we would be judged against.
    //
    // Privacy notice **version 3** (`E20-53`) replaced the named individual with the office.
    // `name` being null is the assertion that matters: `company.json`'s own comment warns that
    // leaving a name here would be a second source of truth that reintroduces it the first time
    // anybody wires the grievance block from this file — which is exactly what the website footer
    // did, and had to be undone.
    //
    // Whether DPDP requires a natural person is open (`E20-52`). If it does, a name comes back
    // here and in notice version 4, and this test changes with it.
    expect(GRIEVANCE_OFFICER.name).toBeNull();
    expect(GRIEVANCE_OFFICER.title).toMatch(/^Grievance Officer/);
    expect(GRIEVANCE_OFFICER.email).toBe('support@graybag.com');
  });

  it('has no support address that a reply would bounce off', () => {
    // `U4`: no `no-reply@` anywhere in the product.
    expect(COMPANY.supportEmail).not.toMatch(/no-?reply/i);
  });

  it('never answers a question with an empty string', () => {
    // The failure this guards against is a value being "filled in" as `''` — which resolves the
    // token, passes the build, and publishes a blank where a GSTIN belongs. Unknown must stay
    // `null`, which stays a token, which fails the build.
    for (const [token, value] of Object.entries(RESOLVED)) {
      expect(value, `${token} is an empty string — use null for unknown`).not.toBe('');
    }
  });

  it('has answered the entity facts Andy supplied on 2026-08-14', () => {
    // These three are what `E12-25` was about: one answer, two documents.
    expect(COMPANY.legalName).toBe('GRAYBAG SOLUTIONS PRIVATE LIMITED');
    expect(COMPANY.gstin).toBe('03AAMCG3438M1ZD');
    expect(COMPANY.registeredAddress).toContain('Chandigarh');
  });
});
