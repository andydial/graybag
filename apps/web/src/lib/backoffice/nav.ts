/**
 * One web app, three permission levels — `E10-12`, and `P7`.
 *
 * Not three apps. The marketing site, the kitchen dashboard, the admin screens and the school
 * reports are one deployment with one design system and one session; what differs is which
 * routes a person may reach and what each route lets them do.
 *
 * ## Grants, not roles
 *
 * `D3` is explicit that the back office uses **scoped grants rather than a role enum**, so that
 * `orders.mark_delivered` can be split from `orders.refund` and a Delivery role can exist later
 * with no migration. This module therefore derives navigation from *grants*. The three level
 * names below are a convenience for talking about typical bundles — they are not a type anything
 * branches on, and nothing here asks "is this person an admin".
 *
 * That distinction is the whole of `E10-12`. A screen that checks a role is a screen that has to
 * change when the roles do; a screen that checks a grant does not.
 */

/** Grant codes, as seeded in `permission` (`0001_initial_schema.sql`). */
export type Grant =
  | 'orders.view'
  | 'orders.view_pii'
  | 'orders.mark_delivered'
  | 'orders.cancel'
  | 'orders.refund'
  | 'orders.view_financials'
  | 'menu.view'
  | 'menu.edit'
  | 'school.view'
  | 'school.edit'
  | 'kitchen.view'
  | 'kitchen.edit'
  | 'user.view'
  | 'user.edit'
  | 'config.edit'
  | 'reports.view';

export interface Operator {
  /** Display only. Never used to decide access — that is what `grants` is for. */
  name: string;
  grants: ReadonlySet<Grant>;
}

export interface NavItem {
  href: string;
  label: string;
  /** Every one of these must be held. An item with no requirement is reachable by anyone signed in. */
  requires: Grant[];
  /** A one-line explanation, shown when the item is visible but the person cannot use it. */
  description: string;
}

/**
 * Every back-office route, with what it needs.
 *
 * Ordered by how often a back-office user opens it, not alphabetically: the kitchen list is
 * opened every morning and the user admin roughly never.
 */
export const NAV: NavItem[] = [
  {
    href: '/kitchen',
    label: 'Kitchen',
    requires: ['orders.view'],
    description: "Today's orders, what to cook, and handing food over.",
  },
  {
    href: '/admin/orders',
    label: 'Orders',
    requires: ['orders.view', 'orders.view_financials'],
    description: 'Every kitchen, with refunds. Separate from the kitchen list because it shows money.',
  },
  {
    href: '/admin/menus',
    label: 'Menus',
    requires: ['menu.edit'],
    description: 'Create and assign menus, upload the term spreadsheet.',
  },
  {
    href: '/admin/schools',
    label: 'Schools',
    requires: ['school.edit'],
    description: 'Onboarding, break times, and per-school configuration.',
  },
  {
    href: '/admin/people',
    label: 'People',
    requires: ['user.edit'],
    description: 'Back-office accounts and what each of them may do.',
  },
  {
    href: '/reports',
    label: 'Reports',
    requires: ['reports.view'],
    description: 'The monthly school report.',
  },
];

export function canReach(item: NavItem, operator: Operator): boolean {
  return item.requires.every((grant) => operator.grants.has(grant));
}

/**
 * What to draw in the navigation.
 *
 * **Unreachable items are omitted, not disabled.** A disabled link to a screen somebody will
 * never be given is an invitation to ask for access they do not need, and it advertises the
 * shape of the system to an account that should not see it. The exception is when a person can
 * reach *nothing* — see `noAccessReason`, because an empty navigation with no explanation is
 * §5.21's N3 rendering as N1 all over again.
 */
export function visibleNav(operator: Operator): NavItem[] {
  return NAV.filter((item) => canReach(item, operator));
}

/**
 * Why this person is seeing nothing, when they are.
 *
 * Returns null when they can reach something. A back-office account with no grants at all is a
 * real state — a user created before anyone assigned their permissions — and it must say so
 * rather than presenting an empty shell that looks broken.
 */
export function noAccessReason(operator: Operator): string | null {
  if (visibleNav(operator).length > 0) return null;
  if (operator.grants.size === 0) {
    return 'This account has no back-office permissions yet. An administrator needs to grant them.';
  }
  return 'This account has permissions, but none that open a back-office screen.';
}

/**
 * The three levels `E10-12` names, as *example bundles* for tests and documentation.
 *
 * Deliberately not a type, not an enum, and not consulted by any of the functions above. They
 * exist so a test can say "a school viewer sees only Reports" without hand-assembling a grant
 * set, and so this file records what the three names in the task actually mean.
 */
export const EXAMPLE_LEVELS = {
  platformAdmin: new Set<Grant>([
    'orders.view', 'orders.view_pii', 'orders.mark_delivered', 'orders.cancel', 'orders.refund',
    'orders.view_financials', 'menu.view', 'menu.edit', 'school.view', 'school.edit',
    'kitchen.view', 'kitchen.edit', 'user.view', 'user.edit', 'config.edit', 'reports.view',
  ]),
  kitchenOperator: new Set<Grant>([
    'orders.view', 'orders.view_pii', 'orders.mark_delivered', 'orders.cancel',
    'menu.view', 'menu.edit',
  ]),
  schoolViewer: new Set<Grant>(['reports.view']),
} as const;
