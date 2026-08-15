import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The enquiry notification's guarantees, asserted against its source — `E12-16`.
 *
 * Asserted as text rather than by running it, for the reason `cors.test.ts` gives: these are
 * Deno modules and this suite is Node. What is being protected here is not a return value, it is
 * a set of promises about *ordering and failure* that a reader can only check by reading — so
 * they get a test that reads.
 *
 * Every one of these was a real decision with a stated reason, and each would be silently
 * reversible by a plausible edit.
 */
const FUNCTIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/functions');
const notice = readFileSync(join(FUNCTIONS, '_shared/enquiry-notice.ts'), 'utf8');
const submit = readFileSync(join(FUNCTIONS, 'enquiry-submit/index.ts'), 'utf8');

describe('the notification never costs us the enquiry', () => {
  it('is sent AFTER the row is inserted', () => {
    // The contract's rule: "an enquiry lost because a mail provider had a bad minute is the worst
    // outcome this endpoint can produce." Sending first would put the mail provider on the path
    // to storing a lead.
    const insert = submit.indexOf(".from('enquiry')");
    const send = submit.indexOf('sendEnquiryNotice(');
    expect(insert).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(insert);
  });

  it('discards the send result rather than branching on it', () => {
    // A `if (!sent) return json(500…)` would turn a stored enquiry into an error the visitor
    // sees, and they would try again — or not.
    const call = submit.slice(submit.indexOf('sendEnquiryNotice('));
    expect(call.slice(0, 40)).not.toMatch(/=\s*await|if\s*\(/);
  });

  it('catches everything, so a network failure cannot escape', () => {
    expect(notice).toMatch(/try\s*\{/);
    expect(notice).toMatch(/catch\s*\(cause\)/);
  });

  it('says the enquiry is stored in every failure path it logs', () => {
    // The one thing the person reading the log at 9am needs to know is whether they lost a lead.
    const logs = notice.match(/console\.(warn|error)\([\s\S]*?\);/g) ?? [];
    expect(logs.length).toBeGreaterThanOrEqual(3);
    for (const log of logs) {
      expect(log, `a failure log that does not say the row survived:\n${log}`).toMatch(/IS stored/);
    }
  });
});

describe('who it reaches', () => {
  it('falls back to SUPPORT_ALERT_EMAIL, which production actually has set', () => {
    // The regression this exists for: the first deploy chained only ENQUIRY_EMAIL_TO and
    // ORDER_EMAIL_REPLY_TO, neither of which existed on prod. A real enquiry was stored and
    // silently not announced — a notification path whose only recipient variable is one nobody
    // has set does nothing, and fails in the way that is hardest to notice.
    expect(notice).toContain('ENQUIRY_EMAIL_TO');
    expect(notice).toContain('SUPPORT_ALERT_EMAIL');
  });

  it('prefers the specific variable over the general one', () => {
    // Scoped to the `const to =` expression, not the whole file. The first version compared
    // whole-file offsets and failed on the doc comment above the chain, which explains the
    // fallback and therefore names SUPPORT_ALERT_EMAIL first. The test was wrong, not the code —
    // and a source-reading test that matches prose instead of code is worth catching here rather
    // than trusting later.
    const chain = notice.slice(notice.indexOf('const to ='), notice.indexOf("if (!apiKey"));
    expect(chain).toContain('ENQUIRY_EMAIL_TO');
    expect(chain.indexOf('ENQUIRY_EMAIL_TO')).toBeLessThan(chain.indexOf('SUPPORT_ALERT_EMAIL'));
  });

  it('replies to the enquirer, not to the sending domain', () => {
    // `from` is on a subdomain with no inbox. Replying to the notification has to write to the
    // person who asked — that is the only thing anybody wants to do with it.
    expect(notice).toMatch(/reply_to:\s*e\.email/);
  });
});

describe('what it deliberately does not carry', () => {
  it.each(['phone', 'message'])('keeps %s out of the email body', (field) => {
    // They are on the row, which has RLS. An email is forwarded, quoted, and left in inboxes.
    const render = notice.slice(notice.indexOf('export function renderEnquiryText'), notice.indexOf('export async function'));
    expect(render).not.toContain(`e.${field}`);
  });

  it('does not accept them into the notice at all, so they cannot be added by accident', () => {
    // Stronger than keeping them out of the template: they are not on the interface, so the
    // compiler refuses. A comment asking somebody not to include a phone number is not a control.
    const iface = notice.slice(notice.indexOf('export interface EnquiryNotice'), notice.indexOf('const ROLE_WORDS'));
    expect(iface).not.toContain('phone');
    expect(iface).not.toContain('message');
  });

  it('carries enough to triage without opening anything', () => {
    // School and city in the subject: this arrives on a phone.
    expect(notice).toMatch(/subject:.*e\.school.*e\.city/);
  });
});
