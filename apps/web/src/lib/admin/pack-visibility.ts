/**
 * Can we actually see pack money, or are we just reading an empty list? — `E21`.
 *
 * ## The problem this exists for
 *
 * `meal_pack_money` is a `security_invoker` view over `meal_pack`, whose only read policy is
 * `meal_pack_read_own`. A back-office account owns no packs, so the read **succeeds and returns
 * nothing** — and naive aggregation renders a confident **₹0 still owed in food**.
 *
 * That is `E21-63`'s finding in a second place: *"the web thread correctly refused to render '0
 * paid with a pack' when the truth is 'we can't see'"*. It matters more here, because ₹0 owed is
 * a sentence somebody would act on — it is the difference between "we have no liability" and "we
 * cannot measure our liability".
 *
 * ## Why it can be answered rather than guessed
 *
 * An empty list on its own is ambiguous. But the sold **count** comes from the `admin-pack-offer`
 * Edge Function, which runs under the service role and can see every pack — so if it reports packs
 * sold while the view returns none, the difference is permission, not reality. That is evidence,
 * not an assumption, and it is the whole reason this is a function with tests rather than a
 * ternary in a screen.
 */
import type { api } from '@graybag/shared';

/**
 * Decide whether the pack figures can be believed.
 *
 * @param packRows  rows from `meal_pack_money`, or `null` if that read failed outright.
 * @param soldByOffer  per-offer sold counts from the Edge Function, or `null` if it failed.
 *
 * **Every uncertain case resolves to `blind`.** A screen that says "we cannot see this" when it
 * could have shown a number is a small annoyance; a screen that says ₹0 when the truth is ₹40,000
 * is a false statement about money.
 */
export function packVisibilityOf(
  packRows: api.PackMoneyRow[] | null,
  soldByOffer: Record<string, number> | null,
): api.Visibility {
  // The read itself failed. Nothing to show and nothing to claim.
  if (packRows === null) return 'blind';

  // We can see packs, so we can see pack money. The count is irrelevant here — even one row
  // proves the read is not being filtered to nothing.
  if (packRows.length > 0) return 'visible';

  // Empty, and we could not check whether that is the truth. Do not claim zero.
  if (soldByOffer === null) return 'blind';

  const sold = Object.values(soldByOffer).reduce((n, x) => n + x, 0);

  // Packs exist and we are reading none of them: that is a permission boundary, not an empty
  // business. This is the case the whole module exists for.
  if (sold > 0) return 'blind';

  // Nothing sold, and the service role agrees. Genuinely zero.
  return 'visible';
}
