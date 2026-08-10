import { useOrderTarget, type OrderTarget } from './OrderTargetContext';
import { useSession } from './SessionContext';

/**
 * Who is holding the phone, and who they can order for — **as one answer, computed once.**
 *
 * ## The defect this exists to make impossible
 *
 * Home said "Add someone to place an order". The cart, at the same moment, showed a line for a
 * named child. Account offered a Sign in button. Three screens, three different beliefs about
 * one account, on one device, in one second.
 *
 * None of them was lying. Each derived the answer for itself: Home from `requiresSignIn`, the
 * cart from whether a target happened to be in memory, Account from the session alone — and
 * because `SessionContext` started `signedOut` and was never restored while the Supabase client
 * *did* restore its own persisted session, the two sources disagreed on every cold start. The
 * cart won its half of the argument by reading recipients successfully, and a child's first name
 * rendered on a phone the app itself considered unauthenticated. That is regulated data about a
 * minor displayed without a session (non-negotiable #4, DPDP tier P).
 *
 * Fixing the cart would have fixed the cart. The class is *seven call sites each deriving
 * session state independently*, which is six opportunities to drift.
 *
 * ## So: one derivation, and the states are mutually exclusive
 *
 * A screen switches on the variant. It cannot ask a follow-up question, because there is no
 * boolean to combine wrongly — the recipient is reachable **only** through the one variant that
 * carries proof of a session, so "render a name without a session" is not something a screen can
 * express, rather than something it must remember not to do.
 *
 * | Variant | Means | The screen's job |
 * |---|---|---|
 * | `unknown` | the stored session has not been read back yet | show neither answer — skeleton, or just the parts that do not depend on it |
 * | `visitor` | genuinely no session | browse freely (`AR7`); the only gate is checkout |
 * | `needsRecipient` | signed in, nobody to order for | route to Add someone |
 * | `ordering` | signed in, with a target | the full picture |
 *
 * ## `unknown` is not a loading spinner
 *
 * It is the window that produced the bug, and it is roughly one keychain read long. The
 * temptation is to fold it into `visitor` — "assume signed out, correct it when it resolves" —
 * and that is precisely the old behaviour: it makes a claim it has not checked, and every
 * downstream screen then renders a state that is about to be wrong. `AR7` is what makes this
 * cheap to get right: browsing needs no session, so the menu, search and dish detail render
 * fully during `unknown`. Only the four things that name a person wait.
 */
export type Audience =
  | { kind: 'unknown' }
  | { kind: 'visitor' }
  | { kind: 'needsRecipient'; userId: string }
  | { kind: 'ordering'; userId: string; target: OrderTarget };

export function useAudience(): Audience {
  const { status, userId } = useSession();
  const { target, hydrated } = useOrderTarget();

  if (status === 'unknown') return { kind: 'unknown' };
  if (status === 'signedOut' || userId === null) return { kind: 'visitor' };

  // Signed in, recipients not established yet. `hydrated` rather than `loading`, because
  // `loading` is also false in the gap between the session resolving and the read starting —
  // and in that gap the old code showed "Add someone" to a parent who has three children.
  if (!hydrated) return { kind: 'unknown' };

  if (target === null) return { kind: 'needsRecipient', userId };
  return { kind: 'ordering', userId, target };
}

/**
 * The recipient, or `null` — the **only** supported way to reach one from a screen.
 *
 * Reading `useOrderTarget().target` directly still works and is still correct inside the session
 * module, but a screen that does it is asserting there is a session without having checked, which
 * is the whole defect. `src/session/no-recipient-without-session.test.tsx` fails the build if a
 * screen imports the target context directly.
 */
export function useOrderingTarget(): OrderTarget | null {
  const audience = useAudience();
  return audience.kind === 'ordering' ? audience.target : null;
}

/**
 * Is a name, class, school or allergy safe to put on screen?
 *
 * True only for `ordering` — never during `unknown`, which is where the name leaked.
 */
export function mayShowRecipient(audience: Audience): boolean {
  return audience.kind === 'ordering';
}

/**
 * Where "Add someone to place an order" actually goes.
 *
 * **Sign-in first when there is no session**, because `create_recipient` requires one: the form
 * submits, the Edge Function rejects it, and the parent is left holding a filled-in form and an
 * error. Andy's words for it — sending someone to a form they cannot submit is the same defect as
 * a wall in front of the cart, pointing the other way.
 *
 * `unknown` returns `null`: the control is not offered yet, because we do not know which door it
 * should open.
 */
export function addRecipientRoute(audience: Audience): 'SignIn' | 'AddChild' | null {
  switch (audience.kind) {
    case 'unknown':
      return null;
    case 'visitor':
      return 'SignIn';
    case 'needsRecipient':
    case 'ordering':
      return 'AddChild';
  }
}

/**
 * Re-read the account's recipients, optionally selecting one — "I just added this person".
 *
 * Exposed here so that adding a child does not need the target context, which would put the
 * recipient itself back within reach of a screen. This hands back a function and no data.
 */
export function useRefreshRecipients(): (selectRecipientId?: string) => Promise<void> {
  return useOrderTarget().refresh;
}

/** The recipients this account can order for. Empty for a visitor — never a partial list. */
export function useRecipientChoices(): readonly OrderTarget[] {
  const { status } = useSession();
  const { choices } = useOrderTarget();
  return status === 'signedIn' ? choices : [];
}

/**
 * What the *chrome* of a screen needs to know — Home's card, Account's identity block, Orders'
 * empty state. Three values, one prop, and every screen that shows a signed-in/signed-out
 * difference takes this same one.
 *
 * **`pending` is why this is not a boolean.** Andy's Account screen offered a Sign in button
 * while the cart showed a child, because `signedOut` defaulted to `true` and a default is a
 * claim. A screen given `pending` shows neither door.
 */
export type Access = 'pending' | 'signedOut' | 'signedIn';

export function accessOf(audience: Audience): Access {
  switch (audience.kind) {
    case 'unknown':
      return 'pending';
    case 'visitor':
      return 'signedOut';
    case 'needsRecipient':
    case 'ordering':
      return 'signedIn';
  }
}

/** The same, straight from the session, for chrome that does not care about a recipient. */
export function useAccess(): Access {
  return accessOf(useAudience());
}
