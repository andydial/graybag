/**
 * The GST split, as the cart and checkout must display it — `M2`, `SC2`, `docs/gst-invoicing.md` §6.
 *
 * Mohali only, so the place of supply is always intra-state and the tax is always **CGST 2.5% +
 * SGST 2.5%** (`AR-scope`, non-negotiable #7). There is no IGST path here and there must not be
 * one until there is a second state.
 *
 * ## Why this is not `subtotal × 5%`
 *
 * §6.2 is explicit: **each component is computed independently from each line's taxable value and
 * rounded half-up, and the invoice is the sum of its lines.** Taxing the subtotal instead gives a
 * different number — on a cart of ₹95.00 and ₹75.00 it is one paise lower, because two half-paise
 * that each round up become one that rounds down. A cart that disagrees with its own invoice by a
 * paise is a support ticket and, at volume, a reconciliation problem.
 *
 * So: per line, per component, then sum. Never the other way round.
 *
 * ## Integer arithmetic only
 *
 * Non-negotiable #3 has no exception for a proportion. `halfUp` is the identity from §6.2 —
 * `half_up(n / d) === (n × 2 + d) div (d × 2)` for `n, d ≥ 0` — so no float ever touches money.
 *
 * ## This is display, and the server is authoritative
 *
 * The app shows this so the parent knows what they are about to pay. **The amount actually
 * charged is the one the checkout transaction computes**, and `L7` aborts the checkout rather
 * than charging a number the app did not display. If these two ever disagree, this module is the
 * bug — it exists to match the server, not to be a second opinion. The test pins it to the worked
 * vectors in `docs/gst-invoicing.md`.
 */

/** Basis points, per `D13`. 250 bps = 2.5%. */
export const CGST_RATE_BPS = 250;
export const SGST_RATE_BPS = 250;

const BPS_DIVISOR = 10_000;

/** Thrown rather than silently producing a wrong total from a bad input. */
export class GstInputError extends Error {
  constructor(detail: string) {
    super(`Cannot compute GST: ${detail}`);
    this.name = 'GstInputError';
  }
}

/**
 * `half_up(n / d)` in integer arithmetic — `docs/gst-invoicing.md` §6.2.
 *
 * Exported so the test can exercise the identity directly, including the half-paise boundary
 * that is the whole reason the rule is written down.
 */
export function halfUp(numerator: number, denominator: number): number {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new GstInputError('half-up takes integers only');
  }
  if (numerator < 0 || denominator <= 0) {
    throw new GstInputError('half-up is defined here for n >= 0 and d > 0');
  }
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/** One cart line's taxable value: what the parent is charged before tax. */
export interface TaxableLine {
  /** GST-EXCLUSIVE unit price in integer paise (`SC2`). */
  unitPricePaise: number;
  quantity: number;
}

export interface GstBreakdown {
  /** Σ line taxable value. The "Subtotal" row. */
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  /** taxable + cgst + sgst. The "Total" row, and what the parent pays. */
  totalPaise: number;
}

/**
 * The breakdown for a whole cart.
 *
 * An empty cart is a legitimate input and returns all zeros — an empty cart is a state the
 * screen renders, not an error it handles.
 */
export function gstBreakdown(lines: readonly TaxableLine[]): GstBreakdown {
  let taxablePaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;

  lines.forEach((line, index) => {
    if (!Number.isInteger(line.unitPricePaise) || line.unitPricePaise < 0) {
      // The index, never the dish name — a dish name is not PII but the habit is what keeps
      // recipient names out of messages (R6).
      throw new GstInputError(`line ${index} has a non-integer or negative unit price`);
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 0) {
      throw new GstInputError(`line ${index} has a non-integer or negative quantity`);
    }

    const taxable = line.unitPricePaise * line.quantity;
    taxablePaise += taxable;
    // Per line, per component. Summing the components of a summed taxable value is the bug
    // this function exists to prevent.
    cgstPaise += halfUp(taxable * CGST_RATE_BPS, BPS_DIVISOR);
    sgstPaise += halfUp(taxable * SGST_RATE_BPS, BPS_DIVISOR);
  });

  return {
    taxablePaise,
    cgstPaise,
    sgstPaise,
    totalPaise: taxablePaise + cgstPaise + sgstPaise,
  };
}
