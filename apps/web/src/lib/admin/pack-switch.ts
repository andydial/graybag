/**
 * Whether a school sells meal packs — the control, and who may touch it — `E21`.
 *
 * Andy, 2026-09-16: *"Enabling packs for a school is a school-readiness property, and it belongs
 * beside the other readiness gates on Schools — that's where I'll be when I turn Amity on."* So the
 * switch moved here from `/admin/packs`, and was **removed** there rather than duplicated: *"one
 * control, one place. Two surfaces writing the same row is exactly the 'same thing in two places'
 * problem the admin redesign was meant to kill."*
 *
 * This module is the part worth testing — the permission rule and what each row means. The screen
 * renders what it returns.
 */
import type { api } from '@graybag/shared';

/** The permission, and the scope it must be held at. `0070` allows it at platform scope only. */
export const PACKS_PERMISSION = 'meal_packs.manage';

/**
 * May this account change the switch?
 *
 * **Scope is checked, not just the code.** `0070` constrains `valid_scope_types` to `{platform}`,
 * so a school-scoped grant cannot be created today — but a constraint on what may be *granted* is
 * not a check on what *was*, and reading both costs nothing. `admin-pack-offer` makes the same
 * check server-side; this one decides whether to draw a control, never whether a write is allowed.
 *
 * The owner holds **no grant rows** (`E02-39`), so enumerating grants alone would render the
 * switch read-only for the one account that can do everything.
 */
export function canManagePacks(access: api.MyAccess | null): boolean {
  if (!access) return false;
  if (access.isOwner) return true;
  return access.grants.some(
    (g) => g.permissionCode === PACKS_PERMISSION && g.scopeType === 'platform',
  );
}

export interface PackSwitchRow {
  offerId: string;
  offerName: string;
  /** Whether packs under this offer are purchasable at this school right now. */
  isEnabled: boolean;
  /**
   * Whether the offer itself is live. An offer switched **on** at a school but still a draft sells
   * nothing, and that combination has to be visible or the switch looks broken.
   */
  isOfferActive: boolean;
}

/**
 * The switch rows for one school: every offer, and whether this school has it on.
 *
 * **Every offer, including ones with no row for this school.** Absence means off, and a screen that
 * listed only existing rows would show an empty list for the school nobody has enabled yet — which
 * is precisely the school somebody came here to enable. That is the Amity case.
 *
 * Drafts are included too. Hiding them would mean creating an offer, coming here, finding nothing,
 * and having no way to learn that the offer's own switch is the missing half.
 */
export function packSwitchRows(
  offers: readonly api.AdminPackOffer[],
  schoolId: string,
): PackSwitchRow[] {
  return offers.map((offer) => ({
    offerId: offer.id,
    offerName: offer.name,
    // `find` on the pair, then read `isEnabled`. A row that exists and is switched off and a row
    // that does not exist are both "off" here, and they are genuinely the same to a parent.
    isEnabled: offer.schools.find((s) => s.schoolId === schoolId)?.isEnabled === true,
    isOfferActive: offer.isActive,
  }));
}

/**
 * One sentence describing what a school actually sells, for the read-only line.
 *
 * Deliberately says **nothing is purchasable** rather than "packs are off" when the only enabled
 * offers are drafts: from a parent's side those are the same thing, and the readiness page exists
 * to answer what a parent would see.
 */
export function packSummaryLine(rows: readonly PackSwitchRow[]): string {
  const sellable = rows.filter((r) => r.isEnabled && r.isOfferActive);
  if (sellable.length > 0) {
    return `${sellable.map((r) => r.offerName).join(', ')} — on sale here`;
  }
  const enabledDrafts = rows.filter((r) => r.isEnabled && !r.isOfferActive);
  if (enabledDrafts.length > 0) {
    return `Switched on for ${enabledDrafts.map((r) => r.offerName).join(', ')}, but ` +
      `${enabledDrafts.length === 1 ? 'that offer is' : 'those offers are'} still a draft — ` +
      `nothing is purchasable here yet.`;
  }
  return 'No meal packs are offered at this school.';
}
