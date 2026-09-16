/**
 * What the pack will cover in this cart, computed for DISPLAY. `E21-74`.
 *
 * Andy: *"Cart: show items covered by the pack and the cash amount due, clearly separated. If the
 * pack partly covers the cart, say so before checkout, not after."* This is what makes that
 * sentence possible before the server has been asked.
 *
 * ## This decides nothing
 *
 * `reserve_meal_pack_items` decides what is actually spent, inside the same transaction that
 * writes the order, from the **order lines as persisted** — a client claiming its cart qualifies
 * proves nothing and there is no request field that could say otherwise. This module exists so a
 * parent is told what they will pay *before* they tap, not after.
 *
 * If the two ever disagree — because the balance moved between the cart rendering and the
 * checkout landing — `create_checkout`'s `L7` guard refuses with `pack_coverage_changed` rather
 * than charging a number the app did not display. So a disagreement costs a re-render, never a
 * wrong charge. **This module is the one that is wrong when that happens; it exists to match the
 * server, not to be a second opinion.**
 *
 * ## Cheapest first, and why the rule is stated here as well as in SQL
 *
 * `P23`, Andy's ruling on 2026-09-16, against my recommendation of most-expensive-first. The pack
 * covers the least expensive lines. That is visible to a parent — a ₹250 main charged in cash
 * while a ₹40 drink is covered — so the cart must name the covered lines rather than summarise
 * them as a count, and this function returns them line by line for exactly that reason.
 *
 * Ties break on the cart line's key, which is derived and stable, so the same cart always
 * produces the same answer. The server breaks ties on `line_no`, which is assigned in the same
 * order — `pack-coverage.test.ts` pins the agreement.
 */
import { CGST_RATE_BPS, halfUp, SGST_RATE_BPS } from '../money/gst.js';
import type { CartLine } from './types.js';

/** One line, and how much of it the pack pays for. */
export interface CoveredLine {
  /** The cart line's stable key, so the screen can look the line up without re-deriving it. */
  key: string;
  dishName: string;
  unitPricePaise: number;
  /** How many of this line's units the pack covers. Never more than `quantity`. */
  coveredQuantity: number;
  /** How many the parent pays cash for. `coveredQuantity + cashQuantity === quantity`. */
  cashQuantity: number;
}

export interface PackCoverage {
  /** Lines the pack pays for, at least in part, cheapest first. Empty when nothing is covered. */
  covered: readonly CoveredLine[];
  /** Total items the pack covers. */
  itemsCovered: number;
  /** Ex-tax value the pack pays for — what the server writes to `pack_applied_paise`. */
  coveredSubtotalPaise: number;
  /** Ex-tax value the parent pays. */
  cashSubtotalPaise: number;
  /** GST on the cash portion only. A covered item is not a taxable supply on this invoice. */
  cashCgstPaise: number;
  cashSgstPaise: number;
  /** What Razorpay will be asked for. Zero means the pack covers everything. */
  cashDuePaise: number;
  /** True when the pack covers some of the cart but not all of it — the sentence to say. */
  isPartial: boolean;
}

/** Nothing covered: a parent with no pack, and the shape every caller can render. */
const NOTHING = (lines: readonly CartLine[]): PackCoverage => {
  const subtotal = lines.reduce((t, l) => t + l.unitPricePaise * l.quantity, 0);
  const cgst = lines.reduce(
    (t, l) => t + halfUp(l.unitPricePaise * l.quantity * CGST_RATE_BPS, 10_000),
    0,
  );
  const sgst = lines.reduce(
    (t, l) => t + halfUp(l.unitPricePaise * l.quantity * SGST_RATE_BPS, 10_000),
    0,
  );
  return {
    covered: [],
    itemsCovered: 0,
    coveredSubtotalPaise: 0,
    cashSubtotalPaise: subtotal,
    cashCgstPaise: cgst,
    cashSgstPaise: sgst,
    cashDuePaise: subtotal + cgst + sgst,
    isPartial: false,
  };
};

/**
 * Apply `spendableItems` to `lines`, cheapest first.
 *
 * **Per line, per component, half-up** — `G1`/`G2` and `docs/gst-invoicing.md` §6.2, the same rule
 * the rest of the cart uses and the same one `reserve_meal_pack_items` applies in SQL. Never 5%
 * of a total, and no float touches money (non-negotiable #3).
 */
export function coverCart(
  lines: readonly CartLine[],
  spendableItems: number,
): PackCoverage {
  if (spendableItems <= 0 || lines.length === 0) return NOTHING(lines);

  // Cheapest first, ties on the stable key. Whole lines wherever possible, so at most one line is
  // ever split — the one where the pack runs out.
  const order = [...lines].sort(
    (a, b) => a.unitPricePaise - b.unitPricePaise || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );

  const coveredByKey = new Map<string, number>();
  let left = spendableItems;
  for (const line of order) {
    if (left <= 0) break;
    const take = Math.min(line.quantity, left);
    if (take > 0) {
      coveredByKey.set(line.key, take);
      left -= take;
    }
  }

  const covered: CoveredLine[] = [];
  let coveredSubtotal = 0;
  let cashSubtotal = 0;
  let cashCgst = 0;
  let cashSgst = 0;
  let itemsCovered = 0;

  for (const line of order) {
    const take = coveredByKey.get(line.key) ?? 0;
    const cashQty = line.quantity - take;

    if (take > 0) {
      covered.push({
        key: line.key,
        dishName: line.dishName,
        unitPricePaise: line.unitPricePaise,
        coveredQuantity: take,
        cashQuantity: cashQty,
      });
      coveredSubtotal += line.unitPricePaise * take;
      itemsCovered += take;
    }

    if (cashQty > 0) {
      const taxable = line.unitPricePaise * cashQty;
      cashSubtotal += taxable;
      cashCgst += halfUp(taxable * CGST_RATE_BPS, 10_000);
      cashSgst += halfUp(taxable * SGST_RATE_BPS, 10_000);
    }
  }

  return {
    covered,
    itemsCovered,
    coveredSubtotalPaise: coveredSubtotal,
    cashSubtotalPaise: cashSubtotal,
    cashCgstPaise: cashCgst,
    cashSgstPaise: cashSgst,
    cashDuePaise: cashSubtotal + cashCgst + cashSgst,
    // Partial means the parent pays cash AND uses the pack. Covering everything is not partial,
    // and covering nothing is not either — both have a simpler sentence to say.
    isPartial: itemsCovered > 0 && cashSubtotal > 0,
  };
}
