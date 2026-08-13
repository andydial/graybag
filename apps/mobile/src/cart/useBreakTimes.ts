import { useEffect, useState } from 'react';
import { api } from '@graybag/shared';

/**
 * The school's orderable break windows — `E05-30`, `P19`.
 *
 * `undefined` while unread, `[]` when the school has none. **The two are not the same**, and
 * that is the whole reason this returns a nullable rather than defaulting to an empty array:
 * `[]` means "this school cannot take orders", which disables Place order and shows a notice.
 * A loading state that rendered as `[]` would tell every parent their school was closed for
 * the first few hundred milliseconds.
 *
 * Readable signed out (`0027`), so a visitor learns a school cannot take orders before they
 * build a cart rather than after signing in.
 *
 * A failed read leaves it `undefined` rather than `[]`, for the same reason: we do not know, so
 * we do not claim the school is closed. Checkout is blocked anyway — the server requires a
 * break window — so failing this way costs a parent a retry rather than an incorrect refusal.
 */
export function useBreakTimes(schoolId: string | null): readonly api.BreakTime[] | undefined {
  const [windows, setWindows] = useState<readonly api.BreakTime[] | undefined>(undefined);

  useEffect(() => {
    if (schoolId === null) {
      setWindows(undefined);
      return;
    }
    let cancelled = false;
    setWindows(undefined);

    api
      .fetchBreakTimes(schoolId)
      .then((next) => {
        if (!cancelled) setWindows(next);
      })
      .catch(() => {
        // Deliberately not `[]`. See the note above: "we could not ask" must never render as
        // "this school is closed".
        if (!cancelled) setWindows(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  return windows;
}
