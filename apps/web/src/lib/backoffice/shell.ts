/**
 * Filling the back-office shell — `E10-55`, and `E10-73`.
 *
 * `BackofficeShell.astro` ships an **empty** rail, an empty "who" block, and an unmounted drawer.
 * This fills them in the browser, where the reader's grants are knowable.
 *
 * Three jobs:
 *
 *  - **build the rail** from `visibleNav`, groups included, so an operator with two links does
 *    not see four empty headings — and so the document itself never carried the other twelve;
 *  - **who is signed in**, and what job their grants add up to — the old back office never said;
 *  - **the drawer**, available to any screen rather than only the dish workbench.
 *
 * It used to *reveal* pre-rendered links instead of creating them. See `BackofficeShell.astro`
 * for why that shipped the whole route table to anyone who viewed source, signed in or not.
 */
import { api } from '@graybag/shared';

import { describeAccess } from '../admin/jobs.js';
import { operatorOf } from './gate.js';
import { currentUser, signOut } from './session.js';
import { NAV, NAV_GROUPS, visibleNav, type NavItem } from './nav.js';

const q = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

/**
 * Create the links this reader may use, under the headings that keep one.
 *
 * Nothing is hidden and later shown: an element that is not built cannot be un-hidden by a
 * stylesheet, a devtools toggle or the next person to touch this file.
 */
function build(items: NavItem[]): number {
  const rail = q<HTMLElement>('[data-nav-rail]');
  if (!rail) return 0;
  const current = q<HTMLElement>('[data-bonav]')?.dataset.navCurrent ?? '';

  rail.replaceChildren();
  for (const group of NAV_GROUPS) {
    const inGroup = items.filter((item) => item.group === group);
    // A heading with nothing under it is worse than no heading: it reads as a section that failed
    // to load rather than one this account has no business in.
    if (inGroup.length === 0) continue;

    const heading = document.createElement('p');
    heading.className = 'bo__group';
    heading.dataset.navGroup = group;
    heading.textContent = group;
    rail.append(heading);

    for (const item of inGroup) {
      const link = document.createElement('a');
      link.className = 'bo__link';
      link.href = item.href;
      link.dataset.navItem = item.href;
      if (item.href === current) link.setAttribute('aria-current', 'page');

      const label = document.createElement('span');
      label.textContent = item.label;

      const count = document.createElement('span');
      count.className = 'bo__count';
      count.dataset.navCount = item.href;
      count.hidden = true;

      link.append(label, count);
      rail.append(link);
    }
  }

  return items.length;
}

/** A count on a nav item. Only a page that can answer honestly should call this. */
export function setNavCount(href: string, count: number | null): void {
  const badge = q<HTMLElement>(`[data-nav-count="${CSS.escape(href)}"]`);
  if (!badge) return;
  // Zero is hidden rather than shown. "Dishes 0" invites reading the number as a quantity of
  // dishes; the badge means "this many need you", and none needing you is not news.
  if (count === null || count <= 0) {
    badge.hidden = true;
    return;
  }
  badge.textContent = String(count);
  badge.hidden = false;
}

/* ------------------------------------------------------------------ the drawer */

let lastFocused: HTMLElement | null = null;

export interface DrawerContent {
  title: string;
  subtitle?: string;
  /** Already-escaped HTML for the body. */
  body: string;
  /** Already-escaped HTML for the footer — usually the save and cancel buttons. */
  footer?: string;
}

/**
 * Open the drawer.
 *
 * **It does not touch the list behind it.** That is the whole reason the prototype has a drawer
 * rather than inline editing, and it is Andy's oldest complaint about this product: *"I hunt for a
 * dish, edit it, save, and get thrown back to the top to start again."*
 */
export function openDrawer(content: DrawerContent): void {
  const drawer = q<HTMLElement>('[data-drawer]');
  const scrim = q<HTMLElement>('[data-drawer-scrim]');
  if (!drawer || !scrim) return;

  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  q<HTMLElement>('[data-drawer-title]')!.textContent = content.title;
  const sub = q<HTMLElement>('[data-drawer-sub]')!;
  sub.textContent = content.subtitle ?? '';
  sub.hidden = !content.subtitle;
  q<HTMLElement>('[data-drawer-body]')!.innerHTML = content.body;

  const foot = q<HTMLElement>('[data-drawer-foot]')!;
  foot.innerHTML = content.footer ?? '';
  foot.hidden = !content.footer;

  drawer.hidden = false;
  scrim.hidden = false;
  // Focus moves into the dialog, or a keyboard reader is left behind it with no way in.
  (drawer.querySelector<HTMLElement>('input, select, textarea, button') ?? drawer).focus();
}

export function closeDrawer(): void {
  const drawer = q<HTMLElement>('[data-drawer]');
  const scrim = q<HTMLElement>('[data-drawer-scrim]');
  if (!drawer || !scrim) return;
  drawer.hidden = true;
  scrim.hidden = true;
  // Back where they came from, which for a list is the row they opened.
  lastFocused?.focus();
}

export const drawerIsOpen = (): boolean => q<HTMLElement>('[data-drawer]')?.hidden === false;

/* ----------------------------------------------------------------- signing out */

/**
 * Reveal Sign out and make it work — `E12-42`.
 *
 * Shown only once there is a session to end. The button navigates to `/signin` **whether or not
 * the server call succeeds**, because `signOut()` purges local storage in a `finally`: the token
 * is gone either way, and leaving somebody on a back-office page after they pressed Sign out
 * would tell them it had failed when it had not.
 *
 * `E12-42` made the session last 30 days. This is the other half of that change and it is not
 * optional — a kitchen tablet is shared, the board carries children's names, and a long session
 * with no way to end it is worse than the short one it replaced.
 */
function mountSignOut(): void {
  const button = q<HTMLButtonElement>('[data-nav-signout]');
  if (!button) return;
  button.hidden = false;
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = 'Signing out…';
    void signOut()
      .catch(() => undefined)
      .then(() => location.assign('/signin'));
  });
}

/* ------------------------------------------------------------------ mount */

export async function mountShell(): Promise<void> {
  q<HTMLElement>('[data-drawer-close]')?.addEventListener('click', closeDrawer);
  q<HTMLElement>('[data-drawer-scrim]')?.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawerIsOpen()) closeDrawer();
  });

  // The demo state has no session and must still render the frame, or `check:a11y` audits a
  // sign-in redirect instead of the screen.
  if (new URLSearchParams(location.search).has('state')) {
    // Every route, because this is what `check:a11y` walks and a rail filtered to nothing would
    // leave the navigation unaudited. It reads no session and reaches no server.
    build(NAV);
    const who = q<HTMLElement>('[data-nav-who]');
    if (who) {
      q<HTMLElement>('[data-nav-email]')!.textContent = 'demo@graybag.com';
      q<HTMLElement>('[data-nav-role]')!.textContent = 'Demo — not a real session';
      who.hidden = false;
    }
    // Revealed but **not wired**: `check:a11y` needs the control in the document to audit its
    // contrast and its name, and there is no session here for a click to end.
    const out = q<HTMLButtonElement>('[data-nav-signout]');
    if (out) out.hidden = false;
    return;
  }

  /*
   * Sign out is mounted **before** the grant read and outside its `try` — `E12-42`.
   *
   * Every page reaching this point has already passed `requireBackofficeAccess`, so there is a
   * session. If `fetchMyAccess` then fails the rail is deliberately left empty (see the `catch`),
   * and mounting sign-out inside the `try` would mean the one failure mode that strands somebody
   * on a bare frame is also the one that takes away their way out of it.
   */
  mountSignOut();

  try {
    const access = await api.fetchMyAccess();
    // The owner satisfies every requirement while holding no grant row — `E02-39`. Building from
    // the codes alone would give the account that can do everything an empty rail.
    build(visibleNav(operatorOf(api.capabilities(
      access.grants.map((g) => g.permissionCode), access.isOwner,
    ))));

    const who = q<HTMLElement>('[data-nav-who]');
    if (who) {
      const me = await currentUser().catch(() => null);
      q<HTMLElement>('[data-nav-email]')!.textContent = me?.email ?? 'Signed in';
      /*
       * The job, and **only** the job — `E10-73`.
       *
       * `describeAccess` also computes what a near-match is missing, which is exactly right on
       * `/admin/people`, where an administrator is deciding what to grant. Shown to the person
       * themselves it read *"Kitchen manager, missing menu.import and kitchen.view"*: two
       * permission codes they cannot act on, naming two capabilities they were not told about.
       */
      q<HTMLElement>('[data-nav-role]')!.textContent =
        describeAccess(access.grants, { isOwner: access.isOwner }).shortLabel;
      who.hidden = false;
    }
  } catch {
    /*
     * A failed grant read reveals **nothing** — `E10-73`.
     *
     * This used to reveal every link, reasoning that the sidebar is a signpost rather than a gate
     * and that each screen refuses on its own read anyway. Both halves are true and the
     * conclusion was still wrong: the list of screens is itself the disclosure. Andy, 2026-09-02:
     * *"Other employees (kitchen) can't know that we track reports, access, even revenue using
     * this web dashboard."* A dropped request would have shown a kitchen operator all fourteen.
     *
     * `nav-mount.ts` has always failed this way and said why — *"a script that fails must not
     * advertise the shape of the system"*. The two are now the same. Nobody is stranded: the
     * page's own gate (`guard.ts`) is what handles a reader who cannot get anywhere, and the
     * brand mark at the top of the rail is still a link home.
     */
  }
}
