/**
 * Who may be in the back office at all — `E10-73`.
 *
 * Andy, 2026-09-02, looking at `/dashboard` signed in as an account holding nothing:
 *
 * > *"They should not even see what sections are present if they have no access to it. Rather I
 * > would enforce that if they have no privileges assigned — they should NOT be able to login
 * > into the web backend at all. Other employees (kitchen) can't know that we track reports,
 * > access, even revenue using this web dashboard."*
 *
 * ## What was wrong
 *
 * Signing in and being *told what you cannot see* is a disclosure. The account in the screenshot
 * held no grant at all and was shown four cards reading "Needs `orders.view`", "Needs
 * `orders.view_financials`", "Needs `meal_packs.manage`", "Needs `menu.edit` or `school.edit`",
 * and a heading reading "Kitchen, right now". That is the shape of the whole system — that we
 * track revenue, that packs are a thing we sell, that permissions are named and separable —
 * handed to anyone who can receive an email at an address with an account.
 *
 * And the account existed at all because sign-up is open by design: `signInWithOtp` creates the
 * account, because the same code path is how a **parent** signs up (`U1`). So "has an account"
 * has never meant "works here", and the back office was treating it as though it did.
 *
 * `nav.ts` already had the right instinct — *"unreachable items are omitted, not disabled"* —
 * and then `noAccessReason` softened it for the empty case, on the reasoning that an empty shell
 * looks broken. That reasoning is right for somebody who *belongs here* and is waiting on a
 * grant. It is wrong as the answer to a stranger, and we cannot tell the two apart, so the answer
 * has to be the safe one: **no session, no shell, no vocabulary.**
 *
 * ## The rule
 *
 * Access to the back office is *reaching at least one screen*. Not "holding a grant" — a person
 * holding only `orders.view_pii` can open nothing, and a back office that admits them shows them
 * a frame and no contents, which is the same disclosure in a smaller size. `visibleNav` already
 * answers exactly this question and is the one place that knows about the owner (`E02-39`), who
 * holds no rows and may do everything.
 *
 * ## This is a second lock, not the lock
 *
 * RLS is the control and always was: a stranger with a session could read nothing, which is why
 * every card said "Needs …" rather than showing a number. Nothing here makes the data safer. It
 * makes the *product* stop describing itself to people who have no business reading the
 * description — and it closes the door rather than papering a sign over it.
 *
 * Everything below `decideAccess` is deliberately pure so it can be tested without a browser;
 * `requireBackofficeAccess` is the thin layer that actually redirects.
 */
import type { api } from '@graybag/shared';

import { NAV, visibleNav, type Grant, type NavItem, type Operator } from './nav.js';

/** `Capabilities` as an `Operator`, which is what `nav.ts` reasons about. */
export function operatorOf(caps: api.Capabilities): Operator {
  return {
    name: '',
    grants: new Set(caps.codes as readonly Grant[]),
    isOwner: caps.isOwner,
  };
}

/** Every screen this account may open. Empty means they have no business being signed in. */
export function reachable(caps: api.Capabilities): NavItem[] {
  return visibleNav(operatorOf(caps));
}

/**
 * May this account be in the back office at all?
 *
 * Reaching one screen, not holding one grant — see the note above on `orders.view_pii`.
 */
export function hasBackofficeAccess(caps: api.Capabilities): boolean {
  return reachable(caps).length > 0;
}

/**
 * May this account open *this* route?
 *
 * A route with no `NAV` entry — `/dashboard` — is open to anybody who may be here at all: it is
 * the landing page, and it is built entirely from what the reader can reach.
 */
export function mayOpen(path: string, caps: api.Capabilities): boolean {
  if (!hasBackofficeAccess(caps)) return false;
  const item = NAV.find((entry) => entry.href === path);
  if (!item) return true;
  return reachable(caps).some((entry) => entry.href === item.href);
}

export type GateOutcome =
  /** Signed in, and this screen is theirs. */
  | { kind: 'allow'; caps: api.Capabilities }
  /** No session. Send them to sign in, and come back here afterwards. */
  | { kind: 'sign-in' }
  /**
   * Signed in and reaches nothing. **Sign them out**, then say so on `/signin`.
   *
   * The sign-out is what stops this looping: `/signin` sends an already-signed-in visitor
   * straight back to where they came from, so a redirect that left the session intact would
   * bounce between the two forever.
   */
  | { kind: 'no-access' }
  /** They belong here, but not on this screen. Their own landing page instead. */
  | { kind: 'wrong-screen'; to: string }
  /**
   * Their access could not be read.
   *
   * **Not** a sign-out and not a redirect: a dropped connection is not a revocation, and
   * throwing somebody out of a shared kitchen tablet because the network blinked is its own
   * outage. The page renders nothing and says to try again — fail closed, stay put.
   */
  | { kind: 'unknown' };

/**
 * The whole decision, with no browser in it.
 *
 * `caps === null` means the read failed, which is different from a read that came back empty:
 * the first is "we do not know" and the second is "we know, and it is nothing".
 */
export function decideAccess(input: {
  signedIn: boolean;
  caps: api.Capabilities | null;
  path: string;
}): GateOutcome {
  if (!input.signedIn) return { kind: 'sign-in' };
  if (input.caps === null) return { kind: 'unknown' };
  if (!hasBackofficeAccess(input.caps)) return { kind: 'no-access' };
  if (!mayOpen(input.path, input.caps)) return { kind: 'wrong-screen', to: LANDING };
  return { kind: 'allow', caps: input.caps };
}

/** Where somebody who may be here lands. Correct for every account, because it is derived. */
export const LANDING = '/dashboard';

/**
 * What `/signin` says to an account that holds nothing.
 *
 * Deliberately says nothing about what the back office contains, what a grant is called, or who
 * to ask beyond "the person who administers it" — the reader may be a stranger. It does say the
 * account itself is fine, because the common case is a parent who typed the wrong URL.
 */
export const NO_ACCESS_MESSAGE =
  'This account does not have back-office access. If you are a GrayBag parent, the app is where ' +
  'you order. If you work here, ask whoever administers your access.';

/* ------------------------------------------------------------------ the browser half */

const DENIED_PARAM = 'denied';

/** `/signin?denied=1`. Nothing about the account is in the URL. */
export const deniedSignInUrl = (): string => `/signin?${DENIED_PARAM}=1`;

export const wasDenied = (search: string): boolean =>
  new URLSearchParams(search).has(DENIED_PARAM);

export const signInUrlFor = (path: string): string =>
  `/signin?next=${encodeURIComponent(path)}`;
