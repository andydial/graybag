/**
 * The gate, applied — `E10-73`.
 *
 * `gate.ts` decides; this does it. Every back-office page begins by awaiting
 * `requireBackofficeAccess('/its/route')` and returning if it comes back `null`, which replaces
 * the `if (!(await currentUser())) location.assign('/signin?next=…')` each page carried
 * separately. That check asked *"is anyone signed in"*; this asks *"may this person be here"*,
 * which is the question the screenshot on 2026-09-02 showed we had never asked.
 *
 * It is split from `gate.ts` so the decision can be tested without a browser: everything here
 * touches `location`, `document` or the session, and none of it makes a judgement.
 */
import { api } from '@graybag/shared';

import {
  decideAccess,
  deniedSignInUrl,
  signInUrlFor,
  type GateOutcome,
} from './gate.js';
import { configureBackofficeApi, currentUser, signOut } from './session.js';

/**
 * Replace the page with a message, keeping `.bo` so back-office CSS still applies.
 *
 * The sidebar is **not** kept. A frame with four group headings and no links is the disclosure
 * this task exists to remove, and it is the last thing to leave up while explaining that
 * something went wrong.
 */
function takeOver(heading: string, body: string): void {
  document.body.innerHTML =
    `<div class="bo"><div class="bo__main"><div class="bo__scroll"><div class="pad">` +
      `<div class="empty" role="status">` +
        `<h3></h3><p></p>` +
      `</div>` +
    `</div></div></div></div>`;
  // Written as text, never as markup: neither string is attacker-controlled today and neither
  // needs to be tomorrow.
  document.querySelector('.empty h3')!.textContent = heading;
  document.querySelector('.empty p')!.textContent = body;
}

/** Carry out what `decideAccess` decided. Exported for tests; pages call the wrapper below. */
export async function applyOutcome(outcome: GateOutcome, path: string): Promise<void> {
  switch (outcome.kind) {
    case 'sign-in':
      location.assign(signInUrlFor(path));
      return;
    case 'no-access':
      // Signed out **before** the redirect, or `/signin` sends them straight back here.
      await signOut().catch(() => undefined);
      location.assign(deniedSignInUrl());
      return;
    case 'wrong-screen':
      location.assign(outcome.to);
      return;
    case 'unknown':
      takeOver(
        'We could not check your access',
        'Nothing is shown until we can. Check your connection and reload the page.',
      );
      return;
    case 'allow':
      return;
  }
}

/**
 * Let this page render, or send the reader somewhere honest.
 *
 * Returns the capabilities on success so the page can gate its own controls without a second
 * round trip, and `null` when the page must not render — in which case it has already either
 * navigated away or replaced itself.
 *
 * `path` is the route as `NAV` spells it (`/orders`, `/admin/people`), not `location.pathname`:
 * the static build emits `/orders.html`, and a gate that matched on the file name would open
 * every screen the moment the build format changed.
 */
export async function requireBackofficeAccess(path: string): Promise<api.Capabilities | null> {
  configureBackofficeApi();

  // A session read that throws is a build that cannot reach Supabase at all. Treating it as
  // "signed out" sends them to `/signin`, which says so properly — that page is the one place
  // built to explain a misconfigured back office.
  const user = await currentUser().catch(() => null);

  const caps = user ? await api.fetchMyCapabilities().catch(() => null) : null;

  const outcome = decideAccess({ signedIn: user !== null, caps, path });
  await applyOutcome(outcome, path);
  return outcome.kind === 'allow' ? outcome.caps : null;
}
