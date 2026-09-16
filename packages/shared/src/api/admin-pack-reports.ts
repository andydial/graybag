/**
 * Meal pack money, for the back office — `E21`.
 *
 * Six questions Andy asked, and one the numbers demand:
 *
 *   1. Packs sold — count, gross ₹ ex-tax, GST ₹ — by offer and by period.
 *   2. Deferred revenue outstanding: what we owe in food, right now.
 *   3. Revenue recognised from redemptions this period.
 *   4. Breakage: items forfeited at expiry, and the ₹ recognised because of it.
 *   5. Redemption rate per offer — the number that says whether a pack is priced right.
 *   6. Bonus items granted and redeemed, **separately** from purchased items.
 *   7. Whether we can see any of it at all. See "Zero and blind are different answers".
 *
 * ## A pack sale is a liability, not a sale — `M10`
 *
 * Nothing here may be added to the food revenue line, and nothing in `admin-reports.ts` changes
 * because packs exist. Money taken for food not yet served is
 * `platform:deferred_revenue:meal_packs` on the day it arrives and becomes revenue one item at a
 * time. `/admin/sales` renders this as its own section for that reason, not as a presentation
 * preference.
 *
 * ## The arithmetic lives in the database, and this module only aggregates
 *
 * `meal_pack_money` already computes, per pack: `deferred_paise` (via
 * `meal_pack_deferred_paise`), `revenue_recognised_paise`, `breakage_paise`,
 * `valued_items_redeemed` and `bonus_items_redeemed`. So this file sums and groups; it does not
 * recompute. An earlier draft replayed redemptions in TypeScript and it was wrong to: that is a
 * second place for the money rules to live, which `admin-reports.ts` warns about in its own
 * header, and the two copies would agree until the day they did not.
 *
 * **Bonus items carry no deferred value** — Andy, 2026-09-16, settled. The parent paid for
 * `items_original` items and all of it is earned by the time the bonus triggers; the bonus is a
 * giveaway, a cost to COGS when redeemed, never a reversal of revenue already recognised. The
 * database encodes this as `valued_remaining` (purchased items still owed) held separately from
 * `bonus_remaining`, with `meal_pack_deferred_paise` dividing by `items_original`. There is no
 * bonus restatement anywhere and there must never be one.
 *
 * ## Zero and blind are different answers, and this module refuses to confuse them
 *
 * `meal_pack_money` is `security_invoker`, and `meal_pack` carries one read policy —
 * `meal_pack_read_own`. A back-office account owns no packs, so the view returns **no rows** to
 * the audience it exists for, and naive aggregation renders a confident **₹0 deferred**.
 *
 * That is exactly `E21-63`'s finding — *"the web thread correctly refused to render '0 paid with a
 * pack' when the truth is 'we can't see'"* — and it is a worse failure here, because ₹0 owed in
 * food is a sentence Andy would act on. So every total carries `visibility`, and the screen must
 * say **"we cannot see this"** rather than print a number. Raised as a requirement on the mobile
 * thread in `planning/andy-queue.md`; until it is answered, the honest screen is a blind one.
 *
 * ## No child data, and the row type is the control
 *
 * Non-negotiable #4. `meal_pack_money` has no `recipient_id` and no `customer_user_id` — the
 * rebuilt `meal_pack_redemption` does not carry a child at all. The row type below is still an
 * explicit allowlist, because "the view happens not to expose it today" is not a control.
 */
import { runQuery } from './client.js';

export class PackReportError extends Error {
  constructor(detail: string) {
    super(`The pack report is not usable: ${detail}`);
    this.name = 'PackReportError';
  }
}

/**
 * Exactly what the pack money report may read.
 *
 * No `customer_user_id`, no `recipient_id`, no order reference. A report is aggregate by
 * definition, and the moment an identity is in the query it is one CSV export away from a school's
 * inbox.
 *
 * **`offer_id` is missing and is wanted** — see `summarisePackSales`.
 */
export const PACK_MONEY_COLUMNS =
  'meal_pack_id,school_id,name_snapshot,purchased_at,expires_at,status,' +
  'price_paid_paise,tax_paise,items_original,valued_remaining,deferred_paise,' +
  'bonus_items_offered,bonus_granted,bonus_items_redeemed,bonus_items_outstanding,' +
  'revenue_recognised_paise,valued_items_redeemed,breakage_paise';

/** One pack, as the money report sees it. Mirrors `meal_pack_money`. */
export interface PackMoneyRow {
  mealPackId: string;
  schoolId: string;
  /** The offer's name **at the moment of sale**, so a rename cannot restate a closed month. */
  nameSnapshot: string;
  purchasedAt: string;
  expiresAt: string;
  status: 'active' | 'exhausted' | 'expired';
  /** Ex-tax. The deferred-revenue numerator. */
  pricePaidPaise: number;
  /** CGST + SGST, collected in full at the sale and never part of the deferred balance (`M11`). */
  taxPaise: number;
  itemsOriginal: number;
  /** Purchased items still owed. Excludes bonus items, which were never deferred. */
  valuedRemaining: number;
  deferredPaise: number;
  bonusItemsOffered: number;
  bonusGranted: boolean;
  bonusItemsRedeemed: number;
  bonusItemsOutstanding: number;
  revenueRecognisedPaise: number;
  valuedItemsRedeemed: number;
  breakagePaise: number;
}

/**
 * Whether the figures beside this can be believed.
 *
 * `blind` is not an error state — the read succeeded and returned nothing. It is the difference
 * between *"no packs have been sold"* and *"we are not allowed to see whether any have"*, and the
 * screen renders them completely differently.
 */
export type Visibility = 'visible' | 'blind';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);

/** Statuses that still owe food. `pending` is excluded by the view — it was never paid for. */
const OWES_FOOD: readonly PackMoneyRow['status'][] = ['active', 'exhausted'];

export function toPackMoneyRow(row: unknown): PackMoneyRow | null {
  if (!isRecord(row)) return null;
  return {
    mealPackId: str(row.meal_pack_id),
    schoolId: str(row.school_id),
    nameSnapshot: str(row.name_snapshot),
    purchasedAt: str(row.purchased_at),
    expiresAt: str(row.expires_at),
    status: str(row.status) as PackMoneyRow['status'],
    pricePaidPaise: num(row.price_paid_paise),
    taxPaise: num(row.tax_paise),
    itemsOriginal: num(row.items_original),
    valuedRemaining: num(row.valued_remaining),
    deferredPaise: num(row.deferred_paise),
    bonusItemsOffered: num(row.bonus_items_offered),
    bonusGranted: row.bonus_granted === true,
    bonusItemsRedeemed: num(row.bonus_items_redeemed),
    bonusItemsOutstanding: num(row.bonus_items_outstanding),
    revenueRecognisedPaise: num(row.revenue_recognised_paise),
    valuedItemsRedeemed: num(row.valued_items_redeemed),
    breakagePaise: num(row.breakage_paise),
  };
}

/** Every pack the caller may see. Ordered so a period filter can be applied by the caller. */
export async function fetchPackMoney(): Promise<PackMoneyRow[]> {
  const rows = await runQuery<unknown>((t) =>
    t.from('meal_pack_money').select(PACK_MONEY_COLUMNS).order('purchased_at'),
  );
  return rows.map(toPackMoneyRow).filter((r): r is PackMoneyRow => r !== null);
}

export interface OfferSales {
  /**
   * The offer's name as sold. **Not an id** — `meal_pack_money` does not expose `offer_id`, so two
   * offers sharing a name, or one renamed mid-life, group together here. Raised as a requirement
   * on the mobile thread; grouping by the sold name is the honest fallback in the meantime,
   * because it is at least the name the money was taken under.
   */
  offerName: string;
  packsSold: number;
  /** Ex-tax, and never part of the food revenue line (`M10`). */
  grossExTaxPaise: number;
  /** Collected in full at the sale. Never part of the deferred balance (`M11`). */
  gstPaise: number;
  deferredPaise: number;
  revenueRecognisedPaise: number;
  breakagePaise: number;
  /** Purchased items only. */
  itemsSold: number;
  itemsRedeemed: number;
  itemsOutstanding: number;
  bonusItemsGranted: number;
  bonusItemsRedeemed: number;
  bonusItemsOutstanding: number;
  /**
   * Of the items actually **bought**, what fraction got eaten.
   *
   * Bonus items are excluded from both halves. Andy's question is *"is this pack priced right"* —
   * a question about what a parent paid for and whether they got the value. Bonus items were not
   * paid for, so counting them makes a generous bonus look like poor redemption: eat all 20
   * purchased and none of the 2 bonus, and the rate would read 91% while describing the bonus
   * rather than the price. They are reported beside it instead, as Andy asked.
   *
   * `null` when nothing has been sold, because 0/0 is "we do not know yet" and a redemption rate
   * of 0% against no sales is a sentence the screen would be wrong to say.
   */
  redemptionRate: number | null;
}

export function redemptionRate(itemsSold: number, itemsRedeemed: number): number | null {
  if (itemsSold <= 0) return null;
  return itemsRedeemed / itemsSold;
}

/** Per-offer sales and redemption, over whatever set of packs the caller hands in. */
export function summarisePackSales(packs: readonly PackMoneyRow[]): OfferSales[] {
  const byOffer = new Map<string, OfferSales>();

  for (const pack of packs) {
    let row = byOffer.get(pack.nameSnapshot);
    if (!row) {
      row = {
        offerName: pack.nameSnapshot,
        packsSold: 0, grossExTaxPaise: 0, gstPaise: 0,
        deferredPaise: 0, revenueRecognisedPaise: 0, breakagePaise: 0,
        itemsSold: 0, itemsRedeemed: 0, itemsOutstanding: 0,
        bonusItemsGranted: 0, bonusItemsRedeemed: 0, bonusItemsOutstanding: 0,
        redemptionRate: null,
      };
      byOffer.set(pack.nameSnapshot, row);
    }

    row.packsSold += 1;
    row.grossExTaxPaise += pack.pricePaidPaise;
    row.gstPaise += pack.taxPaise;
    row.deferredPaise += pack.deferredPaise;
    row.revenueRecognisedPaise += pack.revenueRecognisedPaise;
    row.breakagePaise += pack.breakagePaise;
    row.itemsSold += pack.itemsOriginal;
    row.itemsRedeemed += pack.valuedItemsRedeemed;
    row.itemsOutstanding += pack.valuedRemaining;
    // Offered is not granted. A pack that never earned its bonus offered 2 and granted 0.
    row.bonusItemsGranted += pack.bonusGranted ? pack.bonusItemsOffered : 0;
    row.bonusItemsRedeemed += pack.bonusItemsRedeemed;
    row.bonusItemsOutstanding += pack.bonusItemsOutstanding;
  }

  for (const row of byOffer.values()) {
    row.redemptionRate = redemptionRate(row.itemsSold, row.itemsRedeemed);
  }

  return [...byOffer.values()].sort(
    (a, b) => b.grossExTaxPaise - a.grossExTaxPaise || a.offerName.localeCompare(b.offerName),
  );
}

export interface PackPeriodTotals {
  visibility: Visibility;
  packsSold: number;
  grossExTaxPaise: number;
  gstPaise: number;
  /** Across every live pack, not only those sold in the period — a liability is a running total. */
  deferredOutstandingPaise: number;
  revenueRecognisedPaise: number;
  breakagePaise: number;
  itemsOutstanding: number;
  bonusItemsOutstanding: number;
  offers: OfferSales[];
}

/**
 * The pack section of `/admin/sales`.
 *
 * `soldInPeriod` answers "what did we sell" and is filtered on `purchasedAt` by the caller, which
 * is the only date a *sale* has. `allLivePacks` answers "what do we owe", which is a running
 * balance and belongs to no period.
 *
 * Revenue recognised and breakage are summed over `soldInPeriod`, and the screen labels them as
 * **lifetime figures for packs sold in this period** rather than pretending to be a period
 * movement. Getting a true period movement needs the ledger postings dated within it, which the
 * back office cannot currently read — raised as a requirement rather than approximated, because an
 * approximated revenue figure that looks exact is worse than a labelled one.
 */
export function packPeriodTotals(
  soldInPeriod: readonly PackMoneyRow[],
  allLivePacks: readonly PackMoneyRow[],
  visibility: Visibility,
): PackPeriodTotals {
  const offers = summarisePackSales(soldInPeriod);
  const owing = allLivePacks.filter((p) => OWES_FOOD.includes(p.status));

  return {
    visibility,
    packsSold: offers.reduce((n, o) => n + o.packsSold, 0),
    grossExTaxPaise: offers.reduce((n, o) => n + o.grossExTaxPaise, 0),
    gstPaise: offers.reduce((n, o) => n + o.gstPaise, 0),
    deferredOutstandingPaise: owing.reduce((n, p) => n + p.deferredPaise, 0),
    revenueRecognisedPaise: offers.reduce((n, o) => n + o.revenueRecognisedPaise, 0),
    breakagePaise: offers.reduce((n, o) => n + o.breakagePaise, 0),
    itemsOutstanding: owing.reduce((n, p) => n + p.valuedRemaining, 0),
    bonusItemsOutstanding: owing.reduce((n, p) => n + p.bonusItemsOutstanding, 0),
    offers,
  };
}

/** Packs bought within `[from, to]` inclusive, by ISO date. The only date a sale has. */
export function soldBetween(
  packs: readonly PackMoneyRow[], from: string, to: string,
): PackMoneyRow[] {
  return packs.filter((p) => {
    const day = p.purchasedAt.slice(0, 10);
    return day >= from && day <= to;
  });
}
