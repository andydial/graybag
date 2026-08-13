/**
 * The account holder's own name — `P18`, `E05-39`.
 *
 * ## Order one has no name, and that has to be fine everywhere
 *
 * Andy's instruction when he settled `P18`, in his words: **order one has no name and that must
 * be fine everywhere** — invoice, packing list, support, every email. Anything that looks
 * broken without it is a defect to report, not a reason to make the field required.
 *
 * So nothing in this module is a precondition for anything. `fetchProfile` returning a null
 * name is the ordinary case, not a loading state and not an error, and every caller is expected
 * to have an answer for it that is not "ask again".
 *
 * ## Asked after payment, not at checkout
 *
 * `P18`, Andy 2026-08-11, overruling both of my proposals (checkout, and the OTP success
 * moment). Checkout is the most fragile screen in the funnel and the one place friction is paid
 * for in lost orders; on the confirmation screen the money is taken, the parent is pleased, and
 * they are doing nothing.
 *
 * ## Asked once
 *
 * `shouldAskForName` is the whole rule, and it is deliberately in one place rather than
 * re-derived per screen: **a name we do not have, and a question we have not yet asked.** A
 * skip is recorded server-side (`app_user.name_prompted_at`, migration `0030`) because the same
 * account on a second phone is the same person who already declined.
 *
 * ## A name is personal data
 *
 * Tier A (§13.3) — less regulated than a child's, and still not something to log. Nothing in
 * this file has a `console` call, and the errors it raises carry a code rather than a value.
 */
import { currentUser } from './auth.js';
import { runQuery, invokeFunction } from './client.js';

export interface Profile {
  /** Null until they tell us, which may be never. Not a gap to fill — see the header. */
  firstName: string | null;
  lastName: string | null;
  /**
   * Whether the question has been put to them — **including a skip**. Null means never asked.
   *
   * ISO 8601 as PostgREST renders a `timestamptz`. Kept as the string rather than a `Date`
   * because nothing needs to do arithmetic on it: the only question anyone asks is whether it
   * is null.
   */
  namePromptedAt: string | null;
}

/** Raised when the backend returns a profile that is not the agreed shape. */
export class ProfilePayloadError extends Error {
  constructor(detail: string) {
    super(`The account details are not usable: ${detail}`);
    this.name = 'ProfilePayloadError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const textOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

/**
 * Exactly what may leave `app_user`.
 *
 * **The column list is the redaction**, the same rule `RECIPIENT_COLUMNS` and `SCHOOL_COLUMNS`
 * follow. `app_user` is the widest row in the schema about a person — `phone_e164`,
 * `is_disabled`, `disabled_reason`, `deleted_at`, `migration_source` — and a `select('*')` here
 * would hand a screen that wants a first name a record of whether the account has been
 * suspended and why. RLS filters rows; it has never filtered columns.
 */
export const PROFILE_COLUMNS = 'first_name,last_name,name_prompted_at';

/**
 * The signed-in account holder's own details.
 *
 * Signed out this is `null` rather than a throw, exactly as `fetchRecipients` returns an empty
 * list: there is no account to describe, which is an answer.
 */
export async function fetchProfile(): Promise<Profile | null> {
  const user = await currentUser();
  if (user === null) return null;

  const rows = await runQuery<unknown>((t) =>
    t
      .from('app_user')
      .select(PROFILE_COLUMNS)
      // Filtered as well as policed. `app_user_read_admin` (`0002`) also admits other people's
      // rows to a platform admin, so without this an admin reading their own profile would get
      // every user in the system and this function would return whichever came first.
      .eq('id', user.userId),
  );

  const row = rows[0];
  // No row is not a bad payload: `0018` creates `app_user` on signup, but a session that
  // outlived a deleted account is a real state and it is not this module's to report as
  // corruption. It reads as "no name", which is the case every caller already handles.
  if (row === undefined) return null;
  if (!isRecord(row)) throw new ProfilePayloadError('the account row is not an object');

  return {
    firstName: textOrNull(row.first_name),
    lastName: textOrNull(row.last_name),
    namePromptedAt: textOrNull(row.name_prompted_at),
  };
}

/**
 * Whether to put the question in front of them at all.
 *
 * Two conditions, and both are load-bearing: **we do not have a name**, and **we have not
 * asked**. Dropping the second turns an optional field into a nag that returns on every order;
 * dropping the first asks somebody for a name we are already printing on their invoice.
 *
 * A missing profile (signed out, or no row) is `false`. There is nobody to ask.
 */
export function shouldAskForName(profile: Profile | null): boolean {
  if (profile === null) return false;
  return profile.firstName === null && profile.namePromptedAt === null;
}

/**
 * "What should we call you?" — answered.
 *
 * A write, so it goes through the Edge Function (`A4`, non-negotiable #1) even though
 * `app_user_update_self` has permitted this write since `0002`. The rule is what keeps a
 * dedicated API server a config change rather than a rewrite, and a name field is exactly the
 * small obviously-safe write that erodes it one exception at a time.
 *
 * Recording that they answered is part of the same call, not a second one: a network failure
 * between two requests would leave us asking again for a name we already hold.
 */
export async function setUserName(input: {
  firstName: string;
  lastName?: string | null;
}): Promise<{ firstName: string | null; lastName: string | null }> {
  const data = await invokeFunction<Record<string, unknown>>(
    'account',
    {
      first_name: input.firstName,
      last_name: input.lastName ?? null,
    },
    'PATCH',
  );

  return {
    firstName: textOrNull(data.first_name),
    lastName: textOrNull(data.last_name),
  };
}

/**
 * "Not now."
 *
 * Its own call rather than `setUserName('')`, because a skip and an empty field are different
 * intentions and one call meaning both would eventually be sent by a form somebody tabbed past.
 *
 * **The screen must not wait for it.** Skipping is the parent saying they are done; making them
 * watch a spinner to decline a question would be worse than the question. Callers dismiss
 * immediately and let this settle behind them — the cost of it failing is being asked once
 * more, which is the state they were already in.
 */
export async function skipNamePrompt(): Promise<void> {
  await invokeFunction<Record<string, unknown>>('account', { skip_name_prompt: true }, 'PATCH');
}

/**
 * Take it back.
 *
 * `P18` says order one has no name and that must be fine everywhere, which makes a name a thing
 * a person may give and then remove. An edit form that refused an empty field would be claiming
 * we need it after we told them we do not.
 *
 * A flag rather than `setUserName('')`, because the server refuses a blank first name on
 * purpose — otherwise a form somebody tabbed past would be indistinguishable from a deliberate
 * removal. **`name_prompted_at` is untouched**: they have been asked, and clearing the name is
 * not a request to be asked again on the next order.
 */
export async function clearUserName(): Promise<void> {
  await invokeFunction<Record<string, unknown>>('account', { clear_name: true }, 'PATCH');
}
