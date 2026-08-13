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

  if (target === null) return { status: 'none' };
  if (target.allergenIds === null) return { status: 'unavailable' };
  if (labels === null) return { status: 'unavailable' };

  return {
    status: 'ready',
    avoid: target.allergenIds.map((allergenId) => ({
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
