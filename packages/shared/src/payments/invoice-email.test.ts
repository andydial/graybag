import { describe, expect, it } from 'vitest';

import {
  amountInWords,
  renderInvoiceHtml,
  renderInvoiceText,
  unresolvedTokens,
  type InvoiceEmailInput,
} from '../../../../supabase/functions/_shared/invoice-email.js';

/**
 * `E07-04`. The invoice **is** the email body — `E07-18`'s stored PDF is fast-follow, and Rule 46
 * prescribes particulars, not a file format.
 *
 * So these tests do the job the PDF review would have done: prove every statutory particular
 * appears, and prove the ones that are legitimately absent are absent for the stated reason
 * rather than by omission.
 */
const INVOICE: InvoiceEmailInput = {
  invoiceNumber: 'GB/26-27/000001',
  issuedAt: '2026-08-14T00:31:32Z',
  sellerLegalName: 'GrayBag Foods Private Limited',
  sellerAddress: 'Sector 82, SAS Nagar, Punjab 160055',
  sellerGstin: '03ABCDE1234F1Z5',
  sacCode: '996331',
  placeOfSupplyStateCode: '03',
  buyerName: 'Andy Dial',
  buyerGstin: null,
  taxableValuePaise: 13_900,
  cgstRateBps: 250,
  cgstPaise: 348,
  sgstRateBps: 250,
  sgstPaise: 348,
  roundOffPaise: 0,
  totalPaise: 14_596,
  pickupCodes: ['1389'],
  orderRefs: ['GB-FC17KH'],
  lines: [
    {
      description: 'Wheat Jaggery Cake for Aarav · Mon 17 Aug · Morning break',
      sacCode: '996331',
      quantity: 2,
      taxableValuePaise: 13_900,
      cgstPaise: 348,
      sgstPaise: 348,
      totalPaise: 14_596,
    },
  ],
};

describe('Rule 46 particulars, in both renderings', () => {
  const bodies = () => [renderInvoiceText(INVOICE), renderInvoiceHtml(INVOICE)];

  it.each([
    ['(a) supplier name', 'GrayBag Foods Private Limited'],
    ['(a) supplier address', 'Sector 82, SAS Nagar'],
    ['(a) supplier GSTIN', '03ABCDE1234F1Z5'],
    ['(b) invoice number', 'GB/26-27/000001'],
    ['(c) date of issue', '14 Aug 2026'],
    ['(e) recipient name', 'Andy Dial'],
    ['(f) SAC', '996331'],
    ['(g) description', 'Wheat Jaggery Cake'],
    ['(m) place of supply, named', 'Punjab'],
    ['(o) reverse charge, stated', 'reverse charge: No'],
  ])('%s appears', (_label, needle) => {
    for (const body of bodies()) expect(body).toContain(needle);
  });

  it('(k)(l) states each tax component separately, never a single 5% line', () => {
    // `M2`. A combined "GST 5%" line is not compliant and is the shortcut somebody will suggest.
    for (const body of bodies()) {
      expect(body).toContain('CGST');
      expect(body).toContain('SGST');
      expect(body).toMatch(/2\.5%/);
      expect(body).not.toMatch(/\b5%\s*(GST|tax)/i);
    }
  });

  it('(h)(i)(j) carries quantity, taxable value and total', () => {
    for (const body of bodies()) {
      expect(body).toContain('2'); // quantity
      expect(body).toContain('₹139.00'); // taxable value
      expect(body).toContain('₹145.96'); // total
    }
  });

  it('states the amount in words, as an Indian invoice is expected to', () => {
    for (const body of bodies()) {
      expect(body).toContain('One Hundred Forty Five Rupees and Ninety Six Paise Only');
    }
  });

  it('(d) prints the recipient GSTIN only when there is one', () => {
    for (const body of bodies()) expect(body).not.toContain('Recipient GSTIN');
    const b2b = { ...INVOICE, buyerGstin: '03ZZZZZ9999Z1Z9' };
    expect(renderInvoiceText(b2b)).toContain('03ZZZZZ9999Z1Z9');
    expect(renderInvoiceHtml(b2b)).toContain('03ZZZZZ9999Z1Z9');
  });

  it('(e) says the buyer name is not required rather than inventing one', () => {
    // `E07-22`, Rule 46(f): below ₹50,000 the name is optional. Omission is lawful; a
    // fabricated name in a statutory record is not.
    const anonymous = { ...INVOICE, buyerName: null };
    for (const body of [renderInvoiceText(anonymous), renderInvoiceHtml(anonymous)]) {
      expect(body).toMatch(/not required below ₹50,000|Not recorded/);
      expect(body).not.toContain('Andy Dial');
      expect(body).not.toContain('GrayBag customer');
    }
  });

  it('carries the pickup code, which is what the email is actually opened for', () => {
    for (const body of bodies()) expect(body).toContain('1389');
  });

  it('carries the order reference support resolves against', () => {
    for (const body of bodies()) expect(body).toContain('GB-FC17KH');
  });

  it('renders a placeholder seller identity literally, so it cannot be mistaken for real', () => {
    // §2. Unmissable on purpose — and `unresolvedTokens` below is what stops it being SENT.
    const staging = { ...INVOICE, sellerGstin: '«GRAYBAG-GSTIN-PENDING-E00-10»' };
    expect(renderInvoiceText(staging)).toContain('«GRAYBAG-GSTIN-PENDING-E00-10»');
    expect(renderInvoiceHtml(staging)).toContain('PENDING-E00-10');
  });
});

/**
 * `E07-24`. **The assertion is on the rendered output, not on the configuration.**
 *
 * `GB/26-27/000002` was delivered to a real inbox stating the supplier as
 * `«GRAYBAG-LEGAL-ENTITY-NAME-PENDING-E20-01»`. `assert_seller_identity_configured()` did not stop
 * it, because it guards production only — and a staging exemption is why a human found this by
 * reading his own email instead of a test finding it.
 *
 * A config check asks whether the fields we thought to name are filled. This asks whether the
 * document a parent actually receives says something we do not know, which is the question that
 * matters and the only one that catches a field nobody remembered to guard.
 */
describe('unresolvedTokens — the guard that was missing', () => {
  it('finds the exact tokens that reached a real inbox', () => {
    const broken = {
      ...INVOICE,
      sellerLegalName: '«GRAYBAG-LEGAL-ENTITY-NAME-PENDING-E20-01»',
      sellerAddress: '«GRAYBAG-REGISTERED-ADDRESS-PENDING-E20-01»',
      sellerGstin: '«GRAYBAG-GSTIN-PENDING-E00-10»',
    };
    const found = unresolvedTokens(renderInvoiceText(broken));
    expect(found).toHaveLength(3);
    expect(found).toContain('«GRAYBAG-GSTIN-PENDING-E00-10»');
  });

  it('catches a token in ANY field, not just the three that were wrong', () => {
    // The config guard names fields; this one does not need to know which field is unfinished.
    expect(unresolvedTokens(renderInvoiceText({ ...INVOICE, sacCode: '«SAC-PENDING-E00-10»' })))
      .toContain('«SAC-PENDING-E00-10»');
  });

  it('finds them in the HTML rendering too, since that is what most parents see', () => {
    const broken = { ...INVOICE, sellerGstin: '«GRAYBAG-GSTIN-PENDING-E00-10»' };
    expect(unresolvedTokens(renderInvoiceHtml(broken))).toHaveLength(1);
  });

  it('passes a fully resolved invoice', () => {
    // The published facts, from `docs/legal/company.json` — the one source the renderer now reads
    // through `platform_config`.
    const real = {
      ...INVOICE,
      sellerLegalName: 'GRAYBAG SOLUTIONS PRIVATE LIMITED',
      sellerAddress: 'SCO-461-462, Top Floor, Sector 35-C, Chandigarh, 160022',
      sellerGstin: '03AAMCG3438M1ZD',
    };
    expect(unresolvedTokens(renderInvoiceText(real))).toEqual([]);
    expect(unresolvedTokens(renderInvoiceHtml(real))).toEqual([]);
  });

  it('does not mistake ordinary punctuation for a token', () => {
    // « » are the register's convention. A dish called "Chef«s special" would be odd, but a
    // guard that fires on stray punctuation gets turned off.
    expect(unresolvedTokens('Total ₹145.96 — CGST 2.5% · SGST 2.5%')).toEqual([]);
  });
});

describe('readable on a phone', () => {
  it('uses no table for the lines, so nothing scrolls sideways', () => {
    // The instinct is a column per tax component. On a 360px screen that is a horizontal scroll
    // a parent will not perform, and the total ends up off-screen.
    const html = renderInvoiceHtml(INVOICE);
    expect(html).not.toMatch(/<table|<tr|<td/i);
  });

  it('constrains the width and stays one column', () => {
    expect(renderInvoiceHtml(INVOICE)).toContain('max-width:480px');
  });

  it('puts the pickup code and total before the statutory apparatus', () => {
    const html = renderInvoiceHtml(INVOICE);
    expect(html.indexOf('1389')).toBeLessThan(html.indexOf('Tax invoice'));
    expect(html.indexOf('Paid')).toBeLessThan(html.indexOf('Supplier GSTIN'));
  });

  it('inlines every style, because a <style> block is stripped somewhere', () => {
    expect(renderInvoiceHtml(INVOICE)).not.toMatch(/<style/i);
  });

  it('escapes the values, so a dish name cannot break the layout', () => {
    const nasty = {
      ...INVOICE,
      lines: [{ ...INVOICE.lines[0]!, description: 'Cake <b>& "chips"</b>' }],
    };
    const html = renderInvoiceHtml(nasty);
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>&');
  });
});

describe('amountInWords', () => {
  it.each([
    [14_596, 'One Hundred Forty Five Rupees and Ninety Six Paise Only'],
    [10_000, 'One Hundred Rupees Only'],
    [100, 'One Rupees Only'],
    [0, 'Zero Rupees Only'],
    // Lakh, not "one hundred thousand" — an Indian reader checks the figure against the digits.
    [10_000_000, 'One Lakh Rupees Only'],
    [1_000_000_000, 'One Crore Rupees Only'],
  ])('%d paise → %s', (paise, words) => {
    expect(amountInWords(paise)).toBe(words);
  });
});
