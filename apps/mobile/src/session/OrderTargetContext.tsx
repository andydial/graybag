import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, time, type menu as menuDomain } from '@graybag/shared';

import { useSession } from './SessionContext';

/**
 * Who a lunch is being ordered for, and for which day.
 *
 * **Separate from `SessionContext` and from `SelectedSchoolContext`, for the same reason
 * they are separate from each other** (`AR7`): browsing must work before any of this is
 * known. A dish detail screen renders identically with a target and without one — the target
 * only decides whether a line can be *added*, because a cart line is identified by who and
 * when as well as what (`lineKey`).
 *
 * **`null` is the ordinary state today**, not a bug. Nothing in the app can name a child yet
 * — `E05-16` is the task, and `E05-01`/`E05-03` are what fill this in. The default context
 * value is `null` so a screen written against this seam behaves correctly before that lands
 * rather than after it, and so a provider is not required in order to render.
 *
 * ## The allergen ids are regulated data
 *
 * `allergenIds` is health data about a minor under the DPDP Act (non-negotiable #4). It is
 * held here so the add-to-cart warning (`D7`, `E05-05`) can be computed on the device
 * without a request. It must never be logged, never sent to Sentry or analytics, and never
 * appear in an error message — which is why nothing in this module or its consumers prints
 * it, including in the sheet, which names the *dish's* allergens rather than the child's.
 */
export interface OrderTarget {
  recipientId: string;
  /**
   * The recipient's declared allergen ids — **or `null`, meaning we have not read them.**
   *
   * Regulated (see above). The nullable is the important part and it is not defensive
   * typing: `fetchRecipients` deliberately does not return allergy data, so the ordinary
   * state today is "we hold a recipient and we do not know their allergies".
   *
   * An empty array and `null` are different claims. `[]` says *we asked and there are none*,
   * which is a safety statement. `null` says *we cannot tell you*, which is the honest one
   * until `E05-31` lands. Collapsing the two would turn "we did not look" into "you are
   * safe" — the §5.21 failure in the place it costs most.
   */
  allergenIds: readonly string[] | null;
  serviceDate: menuDomain.ServiceDate;
  /**
   * What to call them on screen. `null` for an adult ordering for themselves, which renders
   * as "You" rather than as a name (`P13`).
   *
   * Tier P (§13.3): displayed, never logged.
   */
  displayName?: string | null;
  /** "5-A". Tier P. */
  classLabel?: string | null;
  schoolName?: string | null;
  /**
   * The school this recipient attends.
   *
   * **This is what makes the selected school derived rather than independent.** Before it
   * existed, `SelectedSchoolContext` and the order target were two separate answers to
   * "which school are we ordering from", and they drifted: a visitor could pick a school,
   * add a child at that school, and land back on Home with no school selected — the same
   * fact asked twice and neither answer kept.
   */
  schoolId?: string | null;
  /** "Morning break · 10:40". Absent until `E05-29` puts the break on the line. */
  breakLabel?: string | null;
}

interface OrderTargetValue {
  target: OrderTarget | null;
  setTarget: (next: OrderTarget | null) => void;
  /** Recipients this account can order for, for the switcher. Empty until one is added. */
  choices: OrderTarget[];
  /** True while the first read is in flight, so a screen can skeleton rather than say "none". */
  loading: boolean;
  /**
   * Re-read the account's recipients, optionally selecting one afterwards.
   *
   * Adding someone has to be able to say "and now order for them". Without this the provider
   * read once at mount and never again, so a recipient added at 9am was invisible until the
   * app was restarted — and the flow ended on Home with nothing selected.
   */
  refresh: (selectRecipientId?: string) => Promise<void>;
  /**
   * Has the account's recipient list been established yet?
   *
   * **Distinct from `loading`, and the distinction is a flash of the wrong screen.** `loading`
   * is false before the first read starts as well as after it finishes, so a signed-in parent
   * with three children on the account rendered `target === null` for a frame and Home offered
   * "Add someone" — a form they did not need, for children they already have.
   *
   * False until the first read resolves, or until the target is cleared for a signed-out user.
   */
  hydrated: boolean;
}

const OrderTargetContext = createContext<OrderTargetValue>({
  target: null,
  setTarget: () => {},
  choices: [],
  loading: false,
  refresh: async () => {},
  hydrated: false,
});

/**
 * The service date a cart line defaults to.
 *
 * **Tomorrow in India, not today** (`E05-49`). The cutoff for a given day is 00:00 that morning
 * (`D5`, `C5`), so today is never orderable under the default configuration — offering it would
 * put every first-time visitor in front of a refusal. `E05-30`'s calendar read replaces this with
 * the real next orderable day, including school holidays and per-kitchen cutoffs.
 *
 * This used to add 24 hours to `Date.now()` and read the **UTC** date, so between 00:00 and 05:30
 * IST it returned *today* — a day whose cutoff had already passed. A parent opening the app at 5am
 * was offered a date they could not order for, and found out at the end of the cart.
 *
 * `now` is a parameter because a function that reads the clock itself is only testable at
 * whatever time the suite happens to run, and the broken window is five and a half hours out of
 * twenty-four.
 */
function defaultServiceDate(now: Date = new Date()): menuDomain.ServiceDate {
  return time.defaultServiceDateInIndia(now) as menuDomain.ServiceDate;
}

export function OrderTargetProvider({
  children,
  initial = null,
}: {
  children: ReactNode;
  initial?: OrderTarget | null;
}) {
  const { status, userId } = useSession();
  const [target, setTarget] = useState<OrderTarget | null>(initial);
  const [choices, setChoices] = useState<OrderTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  /**
   * Read who this account can order for, and pick one.
   *
   * **Nothing called `setTarget` before this.** The type existed, the provider existed, every
   * screen read it — and no code path ever wrote it, so `target` was `null` in every build and
   * Home's card could not say who it was ordering for. The same shape as the menu cache that
   * was never installed: both sides written, the wire between them missing, and every test
   * green because each side substitutes the other.
   *
   * **Callers must not invoke this without a session.** The old comment here claimed "signed
   * out this does nothing, which is correct rather than a special case" — and that was the
   * defect. It does nothing only when the read *fails*. The Supabase client persists its own
   * session to the keychain, so after a restart this read succeeded and returned a real child
   * while the app believed nobody was signed in. A first name rendered on a phone the app
   * itself considered unauthenticated.
   *
   * The mount effect below now gates on the session, and clears rather than keeps.
   */
  const refresh = useCallback(async (selectRecipientId?: string) => {
    setLoading(true);
    try {
      const rows = await api.fetchRecipients();
      const mapped: OrderTarget[] = rows
        .filter((row) => row.canOrder)
        .map((row) => ({
          recipientId: row.id,
          // NOT `[]`. We have not read their allergies — `fetchRecipients` does not return
          // them — and saying "none" would be a safety claim we cannot support (`E05-31`).
          allergenIds: null,
          serviceDate: defaultServiceDate(),
          displayName: row.firstName,
          classLabel: [row.classLabel, row.sectionLabel].filter(Boolean).join('-') || null,
          schoolName: row.schoolName || null,
          schoolId: row.schoolId || null,
          breakLabel: null,
        }));

      setChoices(mapped);

      /**
       * Load the selected recipient's allergens — `E05-31`, and the reason F5 was divergent.
       *
       * **Only for the one being ordered for**, and only after they are chosen. Tier S health
       * data about a minor is read when there is a reason to read it, never speculatively for
       * everyone on the account.
       *
       * A failure leaves `allergenIds` as `null`, which is "we cannot check" rather than "no
       * allergies" — the distinction the whole three-state design exists for. It is not
       * logged: the error would carry a recipient id.
       */
      const withAllergens = async (next: OrderTarget | null): Promise<OrderTarget | null> => {
        if (next === null) return null;
        try {
          const allergenIds = await api.fetchRecipientAllergens(next.recipientId);
          return { ...next, allergenIds };
        } catch {
          return next;
        }
      };

      setTarget((current) => {
        // An explicit request wins — that is "I just added this person, order for them".
        if (selectRecipientId !== undefined) {
          return mapped.find((m) => m.recipientId === selectRecipientId) ?? current;
        }
        // Otherwise only auto-select when nothing is chosen, so a later read cannot silently
        // move an order onto a different person mid-cart.
        return current ?? mapped[0] ?? null;
      });

      // Resolve allergens for whoever ended up selected. Done after `setTarget` so the name
      // and school appear immediately and the health read does not hold up the screen.
      const selected =
        selectRecipientId !== undefined
          ? mapped.find((m) => m.recipientId === selectRecipientId)
          : mapped[0];
      if (selected !== undefined) {
        const resolved = await withAllergens(selected);
        if (resolved !== null) {
          // Only if the same person is still selected — a switch mid-flight must not have
          // someone else's allergen list land on them.
          setTarget((current) =>
            current?.recipientId === resolved.recipientId ? resolved : current,
          );
        }
      }
    } catch {
      // Signed out, offline, or a failed read. All three mean "we cannot say", and none is an
      // error a browsing visitor should see. Nothing is logged: a failure here would carry
      // recipient ids, and ids about children stay out of logs (R6).
      setChoices([]);
    } finally {
      setLoading(false);
      setHydrated(true);
    }
  }, []);

  /**
   * The target is **derived from the session**, never independent of it.
   *
   * Three states, and the middle one is the one that was missing:
   *
   * - `unknown` — the stored session has not been read back yet. Hold everything. Reading
   *   recipients here is what produced a child's name with no session; showing "add someone"
   *   is what made Home disagree with the cart. Neither answer is available yet, so give
   *   neither.
   * - `signedOut` — **clear**, do not merely stop fetching. A target left in state from before
   *   a sign-out is a persisted reference to a minor, and it will render (R6, non-negotiable
   *   #4). Sign-out must empty it in the same tick.
   * - `signedIn` — read, for this user.
   *
   * Keyed on `userId` so signing in as somebody else re-reads rather than inheriting the
   * previous account's children.
   */
  useEffect(() => {
    if (status === 'unknown') return;
    if (status === 'signedOut') {
      setTarget(null);
      setChoices([]);
      setLoading(false);
      setHydrated(true);
      return;
    }
    void refresh();
  }, [status, userId, refresh]);

  const value = useMemo(
    () => ({ target, setTarget, choices, loading, refresh, hydrated }),
    [target, choices, loading, refresh, hydrated],
  );
  return <OrderTargetContext.Provider value={value}>{children}</OrderTargetContext.Provider>;
}

export function useOrderTarget(): OrderTargetValue {
  return useContext(OrderTargetContext);
}
