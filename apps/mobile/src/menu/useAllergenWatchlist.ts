import { useEffect, useState } from 'react';
import { api, menu as menuDomain } from '@graybag/shared';

import type { AllergenWatchlist } from './MenuScreen';
import { useOrderTarget } from '../session/OrderTargetContext';

/**
 * The allergens to warn about, and the words to warn in — `E05-31`.
 *
 * ## The three states are the whole point
 *
 * `OrderTarget.allergenIds` is `readonly string[] | null`, and this turns that into the
 * watchlist the menu draws from:
 *
 * | Target | `allergenIds` | Watchlist | What the menu shows |
 * |---|---|---|---|
 * | none | — | `none` | no flags, and no claim either way |
 * | selected | `null` | `unavailable` | no flags, **and a line saying warnings are unavailable** |
 * | selected | `[]` | `ready` with nothing | no flags, because there is genuinely nothing to warn about |
 * | selected | `['a1']` | `ready` | flags on the dishes that match |
 *
 * Rows two and three look identical on screen except for one sentence, and that sentence is the
 * entire safety property. `[]` means *we asked and there are none*. `null` means *we cannot tell
 * you*. Collapsing them turns "we did not look" into "you are safe", which is the §5.21 failure
 * in the place it costs most — and it is exactly what `AddChildScreen`'s old `catch { return [] }`
 * did before it was found.
 *
 * ## Why the labels are fetched separately
 *
 * A warning has to say **"Contains Peanuts"**, not "contains a1000000-…". The ids come from the
 * recipient (tier S, one person, on demand); the names come from the `allergen` reference table,
 * which is public menu data anyone can read. Two different sensitivities, so two different reads.
 *
 * If the labels fail but the ids arrived, that is still `unavailable` rather than `ready` — a
 * flag we cannot name is a flag nobody can act on.
 */
export function useAllergenWatchlist(): AllergenWatchlist {
  const { target } = useOrderTarget();
  const labels = useAllergenLabels();

  if (target === null) return { status: 'none' };
  return buildWatchlist(target.allergenIds, labels);
}

/**
 * The same watchlist for a recipient the caller names — `E21-51`.
 *
 * ## Why this exists beside `useAllergenWatchlist` rather than replacing it
 *
 * `useAllergenWatchlist` answers for whoever is in `OrderTargetContext`, which is right for the
 * menu and the cart: one child is selected and everything on screen is for them. **The planner
 * is not like that.** A parent plans several days at once and picks a child *per day*, so there
 * is no single order target to read, and the day being edited is the only thing that says whose
 * allergies matter. Asking the context would warn about the wrong child, which is worse than not
 * warning at all — it is a warning that is confidently about somebody else.
 *
 * Both go through `buildWatchlist` and both are read by `clashingAllergens`, so the two screens
 * cannot come to different conclusions about the same dish.
 *
 * ## Loading counts as `unavailable`, deliberately
 *
 * The ids are fetched per recipient (tier S, on demand — the list read does not carry them), so
 * there is a window where we do not yet know. That window renders as **`unavailable`**, not as
 * `ready` with nothing: the alternative shows a dish with no warning on it while the answer is
 * still in flight, which reads as *checked and safe*. `MenuScreen` already behaves this way for
 * the label fetch, and this is the same trade in the same direction.
 *
 * ## The answer is stored WITH the recipient it is about
 *
 * Not as a bare list reset by an effect. An effect runs *after* render, so on the frame where
 * the day changes to a different child the hook would still be holding the previous child's
 * answer — and would hand it to the screen. One frame is enough to paint a dish as unflagged
 * for a child whose allergies have not been read.
 *
 * Keyed, the stale answer is unrepresentable rather than merely short-lived: a result belonging
 * to a different recipient does not match and reads as `unavailable`. `does not carry one
 * child's clean result over to the next child` fails against the effect-reset version.
 */
export function useRecipientWatchlist(recipientId: string): AllergenWatchlist {
  const labels = useAllergenLabels();
  const [answer, setAnswer] = useState<{ recipientId: string; ids: readonly string[] } | null>(
    null,
  );

  useEffect(() => {
    if (recipientId === '') return undefined;

    let live = true;
    api
      .fetchRecipientAllergens(recipientId)
      .then((ids) => {
        if (live) setAnswer({ recipientId, ids });
      })
      .catch(() => {
        // Cleared rather than left: "we cannot tell you", never "there are none". Nothing is
        // logged — these ids are health data about a minor (non-negotiable #4).
        if (live) setAnswer(null);
      });
    return () => {
      live = false;
    };
  }, [recipientId]);

  if (recipientId === '') return { status: 'none' };
  // The guard that makes a stale answer impossible, not just brief.
  const ids = answer !== null && answer.recipientId === recipientId ? answer.ids : null;
  return buildWatchlist(ids, labels);
}

/**
 * The allergen names, fetched once. Public menu reference data, unlike the ids.
 *
 * Shared by both hooks so a screen cannot end up with labels the other does not have.
 */
function useAllergenLabels(): Map<string, string> | null {
  const [labels, setLabels] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    let live = true;
    api
      .fetchAllergens()
      .then((rows) => {
        if (!live) return;
        setLabels(new Map(rows.map((row) => [row.id, row.displayName])));
      })
      .catch(() => {
        // Nothing logged: a failure here carries no personal data, but the habit is what keeps
        // recipient ids out of logs everywhere else.
        if (live) setLabels(null);
      });
    return () => {
      live = false;
    };
  }, []);

  return labels;
}

/**
 * Ids plus names into a watchlist, keeping the three states distinct.
 *
 * `null` ids and `null` labels both mean `unavailable`, and for the same reason: a flag we cannot
 * raise and a flag we cannot name are equally unactionable. Only a real array with real labels
 * becomes `ready`.
 */
function buildWatchlist(
  allergenIds: readonly string[] | null,
  labels: Map<string, string> | null,
): AllergenWatchlist {
  if (allergenIds === null) return { status: 'unavailable' };
  if (labels === null) return { status: 'unavailable' };

  return {
    status: 'ready',
    avoid: allergenIds.map((allergenId) => ({
      allergenId,
      // An id we hold but cannot name is still shown as a flag — the parent needs to know the
      // dish clashes even if we cannot say with what. Silence would be the wrong trade.
      label: labels.get(allergenId) ?? 'an allergen you told us about',
    })),
  };
}

/**
 * The allergens of one dish that this recipient must be warned about — `F5`/`F6`.
 *
 * **Here rather than on a screen, because it is now read by two of them.** It lived inside
 * `MenuScreen` until `E05-45`; the cart needs exactly the same answer, and an allergen match
 * implemented twice is an allergen match that will eventually disagree with itself. Of all the
 * duplication in this app this is the one that must not exist: the two screens would differ on
 * which dishes are dangerous, and the grid and the cart show the same dish.
 *
 * Returns an empty list for `none` (nobody to compare against) and for `unavailable` (nothing
 * to compare with). **Only `unavailable` produces the separate line saying warnings could not
 * be checked** — an empty list here is never on its own a claim that a dish is safe.
 */
export function clashingAllergens(
  dish: { allergens: api.ApiDishAllergen[]; allergensDeclaredNone: boolean },
  watchlist: AllergenWatchlist,
): string[] {
  if (watchlist.status !== 'ready') return [];

  const warning = menuDomain.allergenWarning(
    { allergens: dish.allergens, allergensDeclaredNone: dish.allergensDeclaredNone },
    watchlist.avoid.map((entry) => entry.allergenId),
  );
  if (!warning.warn || warning.reason !== 'match') return [];

  const labels = new Map(watchlist.avoid.map((entry) => [entry.allergenId, entry.label]));
  return warning.allergenIds.map((id) => labels.get(id) ?? id);
}
