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

/**
 * Grant codes, as seeded in `permission` (`0001_initial_schema.sql`).
 *
 * **Three of these were wrong until `E10-06`**, and the way they were wrong is worth keeping:
 * `user.view`, `user.edit` and `config.edit` are not codes this system has. The real ones are
 * `users.view`, `users.manage` and `config.platform_edit`. Nothing failed — a nav item requiring
 * a grant that cannot exist is simply never visible, so `/admin/people` was unreachable by every
 * account including a full platform admin, and it looked exactly like correct default-deny.
 *
 * `nav.test.ts` now asserts every code here against the seeded list, so the next invented code
 * fails a test instead of silently hiding a screen.
 */
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
  | 'school.onboard'
  | 'kitchen.view'
  | 'kitchen.edit'
  | 'users.view'
  | 'users.manage'
  | 'grants.manage'
  | 'menu.import'
  | 'config.platform_edit'
  | 'school.config_edit'
  | 'kitchen.config_edit'
  | 'reports.view';

/**
 * Every permission code seeded by `0001_initial_schema.sql`, in the order it is seeded.
 *
 * Duplicated from SQL on purpose, and the duplication *is* the check — a lint config and a test
 * cannot read a migration, so `nav.test.ts` asserts that every code in `Grant` appears here, and
 * `supabase/tests/authorization.test.sql` is what keeps this list honest against the database.
 * A code that exists in neither place is the failure this list was added to catch.
 */
export const SEEDED_PERMISSIONS = [
  'orders.view', 'orders.view_pii', 'orders.mark_delivered', 'orders.cancel', 'orders.refund',
  'orders.view_financials', 'orders.create_on_behalf',
  'menu.view', 'menu.edit', 'menu.publish', 'menu.import', 'dish.edit',
  'school.view', 'school.edit', 'school.onboard', 'school.config_edit',
  'kitchen.view', 'kitchen.edit', 'kitchen.config_edit',
  'users.view', 'users.manage', 'users.impersonate', 'grants.manage',
  'config.platform_edit', 'audit.view', 'consent.view',
  'reports.view', 'reports.financial_view',
  'invoices.view', 'payouts.view', 'payouts.manage',
] as const;

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
    // `E09-34`. The board is where you change things; this is what you pack from, on paper or on
    // a phone. It was reachable from no link anywhere in the app — you had to know the URL.
    href: '/kitchen/sheet',
    label: 'Packing sheet',
    requires: ['orders.view'],
    description: "One day, grouped the way you physically pack it. Printable, and nothing on it is a button.",
  },
  {
    /**
     * `/orders`, not `/admin/orders`. This entry named a route that has never existed, and
     * because an unreachable nav item is indistinguishable from a correctly hidden one, nothing
     * failed — exactly the shape of the `user.view` bug recorded above. `nav.test.ts` now asserts
     * every href against the pages on disk, so a route that is renamed breaks a test.
     */
    href: '/orders',
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
    description: 'Onboarding, break times, and which kitchen serves each school.',
  },
  {
    /**
     * `E10-06`. Split from `/admin/schools` because reading the configuration needs
     * `config.platform_edit` — `revenue_share_bps` (`M4`) sits on the same row as the cutoff and
     * RLS filters rows, never columns, so somebody who may onboard a school is not thereby
     * somebody who may see its commercial terms.
     */
    href: '/admin/config',
    label: 'Configuration',
    requires: ['config.platform_edit'],
    description: 'Cutoffs, service days and break times, and where each value is inherited from.',
  },
  {
    // `E10-29`. Dry-runs an import file against live data and writes nothing, so `menu.import` —
    // the grant for running the importer — is the honest requirement even though this half only
    // reads: it is the same task, and somebody who cannot run the import has no use for a
    // preview of one.
    href: '/admin/import',
    label: 'Check an import file',
    requires: ['menu.import'],
    description: 'See exactly what a CSV would change, before running it.',
  },
  {
    // `E09-33`. Tagging a dish with what it contains is `menu.edit` work — it is an attribute of
    // the dish, edited by the same person on the same data, and it is only a separate screen
    // because tagging 79 dishes at once is a different job from editing one.
    href: '/admin/allergens',
    label: 'Allergens',
    requires: ['menu.edit'],
    description: 'Tag dishes with what they contain, in bulk.',
  },
  {
    // `E08-16`. `kitchen.edit` rather than a platform grant, so a kitchen manager can
    // maintain their own kitchen's list without being able to see anybody else's.
    href: '/admin/alerts',
    label: 'Order alerts',
    requires: ['kitchen.edit'],
    description: 'Who is emailed when an order is paid, per kitchen. Switch a person off without losing the address.',
  },
  {
    href: '/admin/people',
    label: 'People',
    // The two the screen actually needs: `grants.manage` reads and writes `permission_grant` and
    // the permission catalogue, `users.view` reads the accounts. `users.manage` is disabling an
    // account, which is a different job and is not what this screen does.
    requires: ['grants.manage', 'users.view'],
    description: 'Back-office accounts and what each of them may do.',
  },
  {
    href: '/reports',
    label: 'Reports',
    requires: ['reports.view'],
    description: 'The monthly school report.',
  },
  {
    // `E11-12`. Orders by the day they were **placed**, which is the growth question. `/reports`
    // is the same money by service date, which is the operational one.
    href: '/admin/sales',
    label: 'Sales',
    /*
     * `orders.view_financials` as well as `reports.view` — the same pair `/orders` uses.
     *
     * A school viewer holds `reports.view` alone so they can read their own school's monthly
     * report. RLS would already scope this screen to their school, so nothing leaks either way —
     * but "Sales", with growth percentages and average order value, is our commercial view of the
     * business and does not belong in a school office's navigation. Caught by the nav test, which
     * asserts a school viewer sees exactly one item.
     */
    requires: ['reports.view', 'orders.view_financials'],
    description: 'Orders by the day they were taken, with the change on the period before.',
  },
  {
    /**
     * `E11-08`. Separate from `/reports`, which answers "what did this school order" for a
     * school. This answers "is the product growing" for us, and needs `users.view` because it
     * counts accounts — a school viewer must not reach it.
     */
    href: '/admin/growth',
    label: 'Growth',
    requires: ['users.view'],
    description: 'Registrations over time and by school. Counts only — nobody is named.',
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
    'school.onboard', 'kitchen.view', 'kitchen.edit', 'users.view', 'users.manage',
    // `grants.manage` is what `/admin/people` actually needs — without it here, the screen is
    // invisible to a full platform admin, which is the same silent failure the `Grant` union and
    // `SEEDED_PERMISSIONS` were added to catch. `visibleNav`'s count test is what surfaced it.
    'grants.manage', 'menu.import',
    'config.platform_edit', 'school.config_edit', 'kitchen.config_edit', 'reports.view',
  ]),
  kitchenOperator: new Set<Grant>([
    'orders.view', 'orders.view_pii', 'orders.mark_delivered', 'orders.cancel',
    'menu.view', 'menu.edit',
  ]),
  schoolViewer: new Set<Grant>(['reports.view']),
} as const;
