import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@graybag/shared';

import { useSelectedSchool } from '../session/SelectedSchoolContext';
import { useSession } from '../session/SessionContext';

/**
 * Whether this parent sees packs at all. `E21-75`, rebuilt from `E21-33`.
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
 * **debt**: items this parent has already paid for. Withdrawing an offer must stop the first and
 * must never touch the second (`E21-31`), which is why the app never derives one from the other
 * and never derives either from a pack list it fetched itself.
 *
 * ## Unknown decides as no, but Home WAITS for it
 *
 * Both flags are false before the first answer arrives and after any failure, and that asymmetry
 * is deliberate: rendering nothing costs a sale the parent can still make later, while rendering
 * a pack surface that should not exist offers to take money for something we may not sell at that
 * school. `api.fetchMealPackSurface` already fails closed; this keeps the same direction in
 * flight.
 *
 * **What changed in `E21-75` is `loading`, and it is load-bearing now.** Andy, 2026-09-16, on
 * Home's "This Week": *"Never an empty section, and never a layout shift."* Home renders the pack
 * offers when there are any and the existing featured dish when there are not — one slot, two
 * occupants — so it must not paint the section until it knows which. `loading` is how it waits.
 * Screens that merely *gate* on the answer still read it as no while it is true; only Home holds
 * its paint, because only Home would visibly swap.
 */
export interface MealPackSurface {
  /** Configuration says packs are sold at the selected school. */
  canBuy: boolean;
  /** This parent holds spendable items at the selected school — true regardless of `canBuy`. */
  hasBalance: boolean;
  /** True until the first answer lands. Home waits on it; everything else reads it as "no". */
  loading: boolean;
  /**
   * The pack the next order at the selected school will draw from, or `null`.
   *
   * Fetched here rather than by the cart, which has more reasons to re-render than any other
   * screen — a read inside it would fire on every quantity change. Fetched only when
   * `hasBalance` is true, so a parent with no pack costs no request.
   */
  balance: api.MealPackBalance | null;
  /**
   * Every live pack, in spend order — earliest expiry first, the server's order, never re-sorted.
   *
   * `balance` is the first of these that matches the selected school. My Meal Packs shows all of
   * them so a nearer expiry is never hidden behind a later one, and names the school on each,
   * because a parent with children at two schools holds two balances (`P22`).
   */
  allPacks: readonly api.MealPackBalance[];
}

/** In flight: the provider is mounted and has not heard back. Home waits on this. */
const ASKING: MealPackSurface = {
  canBuy: false,
  hasBalance: false,
  loading: true,
  balance: null,
  allPacks: [],
};

/**
 * The context default — **`loading: false`, deliberately**.
 *
 * No provider mounted is a DEFINITE answer, not an unknown one: this app has no pack surface,
 * full stop. Defaulting to `loading: true` made Home skeleton for ever wherever the provider is
 * absent, which the placeholder-screen tests caught immediately and a stray render path would
 * have shown a parent as a spinner that never resolves.
 *
 * The distinction only exists because `E21-77` made `loading` load-bearing. Before it, every
 * consumer read `loading` as "no" and the two states were interchangeable.
 */
const NO_PROVIDER: MealPackSurface = { ...ASKING, loading: false };

const Ctx = createContext<MealPackSurface>(NO_PROVIDER);

export function MealPackSurfaceProvider({ children }: { children: ReactNode }) {
  const { schoolId } = useSelectedSchool();
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.userId : null;

  const [surface, setSurface] = useState<MealPackSurface>(ASKING);

  useEffect(() => {
    // Signed out, or no school chosen: there is nothing to ask about, and asking would send a
    // null id to the server. Not an error — just no surface, and `loading` false so Home paints.
    if (userId === null || schoolId === null) {
      setSurface({ canBuy: false, hasBalance: false, loading: false, balance: null, allPacks: [] });
      return;
    }

    let cancelled = false;
    setSurface(ASKING);

    void (async () => {
      const answer = await api.fetchMealPackSurface(userId, schoolId);
      if (cancelled) return;

      // Only ask for the numbers when the server has said there are some. A parent with no pack
      // — the overwhelming majority — costs one request, not two.
      let balance: api.MealPackBalance | null = null;
      let allPacks: api.MealPackBalance[] = [];
      if (answer.hasBalance) {
        try {
          // One read for every pack. The one this order draws from is picked from that list by a
          // shared rule rather than a second query, so the cart and the balance screen cannot
          // name different packs.
          allPacks = await api.fetchMealPackBalances(userId);
          balance = api.packThisOrderDrawsFrom(allPacks, schoolId);
        } catch {
          /**
           * The surface stays, the numbers do not.
           *
           * `hasBalance` is the server's word that this parent is owed items, and a failed
           * numbers read is no reason to withdraw that. So the entry point still renders and the
           * screens show their own unavailable state — which is the honest one. Suppressing the
           * whole surface here would tell a parent they have no pack because a request failed.
           */
          balance = null;
          allPacks = [];
        }
      }
      if (cancelled) return;
      setSurface({ ...answer, balance, allPacks, loading: false });
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

/**
 * How many items this parent may actually spend on a new cart at the selected school.
 *
 * `itemsRemaining` is what they OWN; `itemsReserved` is what a checkout in flight has already
 * spoken for. The cart must offer the difference, or two tabs would each promise the same last
 * item and the second would be refused at the server with a `pack_coverage_changed` the parent
 * did not earn.
 */
export function spendableItems(surface: MealPackSurface): number {
  const pack = surface.balance;
  if (pack === null) return 0;
  return Math.max(0, pack.itemsRemaining - pack.itemsReserved);
}
