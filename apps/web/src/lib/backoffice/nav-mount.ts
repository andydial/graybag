/**
 * Wire up the back-office navigation bar — `E10-43`.
 *
 * Reveals the routes this operator may reach, names the account, and signs them out. Rendering is
 * in `BackofficeNav.astro`; this is only the part that needs to know who is asking.
 *
 * ## Everything starts hidden
 *
 * The bar ships with every item `hidden` and this module removes the attribute from the ones the
 * operator holds the grants for. Doing it the other way — render all, hide the forbidden — flashes
 * the full list of screens at somebody who may open one of them, on every page load, for as long
 * as the grants take to arrive.
 *
 * If this module never runs the navigation stays empty rather than showing everything. That is the
 * safe direction, and it is the one `E12-36` argued for the other way on the marketing site: there,
 * a script that failed had to leave the copy readable; here, a script that fails must not advertise
 * the shape of the system. Same principle — fail toward the harmless state — opposite result.
 */
import { api } from '@graybag/shared';

import { NAV, noAccessReason, type Grant, type Operator } from './nav.js';
import { currentUser, signOut } from './session.js';

const $ = <T extends HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);

/**
 * Reveal the items whose every required grant is held.
 *
 * Reads the requirement from the DOM rather than re-deriving it, so the markup and the decision
 * cannot disagree — the attribute was written from the same `NAV` entry that produced the link.
 */
function reveal(held: ReadonlySet<string>): number {
  let shown = 0;
  for (const item of document.querySelectorAll<HTMLElement>('[data-nav-item]')) {
    const requires = (item.dataset.requires ?? '').split(' ').filter(Boolean);
    if (requires.every((grant) => held.has(grant))) {
      item.hidden = false;
      shown += 1;
    }
  }
  return shown;
}

/**
 * Say why the bar is empty, when it is.
 *
 * An account with no grants is a real state — somebody created before anyone assigned their
 * permissions — and an empty bar with no explanation reads as a broken page. `noAccessReason`
 * already distinguishes "no grants at all" from "grants that open no screen", because those need
 * different things done about them.
 */
function explainEmpty(held: ReadonlySet<string>): void {
  const panel = $<HTMLElement>('[data-bonav-panel]');
  if (!panel) return;
  const operator: Operator = { name: '', grants: held as ReadonlySet<Grant> };
  const reason = noAccessReason(operator);
  if (!reason) return;
  const note = document.createElement('p');
  note.className = 'bonav__empty';
  note.textContent = reason;
  panel.prepend(note);
}

export async function mountNav(): Promise<void> {
  const toggle = $<HTMLButtonElement>('#bonav-toggle');
  const panel = $<HTMLElement>('[data-bonav-panel]');

  if (toggle && panel) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      panel.classList.toggle('is-open', !open);
    });
    // Escape closes it, and focus goes back to the control that opened it — otherwise a keyboard
    // user who dismisses the panel is left at the top of the document.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || toggle.getAttribute('aria-expanded') !== 'true') return;
      toggle.setAttribute('aria-expanded', 'false');
      panel.classList.remove('is-open');
      toggle.focus();
    });
  }

  /*
   * The demo state renders every route, because that is what the accessibility gate walks and a
   * bar filtered down to nothing would leave the navigation untested. It reads no session and
   * signs nobody out.
   */
  if (new URLSearchParams(location.search).has('state')) {
    reveal(new Set(NAV.flatMap((item) => item.requires)));
    const who = $<HTMLElement>('[data-bonav-who]');
    if (who) who.textContent = 'Demo view';
    return;
  }

  let held: ReadonlySet<string> = new Set();
  try {
    held = new Set(await api.fetchMyGrants());
  } catch {
    // Leave the bar empty. A failed grant read must not open routes, and the page's own error
    // handling is what tells the person the screen did not load.
    return;
  }

  reveal(held);
  explainEmpty(held);

  const who = $<HTMLElement>('[data-bonav-who]');
  const out = $<HTMLButtonElement>('[data-bonav-signout]');
  try {
    const user = await currentUser();
    if (user && who) who.textContent = user.email ?? 'Signed in';
    if (user && out) {
      out.hidden = false;
      out.addEventListener('click', () => {
        void signOut().then(() => location.assign('/signin'));
      });
    }
  } catch {
    // Not being able to name the account is not a reason to withhold navigation they can use.
  }
}
