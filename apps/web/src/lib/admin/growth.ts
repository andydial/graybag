/**
 * How registration is tracking — `E11-08`.
 *
 * Andy: *"All registered users — registrations per date — registrations per school etc. Want to be
 * able to see exactly how the registrations / growth is tracking."*
 *
 * ## No child appears in the output of this file
 *
 * RLS **would** let a platform admin read every recipient row: `recipient_read_admin` grants it on
 * `users.view`. That is not permission to put one on a screen. Non-negotiable #4 covers names,
 * class and section, and `E10-10` already holds the line that a report is aggregate by definition.
 *
 * So the input type takes `{ id, schoolId, createdAt }` and **has nowhere to put a name** — the
 * fetch selects those three columns and the compiler refuses the rest. A report that could show a
 * child only by someone adding a field is safer than one that merely does not today.
 *
 * ## A guardian is counted once per school, not once per child
 *
 * Two siblings at one school is one family, and counting it as two overstates reach by exactly the
 * families most likely to be a reference. The distinction matters most at the small numbers this
 * report will show for months.
 *
 * ## Dates are IST calendar dates
 *
 * `created_at` is a `timestamptz`. Bucketing by its UTC date puts every evening signup after
 * 18:30 IST on the previous day, which is wrong on the axis that people read as "yesterday".
 */

/**
 * A registered account. Carries no name and no phone.
 *
 * **The email is here for exactly one reason** — `E11-15`. Andy: *"a parent stuck with no children
 * is someone I can email."* It is used only to build the stuck list, and it never appears beside
 * anything about a child, because this module has nothing about a child to show: a child is an id,
 * a school and a timestamp.
 */
export interface GrowthUser {
  id: string;
  email: string | null;
  /** `app_user.created_at`, ISO 8601 with a zone. */
  createdAt: string;
}

/** A child. Three columns, none of which identify anybody — see the header. */
export interface GrowthChild {
  id: string;
  schoolId: string;
  createdAt: string;
}

export interface GrowthLink {
  userId: string;
  recipientId: string;
}

export interface GrowthSchool {
  id: string;
  name: string;
}

export interface DayPoint {
  /** `YYYY-MM-DD`, IST. */
  date: string;
  registrations: number;
  /** Running total at the end of this day. */
  cumulative: number;
}

export interface SchoolRow {
  schoolId: string;
  name: string;
  /** Distinct accounts with at least one child here. */
  guardians: number;
  children: number;
  /** Share of all guardians, 0–1. Rendered as a bar. */
  share: number;
}

/** An order, as the funnel needs it. No child, no name — see `GROWTH_ORDER_COLUMNS`. */
export interface FunnelOrder {
  customerUserId: string;
  placedAt: string;
  status: string;
  totalPaise: number;
  /**
   * The day the food is served, and the school it went to — both added in `E11-17` for the usage
   * block on Reports.
   *
   * Optional because the funnel itself never reads them, and a caller that only has a funnel to
   * draw should not have to invent a service date to satisfy a type.
   */
  serviceDate?: string;
  schoolId?: string;
}

/**
 * One step of the funnel — `E11-15`.
 *
 * Andy: *"Show the drop-off between each step as a number, not just a percentage. A parent who
 * registered and never added a child is someone I can email."* So `lost` is a count first; the
 * percentage is derived for display and is never the only thing shown.
 */
export interface FunnelStep {
  key: 'registered' | 'addedChild' | 'firstOrder' | 'orderedAgain';
  label: string;
  /** How many reached this step. */
  reached: number;
  /** How many reached the previous step and not this one. Zero for the first step. */
  lost: number;
  /** `reached / previous.reached`, or null for the first step. */
  rate: number | null;
  /** What to do about the ones who dropped here. */
  action: string;
}

export interface Growth {
  totalUsers: number;
  /** Accounts with no child yet — signed up and stopped. The conversion gap, named. */
  usersWithoutChildren: number;
  totalChildren: number;
  daily: DayPoint[];
  bySchool: SchoolRow[];
  /** Registrations in the last 7 and 28 days, against the 7 and 28 before them. */
  recent: { days: number; now: number; previous: number }[];
  /** Registered → added a child → ordered → ordered again. */
  funnel: FunnelStep[];
  /** Parents who ordered in the last 7 days. */
  activeParents: number;
  /**
   * Accounts with no child, newest first, capped.
   *
   * The one place an address appears, and the reason it is read at all: this is a list to email.
   * Capped because it is a worklist, not an export — a screen offering four hundred addresses is
   * a screen nobody acts on.
   */
  stuck: { email: string; registered: string }[];
  /** Paid orders and net revenue per IST day, for the orders chart. */
  ordersDaily: { date: string; orders: number; revenuePaise: number }[];
  /** Average paid order value, in paise. */
  averageOrderPaise: number;
}

/** Statuses that mean money was taken. Matches `admin-reports.ts` deliberately. */
const EARNED = new Set(['paid', 'preparing', 'delivered']);

/** How many stuck parents the screen will list. A worklist, not an export. */
export const STUCK_LIMIT = 25;

/**
 * The IST calendar date of an instant.
 *
 * `+05:30` is fixed — India has no daylight saving and one zone — so this is an addition rather
 * than a timezone library. `sv-SE` gives `YYYY-MM-DD` from `toLocaleDateString` without any
 * parsing, but shifting the epoch is exact and needs no ICU data in a test runner.
 */
export function istDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Every date from `from` to `to` inclusive, so a day with no signups is a gap in the line. */
function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function growth(
  // `readonly` throughout: nothing here mutates its inputs, and the demo fixture is `as const`,
  // so a mutable signature made the one caller that proves the screen renders fail to typecheck.
  users: readonly GrowthUser[],
  children: readonly GrowthChild[],
  links: readonly GrowthLink[],
  schools: readonly GrowthSchool[],
  today: string,
  orders: readonly FunnelOrder[] = [],
): Growth {
  const byDate = new Map<string, number>();
  for (const u of users) {
    const d = istDate(u.createdAt);
    if (d) byDate.set(d, (byDate.get(d) ?? 0) + 1);
  }

  const dates = [...byDate.keys()].sort();
  // A continuous axis, from the first signup to today. Plotting only the days that had one turns
  // a quiet fortnight into a line that looks like steady growth.
  const span = dates.length > 0 ? dateRange(dates[0]!, today) : [];

  let running = 0;
  const daily: DayPoint[] = span.map((date) => {
    const registrations = byDate.get(date) ?? 0;
    running += registrations;
    return { date, registrations, cumulative: running };
  });

  const childById = new Map(children.map((c) => [c.id, c]));

  // school -> the accounts with a child there. A Set, because two siblings are one family.
  const guardiansBySchool = new Map<string, Set<string>>();
  for (const link of links) {
    const child = childById.get(link.recipientId);
    if (!child) continue;
    const set = guardiansBySchool.get(child.schoolId) ?? new Set<string>();
    set.add(link.userId);
    guardiansBySchool.set(child.schoolId, set);
  }

  const childrenBySchool = new Map<string, number>();
  for (const c of children) {
    childrenBySchool.set(c.schoolId, (childrenBySchool.get(c.schoolId) ?? 0) + 1);
  }

  const linkedUsers = new Set(
    links.filter((l) => childById.has(l.recipientId)).map((l) => l.userId),
  );

  const totalGuardians = [...guardiansBySchool.values()].reduce((n, s) => n + s.size, 0);

  const bySchool: SchoolRow[] = schools
    .map((s) => {
      const guardians = guardiansBySchool.get(s.id)?.size ?? 0;
      return {
        schoolId: s.id,
        name: s.name,
        guardians,
        children: childrenBySchool.get(s.id) ?? 0,
        share: totalGuardians === 0 ? 0 : guardians / totalGuardians,
      };
    })
    // Biggest first. This is a "where are we" screen, and alphabetical buries the answer.
    .sort((a, b) => b.guardians - a.guardians || a.name.localeCompare(b.name));

  const since = (days: number, offset: number) => {
    const end = Date.parse(`${today}T00:00:00Z`) - offset * 86_400_000;
    const start = end - days * 86_400_000;
    return users.filter((u) => {
      const t = Date.parse(`${istDate(u.createdAt)}T00:00:00Z`);
      return t > start && t <= end;
    }).length;
  };

  /*
   * The funnel — `E11-15`.
   *
   * Counted over **accounts**, not orders, because every step is a question about people: how
   * many got as far as this. An account is counted at a step if it ever reached it, so somebody
   * who ordered in June and stopped still counts as having ordered — the "ordered again" step is
   * what separates them from a repeat customer, and `activeParents` is what separates either from
   * somebody currently using the product.
   *
   * **Unpaid orders are not a conversion.** A parent who reached checkout and never paid did not
   * buy anything, and counting them here would make the funnel flatter than the business is.
   */
  const paidByUser = new Map<string, string[]>();
  for (const o of orders) {
    if (!EARNED.has(o.status)) continue;
    const day = istDate(o.placedAt);
    if (!day) continue;
    const list = paidByUser.get(o.customerUserId) ?? [];
    list.push(day);
    paidByUser.set(o.customerUserId, list);
  }

  const registered = users.length;
  const addedChild = users.filter((u) => linkedUsers.has(u.id)).length;
  const firstOrder = users.filter((u) => (paidByUser.get(u.id)?.length ?? 0) >= 1).length;
  const orderedAgain = users.filter((u) => (paidByUser.get(u.id)?.length ?? 0) >= 2).length;

  const step = (
    key: FunnelStep['key'], label: string, reached: number, previous: number | null, action: string,
  ): FunnelStep => ({
    key, label, reached,
    lost: previous === null ? 0 : Math.max(0, previous - reached),
    rate: previous === null || previous === 0 ? null : reached / previous,
    action,
  });

  const funnel: FunnelStep[] = [
    step('registered', 'Registered', registered, null, 'Everyone who has signed in at least once.'),
    step('addedChild', 'Added a child', addedChild, registered,
      'Email the ones who stopped here — they cannot order until a child exists. Listed below.'),
    step('firstOrder', 'Placed a first order', firstOrder, addedChild,
      'They have a child and never bought. Check the school has a live menu and break windows.'),
    step('orderedAgain', 'Ordered again', orderedAgain, firstOrder,
      'One order and no second is the sharpest signal there is. Ask them why.'),
  ];

  // Active = ordered in the last seven days, which is the only step that expires.
  const sevenDaysAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000)
    .toISOString().slice(0, 10);
  const activeParents = [...paidByUser.entries()]
    .filter(([, days]) => days.some((d) => d > sevenDaysAgo)).length;

  const stuck = users
    .filter((u) => !linkedUsers.has(u.id) && u.email)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, STUCK_LIMIT)
    .map((u) => ({ email: u.email!, registered: istDate(u.createdAt) }));

  const dayTotals = new Map<string, { orders: number; revenuePaise: number }>();
  let paidCount = 0;
  let paidPaise = 0;
  for (const o of orders) {
    if (!EARNED.has(o.status)) continue;
    const d = istDate(o.placedAt);
    if (!d) continue;
    const cur = dayTotals.get(d) ?? { orders: 0, revenuePaise: 0 };
    cur.orders += 1;
    cur.revenuePaise += o.totalPaise;
    dayTotals.set(d, cur);
    paidCount += 1;
    paidPaise += o.totalPaise;
  }
  const ordersDaily = span.map((date) => ({
    date,
    orders: dayTotals.get(date)?.orders ?? 0,
    revenuePaise: dayTotals.get(date)?.revenuePaise ?? 0,
  }));

  return {
    funnel,
    activeParents,
    stuck,
    ordersDaily,
    averageOrderPaise: paidCount === 0 ? 0 : Math.round(paidPaise / paidCount),
    totalUsers: users.length,
    // The number that says whether signup converts. An account with no child cannot order, so
    // this is the drop-off `AR7` cares about, not a curiosity.
    usersWithoutChildren: users.filter((u) => !linkedUsers.has(u.id)).length,
    totalChildren: children.length,
    daily,
    bySchool,
    recent: [7, 28].map((days) => ({ days, now: since(days, 0), previous: since(days, days) })),
  };
}

/**
 * An SVG polyline for a series, scaled to a viewBox.
 *
 * Hand-rolled because a chart library is a third-party script, and the site ships **zero** of them
 * — `check-build.mjs` fails on any external asset, and the CSP is `script-src 'self'`. A polyline
 * is twenty lines and needs no runtime.
 */
export function linePath(values: readonly number[], width: number, height: number): string {
  if (values.length === 0) return '';
  const max = Math.max(...values, 1);
  const step = values.length === 1 ? 0 : width / (values.length - 1);
  return values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`)
    .join(' ');
}


/**
 * The funnel for a **cohort** — `E11-16`.
 *
 * Andy is moving the funnel off Growth and onto Reports: *"acquisition and conversion answer
 * different questions on different clocks. Growth = are new families arriving. Reports = does a
 * family who arrives get to an order, over a range."*
 *
 * So this is not the all-time funnel filtered by date. It is a **cohort**: the parents who
 * registered inside the range, and how far *they* got — measured to the present, not truncated at
 * the end of the range.
 *
 * That distinction decides whether the number means anything. Counting only orders placed inside
 * the range would make every recent range look terrible, because a parent who registers on the
 * 25th has had a day to order and one who registered on the 1st has had a month. And truncating
 * would make a *past* range improve every time you looked at it, which is worse — a number that
 * changes when nothing happened is a number nobody trusts twice.
 *
 * The honest cost, and it belongs on the screen: a range ending yesterday is measuring people who
 * have barely had a chance. The caller states the range; this states the cohort size.
 */
export function funnelForCohort(
  users: readonly GrowthUser[],
  links: readonly GrowthLink[],
  children: readonly GrowthChild[],
  orders: readonly FunnelOrder[],
  from: string,
  to: string,
): { steps: FunnelStep[]; cohort: number } {
  const inRange = users.filter((u) => {
    const day = istDate(u.createdAt);
    return day !== '' && day >= from && day <= to;
  });

  const childById = new Map(children.map((c) => [c.id, c]));
  const linked = new Set(
    links.filter((l) => childById.has(l.recipientId)).map((l) => l.userId),
  );

  const paidCount = new Map<string, number>();
  for (const o of orders) {
    if (!EARNED.has(o.status)) continue;
    paidCount.set(o.customerUserId, (paidCount.get(o.customerUserId) ?? 0) + 1);
  }

  const registered = inRange.length;
  const addedChild = inRange.filter((u) => linked.has(u.id)).length;
  const firstOrder = inRange.filter((u) => (paidCount.get(u.id) ?? 0) >= 1).length;
  const orderedAgain = inRange.filter((u) => (paidCount.get(u.id) ?? 0) >= 2).length;

  const step = (
    key: FunnelStep['key'], label: string, reached: number, previous: number | null, action: string,
  ): FunnelStep => ({
    key, label, reached,
    lost: previous === null ? 0 : Math.max(0, previous - reached),
    rate: previous === null || previous === 0 ? null : reached / previous,
    action,
  });

  return {
    cohort: registered,
    steps: [
      step('registered', 'Registered in this range', registered, null,
        'Everyone who signed up between these dates.'),
      step('addedChild', 'Added a child', addedChild, registered,
        'They cannot order until a child exists. The list to email is on Growth.'),
      step('firstOrder', 'Placed a first order', firstOrder, addedChild,
        'They have a child and never bought. Check the school has a live menu and break windows.'),
      step('orderedAgain', 'Ordered again', orderedAgain, firstOrder,
        'One order and no second is the sharpest signal there is. Ask them why.'),
    ],
  };
}

/**
 * How much the families we have are actually using us — `E11-17`.
 *
 * The prototype's Usage block. It answers a different question from the funnel above it: the
 * funnel asks whether new families arrive and convert, this asks whether the ones who converted
 * come back. A product can look healthy on the first and be dying on the second.
 *
 * ## Counted on the service date, not the payment date
 *
 * Every other number on Reports is bucketed by the day the food is served, because that is what
 * `fetchMonthlyRevenue` filters on. If this counted by `placed_at` instead, the two order counts
 * on one screen would differ by whatever crossed a midnight — three of the four real orders in
 * production do — and nobody who saw that would trust either number again.
 *
 * ## Repeat rate is over the range, and says so
 *
 * A parent who ordered in June and again in this range counts as one order here, not a repeat.
 * That understates loyalty and it is the right direction to be wrong in: the alternative reads
 * all-time history into a seven-day window and reports a repeat rate that cannot fall.
 */
export interface Usage {
  /** Distinct parents with at least one paid order served in the range. */
  activeParents: number;
  /** Paid orders served in the range. Agrees with the headline by construction. */
  paidOrders: number;
  /** `paidOrders / activeParents`. Zero when nobody ordered. */
  ordersPerParent: number;
  /** Parents with two or more paid orders in the range. */
  repeatParents: number;
  /** `repeatParents / activeParents`, or null when nobody ordered and the ratio is undefined. */
  repeatRate: number | null;
  /** Distinct active parents per school id. The per-school table's last column. */
  bySchool: Map<string, number>;
}

export function usageInRange(
  orders: readonly FunnelOrder[],
  from: string,
  to: string,
  schoolId: string | null = null,
): Usage {
  const perParent = new Map<string, number>();
  const perSchool = new Map<string, Set<string>>();
  let paidOrders = 0;

  for (const o of orders) {
    if (!EARNED.has(o.status)) continue;
    // Absent rather than empty: an order with no service date cannot be placed in a range at all,
    // and guessing one from `placed_at` is how a row lands in the wrong week.
    const day = o.serviceDate ?? '';
    if (day < from || day > to || day === '') continue;
    if (schoolId && o.schoolId !== schoolId) continue;

    paidOrders += 1;
    perParent.set(o.customerUserId, (perParent.get(o.customerUserId) ?? 0) + 1);

    const key = o.schoolId ?? '';
    if (key !== '') {
      const seen = perSchool.get(key) ?? new Set<string>();
      seen.add(o.customerUserId);
      perSchool.set(key, seen);
    }
  }

  const activeParents = perParent.size;
  const repeatParents = [...perParent.values()].filter((n) => n >= 2).length;

  return {
    activeParents,
    paidOrders,
    ordersPerParent: activeParents === 0 ? 0 : paidOrders / activeParents,
    repeatParents,
    repeatRate: activeParents === 0 ? null : repeatParents / activeParents,
    bySchool: new Map([...perSchool].map(([id, set]) => [id, set.size])),
  };
}
