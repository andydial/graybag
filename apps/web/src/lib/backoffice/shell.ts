/**
 * Filling the back-office shell — `E10-55`.
 *
 * `BackofficeShell.astro` ships a sidebar whose links are all `hidden`, an empty "who" block, and
 * an unmounted drawer. This fills them in the browser, where the reader's grants are knowable.
 *
 * Three jobs, none of which the old `nav-mount` did:
 *
 *  - **reveal**, and hide a whole group whose every item is hidden, so an operator with two links
 *    does not see four empty headings;
 *  - **who is signed in**, and what job their grants add up to — the old back office never said;
 *  - **the drawer**, available to any screen rather than only the dish workbench.
 */
import { api } from '@graybag/shared';

import { describeAccess } from '../admin/jobs.js';
import { currentUser } from './session.js';
import { NAV } from './nav.js';

const q = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const all = <T extends HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];

/**
 * Reveal the links whose every requirement is held, then the groups that kept a link.
 *
 * The requirement is read back from the DOM rather than re-derived, so the markup and the decision
 * cannot disagree — the attribute was written from the same `NAV` entry that produced the link.
 */
function reveal(held: ReadonlySet<string>): number {
  let shown = 0;
  for (const link of all<HTMLAnchorElement>('[data-nav-item]')) {
    const requires = (link.dataset.navRequires ?? '').split(' ').filter(Boolean);
    if (requires.every((grant) => held.has(grant))) {
      link.hidden = false;
      shown += 1;
    }
  }

  for (const heading of all<HTMLElement>('[data-nav-group]')) {
    const group = heading.dataset.navGroup;
    const items = NAV.filter((item) => item.group === group).map((item) => item.href);
    // A heading with nothing under it is worse than no heading: it reads as a section that failed
    // to load rather than one this account has no business in.
    heading.hidden = !items.some(
      (href) => q<HTMLElement>(`[data-nav-item="${CSS.escape(href)}"]`)?.hidden === false,
    );
  }

  return shown;
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
    for (const link of all<HTMLElement>('[data-nav-item]')) link.hidden = false;
    for (const heading of all<HTMLElement>('[data-nav-group]')) heading.hidden = false;
    const who = q<HTMLElement>('[data-nav-who]');
    if (who) {
      q<HTMLElement>('[data-nav-email]')!.textContent = 'demo@graybag.com';
      q<HTMLElement>('[data-nav-role]')!.textContent = 'Demo — not a real session';
      who.hidden = false;
    }
    return;
  }

  try {
    const grants = await api.fetchMyAccess();
    reveal(new Set(grants.map((g) => g.permissionCode)));

    const who = q<HTMLElement>('[data-nav-who]');
    if (who) {
      const me = await currentUser().catch(() => null);
      q<HTMLElement>('[data-nav-email]')!.textContent = me?.email ?? 'Signed in';
      q<HTMLElement>('[data-nav-role]')!.textContent = describeAccess(grants).label;
      who.hidden = false;
    }
  } catch {
    /*
     * A failed grant read must not leave an empty rail with no way out. Everything is revealed;
     * each screen still refuses on its own read, which is the check that actually matters — the
     * sidebar is a signpost, not a gate.
     */
    for (const link of all<HTMLElement>('[data-nav-item]')) link.hidden = false;
    for (const heading of all<HTMLElement>('[data-nav-group]')) heading.hidden = false;
  }
}
