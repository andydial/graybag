import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@graybag/shared';

import { useMealPackSurface } from './MealPackSurfaceContext';
import { useSelectedSchool } from '../session/SelectedSchoolContext';

/** What a parent has chosen for one day. */
export interface PlannedEntry {
  recipientId: string;
  dishIds: string[];
}

export interface PlannerValue {
  /** The days the school can be ordered for, straight from `order-calendar`. */
  days: readonly api.OrderableDay[];
  /** True until the first calendar answer arrives. */
  loadingDays: boolean;
  /** True when the calendar read failed — distinct from "there are no days". */
  daysUnavailable: boolean;
  /** Date → what is chosen for it. */
  plan: Readonly<Record<string, PlannedEntry>>;
  /** Add or replace a day's selection. */
  setDay: (date: string, entry: PlannedEntry) => void;
  /** Remove a day from the plan entirely. */
  clearDay: (date: string) => void;
  reloadDays: () => void;
}

const EMPTY: PlannerValue = {
  days: [],
  loadingDays: true,
  daysUnavailable: false,
  plan: {},
  setDay: () => {},
  clearDay: () => {},
  reloadDays: () => {},
};

const Ctx = createContext<PlannerValue>(EMPTY);

/**
 * The plan a parent is building. `E21-44`.
 *
 * ## Why the plan is a context and not screen state
 *
 * **Two screens edit it.** The day list adds and removes days; the per-day picker chooses the
 * items for one. Held in either, the other would need a copy — and two copies of "what has this
 * parent chosen" is exactly the shape that produces a confirm sending something the parent never
 * saw. `PlanDay` therefore takes only a date as a param and reads the rest from here.
 *
 * ## The calendar is fetched once, here
 *
 * `order-calendar` has existed since `E05` and had **no caller at all**; this is its first. A
 * pack-specific calendar would have meant two implementations of "which days can this school be
 * ordered for", and the uncalled one would have been the one that drifted.
 *
 * The range stops at the pack's expiry: a day the pack cannot cover is not a day to offer, and it
 * is a smaller response on a school-gate connection.
 *
 * ## A failed calendar read is not an empty calendar
 *
 * `daysUnavailable` exists so the planner can say "we could not load the days" rather than
 * "there are no days" — §5.21, the distinction that cost three hours on the menu.
 */
export function PlannerProvider({ children }: { children: ReactNode }) {
  const { schoolId } = useSelectedSchool();
  const surface = useMealPackSurface();
  const expiresOn = surface.balance?.expiresAt?.slice(0, 10) ?? null;

  const [days, setDays] = useState<readonly api.OrderableDay[]>([]);
  const [loadingDays, setLoadingDays] = useState(true);
  const [daysUnavailable, setDaysUnavailable] = useState(false);
  const [plan, setPlan] = useState<Record<string, PlannedEntry>>({});
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (schoolId === null || expiresOn === null) {
      setDays([]);
      setLoadingDays(false);
      return;
    }
    let cancelled = false;
    setLoadingDays(true);
    setDaysUnavailable(false);

    const from = new Date().toISOString().slice(0, 10);
    const to = expiresOn < from ? from : expiresOn;

    void (async () => {
      try {
        const calendar = await api.fetchOrderableDays({ schoolId, from, to });
        if (cancelled) return;
        setDays(calendar);
      } catch {
        if (cancelled) return;
        setDays([]);
        setDaysUnavailable(true);
      } finally {
        if (!cancelled) setLoadingDays(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [schoolId, expiresOn, reloadToken]);

  const setDay = useCallback((date: string, entry: PlannedEntry) => {
    setPlan((current) => ({ ...current, [date]: entry }));
  }, []);

  const clearDay = useCallback((date: string) => {
    setPlan((current) => {
      const next = { ...current };
      delete next[date];
      return next;
    });
  }, []);

  const reloadDays = useCallback(() => setReloadToken((n) => n + 1), []);

  const value = useMemo(
    () => ({ days, loadingDays, daysUnavailable, plan, setDay, clearDay, reloadDays }),
    [days, loadingDays, daysUnavailable, plan, setDay, clearDay, reloadDays],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlanner(): PlannerValue {
  return useContext(Ctx);
}
