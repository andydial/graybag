/**
 * Access as a job somebody does, not as thirty-one checkboxes — `E10-45`.
 *
 * Andy: *"Currently privileges one is a large list that does not make much sense to me. I want to
 * be able to promote people to Kitchen staff so they can login and view orders and promote orders
 * etc. So all privileges need to either be grouped or clarified like that function please."*
 *
 * ## This is a presentation, and it must stay one
 *
 * `D3` is explicit that there is **no role column anywhere**, and the reason is concrete: it is
 * what let `orders.mark_delivered` be split from `orders.refund` so a delivery contractor can hand
 * food over without being able to move money (`E09-09`), with no migration. A `role` enum takes
 * that back.
 *
 * So a job is **derived, never stored**. Granting one writes its individual `permission_grant`
 * rows, exactly as picking them by hand would; naming one reads those rows back and finds the
 * bundle that matches. Nothing in the database knows the word "Kitchen staff", and an account whose
 * grants match no bundle is not broken — it is **Custom**, which is a first-class answer here
 * rather than an error, because the split-a-grant-off case is the whole point of the model.
 *
 * ## Why these five
 *
 * Each is a job somebody is actually hired to do, and each is the smallest set of grants that lets
 * them do it. They are deliberately not a hierarchy of trust levels: **Delivery is not a weaker
 * Kitchen staff**, it is a different job that happens to overlap, and the difference is exactly the
 * one `E09-09` designed for.
 */
import type { Grant } from '../backoffice/nav.js';

export type ScopeType = 'platform' | 'city' | 'kitchen' | 'school';

export interface Job {
  key: string;
  label: string;
  /** What this person can do, in the words of the person hiring them. */
  summary: string;
  /** The scopes this job makes sense at, most specific first. */
  scopes: ScopeType[];
  grants: Grant[];
  /** Named so the screen can warn before handing somebody money or children's names. */
  sensitive?: string;
}

export const JOBS: Job[] = [
  {
    key: 'delivery',
    label: 'Delivery',
    summary: 'Sees the day’s orders and hands food over. Cannot cancel, refund, or see money.',
    scopes: ['kitchen', 'school'],
    // `E09-09`'s designed split, and the reason there is no role column. This job exists so a
    // third-party courier can be given exactly the handover and nothing adjacent to it.
    grants: ['orders.view', 'orders.view_pii', 'orders.mark_delivered'],
    sensitive: 'Sees children’s names, class and section — they are on the bag.',
  },
  {
    key: 'kitchen_staff',
    label: 'Kitchen staff',
    summary:
      'The kitchen board: today’s orders, what to cook, handing food over, and cancelling with a reason. No money.',
    scopes: ['kitchen'],
    grants: [
      'orders.view',
      'orders.view_pii',
      'orders.mark_delivered',
      // Cancelling emails the customer (`E09-38`). It does **not** refund — `orders.refund` is a
      // separate grant and is deliberately not in this bundle.
      'orders.cancel',
      'menu.view',
    ],
    sensitive: 'Sees children’s names and allergy badges, and can cancel an order.',
  },
  {
    key: 'kitchen_manager',
    label: 'Kitchen manager',
    summary:
      'Everything kitchen staff can do, plus the dishes and menus — prices, allergens, photos, and the term import.',
    scopes: ['kitchen'],
    grants: [
      'orders.view',
      'orders.view_pii',
      'orders.mark_delivered',
      'orders.cancel',
      'menu.view',
      'menu.edit',
      'menu.import',
      'kitchen.view',
    ],
    sensitive: 'Everything kitchen staff sees, plus editing what every parent is offered.',
  },
  {
    key: 'school_office',
    label: 'School office',
    summary: 'The monthly report for their own school, and nothing else. No orders, no names.',
    scopes: ['school'],
    // `reports.view` alone. `E10-10` is explicit that no child appears on that screen, so this is
    // the one job that can be given out freely.
    grants: ['reports.view'],
  },
  {
    key: 'platform_admin',
    label: 'Platform admin',
    summary: 'Everything, everywhere — including money, permissions and platform configuration.',
    scopes: ['platform'],
    grants: [
      'orders.view', 'orders.view_pii', 'orders.mark_delivered', 'orders.cancel', 'orders.refund',
      'orders.view_financials', 'menu.view', 'menu.edit', 'menu.import', 'school.view',
      'school.edit', 'school.onboard', 'school.config_edit', 'kitchen.view', 'kitchen.edit',
      'kitchen.config_edit', 'users.view', 'users.manage', 'grants.manage', 'config.platform_edit',
      'reports.view',
      // Meal packs are money taken before food is served, so `0070` makes this permission
      // platform-only and undelegable. It belongs to exactly this job and no other.
      'meal_packs.manage',
    ],
    sensitive: 'Can grant and revoke access, including their own, and can issue refunds.',
  },
];

export interface HeldGrant {
  permissionCode: string;
  scopeType: string;
}

export interface AccessSummary {
  /** The matching job, or `null` when the grants are a set nobody's job describes. */
  job: Job | null;
  /** Where it applies, when a job matched at a single scope. */
  scopeType: string | null;
  /** Grants held that the matched job does not include. Always empty when `job` is null. */
  extra: string[];
  /** One line for the card, whether or not a job matched. */
  label: string;
}

/**
 * Name what somebody holds.
 *
 * ## Why this is not "the largest bundle they hold entirely"
 *
 * It was, and that rule named a **platform admin "Kitchen manager, plus 23 more permissions"** on
 * production. Andy, seeing it: *"a screen that names the wrong job is worse than one that names
 * none."* He is right, and the mechanism is worth stating because it will recur otherwise.
 *
 * `meal_packs.manage` was added to the platform-admin bundle when the packs screen was built. He
 * did not hold it — the permission is not even seeded on production yet — so that bundle stopped
 * matching *entirely*, was filtered out, and the largest remaining complete match was Kitchen
 * manager's eight grants. Thirty-one held minus eight explained is the "23 more".
 *
 * So the rule "every grant in the job must be held" makes **adding one grant to a bundle silently
 * relabel every existing holder as something unrelated**. Not vaguer — wrong, and confidently.
 *
 * ## What it does instead
 *
 * Rank by how much of the **job** the person holds, then prefer the job they are missing least of.
 * A platform admin missing one grant is a platform admin missing one grant, and saying so is both
 * more accurate and more useful: it names the thing to grant.
 *
 * A floor stops it overclaiming. Holding `orders.view` alone is one third of Delivery, and calling
 * that "Delivery, missing two" would dress up a fragment as a job. Below half, it is Custom.
 */
const NEAR_MATCH_FLOOR = 0.5;

export function describeAccess(held: HeldGrant[]): AccessSummary {
  if (held.length === 0) {
    return { job: null, scopeType: null, extra: [], label: 'No access — signed in, holds nothing' };
  }

  const codes = new Set(held.map((g) => g.permissionCode));

  const scored = JOBS.map((job) => {
    const covered = job.grants.filter((g) => codes.has(g));
    const missing = job.grants.filter((g) => !codes.has(g));
    return { job, covered, missing };
  })
    .filter((m) => m.covered.length / m.job.grants.length >= NEAR_MATCH_FLOOR)
    /*
     * Most of the job held wins; then fewest missing; then the larger bundle.
     *
     * The middle term is what stops somebody holding exactly Kitchen staff being called Kitchen
     * manager — both cover five, and only one of them is complete.
     */
    .sort(
      (a, b) =>
        b.covered.length - a.covered.length ||
        a.missing.length - b.missing.length ||
        b.job.grants.length - a.job.grants.length,
    );

  const best = scored[0] ?? null;

  if (!best) {
    return {
      job: null,
      scopeType: null,
      extra: [],
      label: `Custom — ${codes.size} permission${codes.size === 1 ? '' : 's'}`,
    };
  }

  const { job, missing } = best;
  const extra = [...codes].filter((c) => !job.grants.includes(c as Grant)).sort();

  // The scope only reads cleanly when the job's own grants all sit at one. Mixed scopes are
  // legitimate and are simply not summarised — the grant list below the card still shows them.
  const scopes = new Set(
    held.filter((g) => job.grants.includes(g.permissionCode as Grant)).map((g) => g.scopeType),
  );
  const scopeType = scopes.size === 1 ? [...scopes][0]! : null;

  /*
   * Missing is named before extra, because it is the actionable half.
   *
   * "Platform admin, missing meal_packs.manage" tells you what to grant. "Platform admin, plus 9
   * more" tells you nothing you can do anything about, and burying the gap under the surplus is
   * how the original bug stayed invisible.
   */
  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(
      missing.length <= 2
        ? `missing ${missing.join(' and ')}`
        : `missing ${missing.length} of its permissions`,
    );
  }
  if (extra.length > 0) {
    parts.push(`plus ${extra.length} more permission${extra.length === 1 ? '' : 's'}`);
  }

  const label = parts.length === 0 ? job.label : `${job.label}, ${parts.join(', ')}`;

  return { job, scopeType, extra, label };
}

/** The job a key names, or `null`. */
export const jobByKey = (key: string): Job | null => JOBS.find((j) => j.key === key) ?? null;
