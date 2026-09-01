import { useCallback, useEffect, useState } from 'react';
import { api, ordering } from '@graybag/shared';

/**
 * The days this school can deliver on — `E05-52`.
 *
 * ## Why the cart asks the server rather than working it out
 *
 * Service days, cutoffs and the advance window all live in config a parent cannot read, and the
 * authoritative refusal is `assert_cutoff_open` inside the checkout transaction. A client that
 * recomputed any part of it would eventually disagree with that guard, and the disagreement
 * always surfaces the same way: a parent choosing a day and being refused after they choose.
 * That is the failure this whole ticket exists to remove.
 *
 * ## Three states, not two
 *
 * `unavailable` is separate from an empty list on purpose. Before `E05-52` the calendar returned
 * **404 to every parent**, and a hook that reported that as "no days" would have told a parent
 * their school had stopped serving. §5.21: a failed read must never render as a confident fact.
 *
 * A signed-out visitor also lands here — `orderable_calendar` refuses them, correctly, because
 * they have no child at any school. `CartScreen` only renders the picker once a recipient has
 * resolved, so that refusal never reaches a screen.
 */
export interface OrderableDaysState {
  days: readonly ordering.OrderableDayView[];
  unavailable: boolean;
  reload: () => void;
}

/** Two weeks. Long enough to plan a fortnight, short enough to stay one small response. */
const HORIZON_DAYS = 14;

export function useOrderableDays(schoolId: string | null): OrderableDaysState {
  const [days, setDays] = useState<readonly ordering.OrderableDayView[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (schoolId === null) {
      setDays([]);
      setUnavailable(false);
      return undefined;
    }

    let live = true;
    // Reset first: while a new school's calendar is in flight, the previous school's days are
    // wrong rather than merely stale, and offering them would be offering a day this school may
    // not serve. Same reasoning as `useRecipientWatchlist` resetting between children.
    setDays([]);
    setUnavailable(false);

    const from = today();
    const to = plusDays(from, HORIZON_DAYS);

    api
      .fetchOrderableDays({ schoolId, from, to })
      .then((rows) => {
        if (!live) return;
        setDays(rows);
        setUnavailable(false);
      })
      .catch(() => {
        // Not logged: the failure carries a school id and nothing personal, but the habit is what
        // keeps recipient ids out of logs elsewhere.
        if (!live) return;
        setDays([]);
        setUnavailable(true);
      });

    return () => {
      live = false;
    };
  }, [schoolId, nonce]);

  return { days, unavailable, reload };
}

/**
 * Today and today+n as `YYYY-MM-DD`, in UTC.
 *
 * A service date is a calendar day, not an instant. The server decides which of these days are
 * orderable; this only has to name the window, and naming it in the device's zone is how
 * `defaultServiceDate` shipped an off-by-one for anyone west of Greenwich.
 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
