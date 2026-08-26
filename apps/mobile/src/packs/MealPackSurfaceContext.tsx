import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@graybag/shared';

import { useSelectedSchool } from '../session/SelectedSchoolContext';
import { useSession } from '../session/SessionContext';

/**
 * Whether this parent sees packs at all. `E21-33`, decision `D2` in `docs/decisions-27aug.md`.
 *
 * Andy, 2026-08-26: *"No pack surface renders in the parent app unless configuration says so. Not
 * a hidden tab, not an empty state, not a menu entry — if no offer is live for that school, the
 * parent sees an app with no such concept."*
 *
 * ## Why this is a context and not a hook each screen calls
 *
 * Every screen fetching for itself would be less code and wrong in a way that shows: the answer
 * would land at different moments on different screens, so a parent could watch the Account row
 * disappear while standing on the balance screen it led to. One answer, one moment.
 *
 * ## The two flags are not the same question
 *
 * `canBuy` is configuration — a business decision about whether we sell here. `hasBalance` is a
 * **debt**: meals this parent has already paid for. Withdrawing an offer must stop the first and
 * must never touch the second (`E21-31`), which is why the app never derives one from the other
 * and never derives either from a pack list it fetched itself.
 *
 * ## Unknown renders as nothing
 *
 * Before the first answer arrives, and after any failure, both are false. The two mistakes are
 * not symmetric: rendering nothing costs a sale the parent can still make later, while rendering
 * a pack surface that should not exist offers to take money for something we may not sell at that
 * school. `api.fetchMealPackSurface` already fails closed; this keeps the same direction while in
 * flight.
 */
export interface MealPackSurface {
  /** Configuration says packs are sold at the selected school. */
  canBuy: boolean;
  /** This parent holds spendable meals — true regardless of `canBuy`. */
  hasBalance: boolean;
  /** True until the first answer lands. Screens use it to skeleton rather than to decide. */
  loading: boolean;
}

const NOTHING: MealPackSurface = { canBuy: false, hasBalance: false, loading: true };

const Ctx = createContext<MealPackSurface>(NOTHING);

export function MealPackSurfaceProvider({ children }: { children: ReactNode }) {
  const { schoolId } = useSelectedSchool();
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.userId : null;

  const [surface, setSurface] = useState<MealPackSurface>(NOTHING);

  useEffect(() => {
    // Signed out, or no school chosen: there is nothing to ask about, and asking would send a
    // null id to the server. Not an error — just no surface.
    if (userId === null || schoolId === null) {
      setSurface({ canBuy: false, hasBalance: false, loading: false });
      return;
    }

    let cancelled = false;
    setSurface(NOTHING);

    void (async () => {
      const answer = await api.fetchMealPackSurface(userId, schoolId);
      if (cancelled) return;
      setSurface({ ...answer, loading: false });
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, schoolId]);

  const value = useMemo(() => surface, [surface]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * What pack surface exists right now.
 *
 * Returns "nothing" rather than throwing when no provider is mounted, unlike `useCart`. The
 * difference is deliberate: a missing cart provider means the add button is silently broken and
 * must be loud, whereas a missing pack provider means packs do not render — which is the safe
 * state and the one most of the app is in anyway.
 */
export function useMealPackSurface(): MealPackSurface {
  return useContext(Ctx);
}

/**
 * Does any pack entry point render?
 *
 * Both flags, because either one is a reason to show a way in: a parent who can buy needs the
 * offers, and a parent with a balance needs it **even where we have stopped selling**.
 */
export function showsPackEntryPoint(surface: MealPackSurface): boolean {
  return surface.canBuy || surface.hasBalance;
}
