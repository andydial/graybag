/**
 * Meal pack money, for the back office — `E21`.
 *
 * Six questions Andy asked, and one he did not but which the numbers demand:
 *
 *   1. Packs sold — count, gross ₹ ex-tax, GST ₹ — by offer and by period.
 *   2. Deferred revenue outstanding: what we owe in food, right now.
 *   3. Revenue recognised from redemptions this period.
 *   4. Breakage: items forfeited at expiry, and the ₹ that became revenue because of it.
 *   5. Redemption rate per offer — the number that says whether a pack is priced right.
 *   6. Bonus items granted and redeemed, **separately** from purchased items.
 *   7. Whether the answer to (2) agrees with the ledger. See "Two derivations" below.
 *
 * ## A pack sale is a liability, not a sale — `M10`
 *
 * Nothing in this module may be added to the food revenue line, and nothing in `admin-reports.ts`
 * changes because packs exist. Money taken for food not yet served is
 * `platform:deferred_revenue:meal_packs` on the day it arrives, and becomes revenue one item at a
 * time. `/admin/sales` renders these as their own section for that reason, not as a presentation
 * preference.
 *
 * ## The deferred balance is a function, never an accumulator — `M10`
 *
 * `deferredPaise` is `half_up(price_paid × items_remaining, items_total)`, which is the same
 * expression the database posts every ledger movement as a **difference** of. Two consequences
 * worth stating because they are the whole reason for the shape:
 *
 *   · **It is exact in integers.** ₹3,000 over 22 items is 13,636.36 paise. Any stored per-item
 *     value drifts and the last item of a pack fails to land on zero. A balance defined as a
 *     function of `items_remaining` always does, whatever the arithmetic on the way there.
 *   · **It is policy-neutral on the one question still open** (`docs/meal-packs-rebuild.md` §12
 *     q1 — whether earning a bonus restates revenue already recognised). Both answers change only
 *     `items_total`, which is an *input* here. This module is correct under either and needs no
 *     rework when Andy rules.
 *
 * ## Two derivations, deliberately, and they are compared rather than reconciled
 *
 * `M9` warns that two derivations of one quantity sharing a sign error agree with each other, so
 * the check passes in exactly the case it exists for. That warning is about deriving a number
 * **the same way twice**. This module does the opposite on purpose:
 *
 *   · `deferredOutstandingPaise` sums a function of the **pack rows** — what parents hold.
 *   · `ledgerDeferredPaise` is the **ledger's** balance on the deferred account — what the books
 *     say we owe.
 *
 * Those are maintained by completely different code paths — one by the pack tables, one by
 * double-entry postings — which is precisely the pairing `M9` says earns its place (it is the same
 * argument as `wallet_balance` against the ledger, `I8`). `reconcile` reports them side by side and
 * **says when they disagree** rather than silently choosing one. A report that quietly picks the
 * prettier number is how a deferred-revenue error survives to an audit.
 *
 * ## Revenue recognised and breakage come from the ledger, not from a replay
 *
 * It is tempting to replay redemptions in TypeScript and difference the function. That would be a
 * second place for the money rules to live — the mistake `admin-reports.ts` calls out in its own
 * header — and it would be a *third* derivation of a number the ledger already holds exactly.
 * So period figures are read from ledger postings, and this module only aggregates them.
 *
 * ## No child data, and the input shape is the control
 *
 * Non-negotiable #4. The new `meal_pack_redemption` has no `recipient_id` at all
 * (`docs/meal-packs-rebuild.md` §2), so unlike `E21-63` there is no column to exclude — but the
 * row types below are still an explicit allowlist, because "the table happens not to have it
 * today" is not a control. No name, no class, no section, no allergy, ever.
 *
 * ## `halfUp` is imported, not reimplemented
 *
 * `money/gst.ts` already owns it, pinned to `docs/gst-invoicing.md` §6.2 and exercised at the
 * half-paise boundary by its own tests. A second copy here would be a second place for a rounding
 * rule to live, and the failure mode is that the two agree for a year and then diverge on one
 * boundary nobody tests twice. It refuses negatives, which is correct for this caller: a price is
 * never negative and `items_remaining` never goes below zero — the database has a CHECK saying so.
 */

import { halfUp } from '../money/gst.js';

export class PackReportError extends Error {
  constructor(detail: string) {
    super(`The pack report is not usable: ${detail}`);
    this.name = 'PackReportError';
  }
}

/**
 * A pack, as the report may see it.
 *
 * `offerName` is `meal_pack.name_snapshot` — the offer's name **at the moment of sale**, not a join
 * to the live offer. `E21-67` was exactly this bug in the old model: renaming an offer retitled
 * packs parents already held, and reached an issued invoice's description.
 */
export interface PackRow {
  id: string;
  offerId: string;
  offerName: string;
  pricePaidPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  /** Never changes. What the parent actually bought, before any bonus. */
  itemsOriginal: number;
  /** `itemsOriginal`, plus `bonusItems` once the bonus is granted. */
  itemsTotal: number;
  itemsRemaining: number;
  bonusItems: number;
  bonusGrantedAt: string | null;
  purchasedAt: string;
  expiresAt: string;
  status: 'pending' | 'active' | 'exhausted' | 'expired';
}

/** One expiry event. Written by the sweep, one row per pack. */
export interface ExpiryRow {
  packId: string;
  breakagePaise: number;
  itemsForfeit: number;
  expiredAt: string;
}

/** What the ledger says, for the period asked about. Read from postings, never recomputed here. */
export interface LedgerPackMovements {
  /** Balance of `platform:deferred_revenue:meal_packs` right now, in paise. */
  deferredBalancePaise: number;
  /** Recognised because items were **eaten**, in the period. */
  recognisedFromRedemptionsPaise: number;
  /** Recognised because items were **forfeited**, in the period. Never folded into the above (`M11`). */
  recognisedFromBreakagePaise: number;
  /**
   * Revenue *reversed* by bonus grants in the period, if Andy rules that way. Zero under the
   * alternative. Kept as its own field so the report never has to guess which policy is live.
   */
  restatedByBonusPaise: number;
}

/** What we still owe this pack, in food. `M10`. */
export function deferredPaise(pack: Pick<PackRow, 'pricePaidPaise' | 'itemsRemaining' | 'itemsTotal'>): number {
  return halfUp(pack.pricePaidPaise * pack.itemsRemaining, pack.itemsTotal);
}

/** Packs that still owe food. A `pending` pack was never paid for and owes nothing. */
const OWES_FOOD: readonly PackRow['status'][] = ['active', 'exhausted'];

/**
 * What we owe in food across every live pack, derived from the packs themselves.
 *
 * Compared against the ledger by `reconcile`, never instead of it.
 */
export function deferredOutstandingPaise(packs: readonly PackRow[]): number {
  return packs
    .filter((p) => OWES_FOOD.includes(p.status))
    .reduce((sum, p) => sum + deferredPaise(p), 0);
}

export interface Reconciliation {
  fromPacksPaise: number;
  fromLedgerPaise: number;
  differencePaise: number;
  agrees: boolean;
}

/**
 * Do the packs and the books agree about what we owe?
 *
 * Reported, not resolved. A difference is a real finding — an item counted twice, a posting
 * missed, a pack expired without its ledger leg — and the screen says so in words rather than
 * rendering one number and hoping.
 */
export function reconcile(packs: readonly PackRow[], ledger: LedgerPackMovements): Reconciliation {
  const fromPacksPaise = deferredOutstandingPaise(packs);
  const fromLedgerPaise = ledger.deferredBalancePaise;
  const differencePaise = fromPacksPaise - fromLedgerPaise;
  return { fromPacksPaise, fromLedgerPaise, differencePaise, agrees: differencePaise === 0 };
}

export interface OfferSales {
  offerId: string;
  offerName: string;
  packsSold: number;
  /** Ex-tax. The deferred-revenue numerator, and never part of the food revenue line (`M10`). */
  grossExTaxPaise: number;
  /** CGST + SGST, collected in full at the sale. Never part of the deferred balance (`M11`). */
  gstPaise: number;
  itemsSold: number;
  itemsRedeemed: number;
  itemsRemaining: number;
  itemsForfeit: number;
  bonusItemsGranted: number;
  bonusItemsRedeemed: number;
  /**
   * Of the items actually **bought**, what fraction got eaten.
   *
   * Bonus items are excluded from both halves deliberately — see `redemptionRate`.
   * `null` when nothing has been sold, because 0/0 is "we do not know yet", and a redemption rate
   * of 0% against no sales is a sentence the screen would be wrong to say.
   */
  redemptionRate: number | null;
}

/**
 * The fraction of purchased items that were eaten, per offer.
 *
 * **Bonus items are excluded from the numerator and the denominator**, and the choice matters
 * enough to state. Andy's question is *"is this pack priced right"* — that is a question about what
 * a parent paid for and whether they got the value. Bonus items were not paid for, so including
 * them makes a generous bonus look like poor redemption: a parent who eats all 20 purchased items
 * and none of the 2 bonus ones would read as 91%, which describes the bonus, not the price.
 * `bonusItemsGranted` and `bonusItemsRedeemed` are reported beside it, as Andy asked, so the bonus
 * is visible without distorting the number it sits next to.
 */
export function redemptionRate(itemsPurchased: number, purchasedItemsRedeemed: number): number | null {
  if (itemsPurchased <= 0) return null;
  return purchasedItemsRedeemed / itemsPurchased;
}

/**
 * Per-offer sales and redemption, over whatever set of packs is handed in.
 *
 * The caller does the period filtering — `purchasedAt` for "sold this period", which is the only
 * date a *sale* has. Redemption and expiry figures are the **lifetime** state of those packs, and
 * the screen labels them that way: an item bought in March and eaten in April belongs to March's
 * pack and April's revenue, and pretending otherwise is how a redemption rate becomes meaningless.
 */
export function summarisePackSales(
  packs: readonly PackRow[],
  expiries: readonly ExpiryRow[],
): OfferSales[] {
  const forfeitByPack = new Map<string, number>();
  for (const e of expiries) {
    forfeitByPack.set(e.packId, (forfeitByPack.get(e.packId) ?? 0) + e.itemsForfeit);
  }

  const byOffer = new Map<string, OfferSales>();

  for (const pack of packs) {
    if (pack.status === 'pending') continue; // never paid for; not a sale

    const key = pack.offerId;
    let row = byOffer.get(key);
    if (!row) {
      row = {
        offerId: pack.offerId,
        // The snapshot, so a renamed offer does not restate a month that already closed.
        offerName: pack.offerName,
        packsSold: 0,
        grossExTaxPaise: 0,
        gstPaise: 0,
        itemsSold: 0,
        itemsRedeemed: 0,
        itemsRemaining: 0,
        itemsForfeit: 0,
        bonusItemsGranted: 0,
        bonusItemsRedeemed: 0,
        redemptionRate: null,
      };
      byOffer.set(key, row);
    }

    const granted = pack.bonusGrantedAt !== null ? pack.bonusItems : 0;
    // Spent across the whole pack, purchased and bonus together.
    const spent = pack.itemsTotal - pack.itemsRemaining;
    /*
     * Bonus items are earned only when the last ORIGINAL item is consumed, so a pack with a granted
     * bonus has necessarily eaten all of its purchased items. That makes the split exact rather
     * than apportioned: everything up to `itemsOriginal` is purchased, anything beyond is bonus.
     */
    const purchasedRedeemed = Math.min(spent, pack.itemsOriginal);
    const bonusRedeemed = Math.max(0, spent - pack.itemsOriginal);

    row.packsSold += 1;
    row.grossExTaxPaise += pack.pricePaidPaise;
    row.gstPaise += pack.cgstPaise + pack.sgstPaise;
    row.itemsSold += pack.itemsOriginal;
    row.itemsRedeemed += purchasedRedeemed;
    row.itemsRemaining += pack.itemsRemaining;
    row.itemsForfeit += forfeitByPack.get(pack.id) ?? 0;
    row.bonusItemsGranted += granted;
    row.bonusItemsRedeemed += bonusRedeemed;
  }

  for (const row of byOffer.values()) {
    row.redemptionRate = redemptionRate(row.itemsSold, row.itemsRedeemed);
  }

  return [...byOffer.values()].sort((a, b) => b.grossExTaxPaise - a.grossExTaxPaise || a.offerName.localeCompare(b.offerName));
}

export interface PackPeriodTotals {
  packsSold: number;
  grossExTaxPaise: number;
  gstPaise: number;
  deferredOutstandingPaise: number;
  recognisedFromRedemptionsPaise: number;
  recognisedFromBreakagePaise: number;
  restatedByBonusPaise: number;
  /** Redemptions plus breakage, less any bonus restatement. What actually hit revenue. */
  recognisedTotalPaise: number;
  reconciliation: Reconciliation;
}

/**
 * The header figures for the pack section of `/admin/sales`.
 *
 * `recognisedTotalPaise` is the only derived sum here, and it is a sum of three figures that are
 * each shown in their own right (`M11`) — it exists so the screen can state the total without the
 * reader adding three numbers, never so the three can be collapsed into it.
 */
export function packPeriodTotals(
  soldThisPeriod: readonly PackRow[],
  allLivePacks: readonly PackRow[],
  ledger: LedgerPackMovements,
): PackPeriodTotals {
  const sales = summarisePackSales(soldThisPeriod, []);
  return {
    packsSold: sales.reduce((n, s) => n + s.packsSold, 0),
    grossExTaxPaise: sales.reduce((n, s) => n + s.grossExTaxPaise, 0),
    gstPaise: sales.reduce((n, s) => n + s.gstPaise, 0),
    deferredOutstandingPaise: deferredOutstandingPaise(allLivePacks),
    recognisedFromRedemptionsPaise: ledger.recognisedFromRedemptionsPaise,
    recognisedFromBreakagePaise: ledger.recognisedFromBreakagePaise,
    restatedByBonusPaise: ledger.restatedByBonusPaise,
    recognisedTotalPaise:
      ledger.recognisedFromRedemptionsPaise +
      ledger.recognisedFromBreakagePaise -
      ledger.restatedByBonusPaise,
    reconciliation: reconcile(allLivePacks, ledger),
  };
}
