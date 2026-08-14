/**
 * The tax invoice, as the email itself. `E07-04`.
 *
 * **The invoice is the body, not an attachment.** `E07-18` — render a PDF once and store it — is
 * fast-follow and not in v1, and a GST invoice may be issued electronically: Rule 46 prescribes
 * the *particulars*, not the file format. Blocking the one MVP requirement (a parent receives
 * their invoice) on a rendering pipeline nobody put in v1 is the wrong trade. Confirmed by Andy,
 * 2026-08-14.
 *
 * # Readable on a phone, which rules out the obvious layout
 *
 * The instinct is a table with a column per tax component. On a 360px screen that is a horizontal
 * scroll a parent will not perform, and the numbers they came for — total, pickup code — end up
 * off-screen. So:
 *
 *   * **the pickup code and total come first**, before any statutory apparatus, because that is
 *     what the email is opened for;
 *   * **each line is a stacked block**, not a row: description, then quantity and amounts beneath
 *     it. Nothing needs to be scrolled sideways;
 *   * the Rule 46 particulars follow, in a labelled list rather than a grid;
 *   * `max-width: 480px` and a single column, so it reflows rather than zooms.
 *
 * # Every Rule 46 particular is present, and the absent ones are absent on purpose
 *
 * `docs/gst-invoicing.md` §4.1 is the mapping. (d) the recipient's GSTIN prints only when
 * non-null; (e) the buyer's name may be legitimately absent below ₹50,000 (`E07-22`, Rule 46(f))
 * and is **never** fabricated; (n) delivery address is not applicable — the food is delivered
 * where the service is performed; (o) reverse charge prints as a literal `No` rather than being
 * omitted, because a missing field and a "no" are different claims.
 *
 * # Placeholders render literally, and that is the design
 *
 * Outside production the seller identity is `«GRAYBAG-GSTIN-PENDING-E00-10»` and it appears in
 * the email exactly like that (§2). It is meant to be unmissable: a staging invoice must never be
 * mistakable for a real one, and `assert_seller_identity_configured()` is what stops it reaching
 * production.
 */

export interface InvoiceEmailInput {
  invoiceNumber: string;
  issuedAt: string;
  sellerLegalName: string;
  sellerAddress: string;
  sellerGstin: string;
  sacCode: string;
  placeOfSupplyStateCode: string;
  buyerName: string | null;
  buyerGstin: string | null;
  taxableValuePaise: number;
  cgstRateBps: number;
  cgstPaise: number;
  sgstRateBps: number;
  sgstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  pickupCodes: string[];
  orderRefs: string[];
  lines: {
    description: string;
    sacCode: string;
    quantity: number;
    taxableValuePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    totalPaise: number;
  }[];
}

/** Indian state codes we can name. 03 is Punjab; Mohali is in it (`SC1`). */
const STATE_NAMES: Record<string, string> = {
  '03': 'Punjab',
  '06': 'Haryana',
  '04': 'Chandigarh',
};

const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
const percent = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

/** `13 Apr 2026`, in the platform timezone. Never a bare ISO string on a customer document. */
function issuedOn(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const ist = new Date(at.getTime() + 330 * 60_000);
  const month =
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
      ist.getUTCMonth()
    ] ?? '';
  return `${ist.getUTCDate()} ${month} ${ist.getUTCFullYear()}`;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen',
  'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** Under 100, spelled. */
function twoDigits(n: number): string {
  // `noUncheckedIndexedAccess` is on, so every lookup is `string | undefined`. Defaulted rather
  // than asserted: an out-of-range index should render nothing, not crash an invoice email.
  if (n < 20) return ONES[n] ?? '';
  const t = TENS[Math.floor(n / 10)] ?? '';
  const o = ONES[n % 10] ?? '';
  return o ? `${t} ${o}` : t;
}

/**
 * `₹1,459.60` → `One Thousand Four Hundred Fifty Nine Rupees and Sixty Paise Only`.
 *
 * A universal expectation on an Indian invoice (§4.2), and **lakh/crore grouping**, not
 * thousands — an Indian reader checking the figure against the digits expects the Indian system.
 */
export function amountInWords(paise: number): string {
  const rupeesPart = Math.floor(Math.abs(paise) / 100);
  const paisePart = Math.abs(paise) % 100;

  const spell = (n: number): string => {
    if (n === 0) return 'Zero';
    const parts: string[] = [];
    const crore = Math.floor(n / 10_000_000);
    const lakh = Math.floor((n % 10_000_000) / 100_000);
    const thousand = Math.floor((n % 100_000) / 1_000);
    const hundred = Math.floor((n % 1_000) / 100);
    const rest = n % 100;
    if (crore) parts.push(`${twoDigits(crore)} Crore`);
    if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
    if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
    if (hundred) parts.push(`${ONES[hundred] ?? ''} Hundred`);
    if (rest) parts.push(twoDigits(rest));
    return parts.join(' ');
  };

  const head = `${spell(rupeesPart)} Rupees`;
  return paisePart > 0 ? `${head} and ${twoDigits(paisePart)} Paise Only` : `${head} Only`;
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The plain-text alternative. Every client renders it, and some parents prefer it. */
export function renderInvoiceText(v: InvoiceEmailInput): string {
  const state = STATE_NAMES[v.placeOfSupplyStateCode] ?? 'Punjab';
  const out: string[] = [];

  out.push('YOUR ORDER IS CONFIRMED');
  out.push('');
  if (v.pickupCodes.length > 0) {
    out.push(`Pickup code${v.pickupCodes.length > 1 ? 's' : ''}: ${v.pickupCodes.join(', ')}`);
  }
  out.push(`Paid: ${rupees(v.totalPaise)}`);
  out.push('');
  out.push('--- TAX INVOICE ---');
  out.push(`Invoice number: ${v.invoiceNumber}`);
  out.push(`Date of issue:  ${issuedOn(v.issuedAt)}`);
  out.push('');
  out.push(`Supplier: ${v.sellerLegalName}`);
  out.push(`          ${v.sellerAddress}`);
  out.push(`GSTIN:    ${v.sellerGstin}`);
  out.push('');
  out.push(`Recipient: ${v.buyerName ?? 'Not recorded (not required below ₹50,000)'}`);
  if (v.buyerGstin) out.push(`Recipient GSTIN: ${v.buyerGstin}`);
  out.push(`Place of supply: ${state} (${v.placeOfSupplyStateCode})`);
  out.push(`SAC: ${v.sacCode}`);
  out.push('');
  for (const line of v.lines) {
    out.push(`${line.description}`);
    out.push(`  Qty ${line.quantity} · SAC ${line.sacCode} · taxable ${rupees(line.taxableValuePaise)}`);
    out.push(`  CGST ${rupees(line.cgstPaise)} · SGST ${rupees(line.sgstPaise)} · ${rupees(line.totalPaise)}`);
  }
  out.push('');
  out.push(`Taxable value:        ${rupees(v.taxableValuePaise)}`);
  out.push(`CGST ${percent(v.cgstRateBps).padEnd(6)}          ${rupees(v.cgstPaise)}`);
  out.push(`SGST ${percent(v.sgstRateBps).padEnd(6)}          ${rupees(v.sgstPaise)}`);
  if (v.roundOffPaise !== 0) out.push(`Rounding:             ${rupees(v.roundOffPaise)}`);
  out.push(`TOTAL:                ${rupees(v.totalPaise)}`);
  out.push('');
  out.push(amountInWords(v.totalPaise));
  out.push('');
  out.push('Tax payable on reverse charge: No');
  if (v.orderRefs.length > 0) out.push(`Order reference: ${v.orderRefs.join(', ')}`);
  out.push('');
  out.push('GrayBag');
  return out.join('\n');
}

/**
 * The HTML body. One column, `max-width: 480px`, no table for the lines.
 *
 * Inline styles only: every email client strips `<style>` blocks somewhere, and a stylesheet that
 * survives Gmail does not survive Outlook.
 */
export function renderInvoiceHtml(v: InvoiceEmailInput): string {
  const state = STATE_NAMES[v.placeOfSupplyStateCode] ?? 'Punjab';
  const wrap = 'max-width:480px;margin:0 auto;padding:20px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;font-size:15px;line-height:1.5';
  const muted = 'color:#5c5c5c;font-size:13px';
  const rule = 'border:0;border-top:1px solid #e5e5e5;margin:20px 0';

  const row = (label: string, value: string, strong = false) =>
    `<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0${strong ? ';font-weight:600;font-size:17px' : ''}">` +
    `<span style="${strong ? '' : muted}">${escape(label)}</span>` +
    `<span style="text-align:right">${escape(value)}</span></div>`;

  const field = (label: string, value: string) =>
    `<div style="padding:5px 0"><div style="${muted}">${escape(label)}</div>` +
    `<div>${escape(value)}</div></div>`;

  // Stacked, never a table: a per-component column set scrolls sideways on a phone.
  const lines = v.lines
    .map(
      (l) =>
        `<div style="padding:10px 0;border-bottom:1px solid #f0f0f0">` +
        `<div style="font-weight:600">${escape(l.description)}</div>` +
        `<div style="${muted}">Qty ${l.quantity} · SAC ${escape(l.sacCode)}</div>` +
        `<div style="${muted}">Taxable ${rupees(l.taxableValuePaise)} · CGST ${rupees(l.cgstPaise)} · SGST ${rupees(l.sgstPaise)}</div>` +
        `<div style="text-align:right;font-weight:600">${rupees(l.totalPaise)}</div>` +
        `</div>`,
    )
    .join('');

  const codes =
    v.pickupCodes.length > 0
      ? `<div style="background:#e8f6ee;border-radius:10px;padding:16px;text-align:center;margin:0 0 16px">` +
        `<div style="${muted}">Pickup code${v.pickupCodes.length > 1 ? 's' : ''}</div>` +
        `<div style="font-size:30px;font-weight:700;letter-spacing:3px">${escape(v.pickupCodes.join('  '))}</div>` +
        `</div>`
      : '';

  return `<div style="${wrap}">
<h1 style="font-size:20px;margin:0 0 16px">Your order is confirmed</h1>
${codes}
${row('Paid', rupees(v.totalPaise), true)}
<hr style="${rule}">
<h2 style="font-size:15px;margin:0 0 10px;text-transform:uppercase;letter-spacing:.5px">Tax invoice</h2>
${field('Invoice number', v.invoiceNumber)}
${field('Date of issue', issuedOn(v.issuedAt))}
<hr style="${rule}">
${field('Supplier', `${v.sellerLegalName}, ${v.sellerAddress}`)}
${field('Supplier GSTIN', v.sellerGstin)}
${field('Recipient', v.buyerName ?? 'Not recorded — not required below ₹50,000')}
${v.buyerGstin ? field('Recipient GSTIN', v.buyerGstin) : ''}
${field('Place of supply', `${state} (${v.placeOfSupplyStateCode})`)}
${field('SAC', v.sacCode)}
<hr style="${rule}">
${lines}
<div style="padding-top:14px">
${row('Taxable value', rupees(v.taxableValuePaise))}
${row(`CGST ${percent(v.cgstRateBps)}`, rupees(v.cgstPaise))}
${row(`SGST ${percent(v.sgstRateBps)}`, rupees(v.sgstPaise))}
${v.roundOffPaise !== 0 ? row('Rounding', rupees(v.roundOffPaise)) : ''}
${row('Total', rupees(v.totalPaise), true)}
</div>
<div style="${muted};padding-top:10px">${escape(amountInWords(v.totalPaise))}</div>
<hr style="${rule}">
<div style="${muted}">Tax payable on reverse charge: No</div>
${v.orderRefs.length > 0 ? `<div style="${muted}">Order reference: ${escape(v.orderRefs.join(', '))}</div>` : ''}
<div style="${muted};padding-top:16px">GrayBag</div>
</div>`;
}
