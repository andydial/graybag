/**
 * Is this school ready to take an order, and if not, what is missing — `E10-41`.
 *
 * ## Why a checklist and not a status
 *
 * Andy: *"School and menu setup feels error-prone — I can't tell at a glance what state a school
 * is in."* The old screen showed one label, **"Open to parents"**, derived from `onboarded_at` and
 * `is_active` alone. A school could carry that label with no menu, no break windows and no service
 * days, and a parent opening the app would find it and be unable to order from it.
 *
 * Four separate things have to be true, they fail independently, each has a different fix on a
 * different screen, and **any one of them missing looks identical to a parent**: the school is
 * there and nothing can be bought. So the model is a list of gates, each carrying its own fix,
 * rather than a status anybody has to interpret.
 *
 * ## Ordered by what blocks what
 *
 * Onboarding first, because until it passes the school is not in the picker and nothing below it
 * can matter. Then the menu, then the break windows, then service days. The report contact is last
 * and is deliberately **not** blocking: a school with no contact email can still be ordered from,
 * it just cannot be sent its monthly report.
 */
import { api } from '@graybag/shared';

import { schoolMenuRows } from './catalogue-view.js';
import type { SchoolMenuRow } from './catalogue-view.js';

type AdminSchool = api.AdminSchool;

export type GateState = 'ok' | 'missing' | 'warning';

export interface Gate {
  key: 'onboarded' | 'menu' | 'breaks' | 'serviceDays' | 'contact';
  label: string;
  state: GateState;
  /** What is true right now, in a few words. Shown whether it passes or not. */
  detail: string;
  /** Where to go. Null when there is nothing to do. */
  fix: { label: string; href: string } | null;
  /** `false` for the report contact — it is a gap, not a blocker. */
  blocking: boolean;
}

export type SchoolState = 'live' | 'scheduled' | 'incomplete';

export interface SchoolReadiness {
  school: AdminSchool;
  menu: SchoolMenuRow;
  gates: Gate[];
  state: SchoolState;
  /** Blocking gates that are not `ok`. Empty means a parent can order today. */
  blockers: Gate[];
}

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const days = (list: number[]) =>
  list.length === 7 ? 'every day' : list.map((d) => WEEKDAY[d - 1]).join(', ');

export function readiness(
  schools: AdminSchool[],
  assignments: api.AdminMenuAssignment[],
  menus: api.AdminMenu[],
  dishes: api.AdminDish[],
  breaks: api.SchoolBreakWindow[],
  serviceDays: Map<string, number[]>,
  today: string,
): SchoolReadiness[] {
  const menuRows = new Map(
    schoolMenuRows(schools, assignments, menus, dishes, today).map((r) => [r.school.id, r]),
  );

  return schools.map((school) => {
    const menu = menuRows.get(school.id)!;
    const myBreaks = breaks.filter((b) => b.schoolId === school.id && b.isActive);
    const mySchoolDays = serviceDays.get(school.id) ?? null;

    const gates: Gate[] = [];

    // 1. Onboarding. Until this passes the school is not in the parent-facing picker at all (`P1`),
    //    so nothing below it can matter yet.
    const onboarded = school.isActive && school.onboardedAt !== null;
    gates.push({
      key: 'onboarded',
      label: 'In the app',
      state: onboarded ? 'ok' : 'missing',
      detail: onboarded
        ? `Onboarded ${school.onboardedAt?.slice(0, 10)}`
        : school.onboardedAt === null
          ? 'Never onboarded — parents cannot pick this school'
          : 'Deactivated — parents cannot pick this school',
      fix: onboarded ? null : { label: 'Onboard', href: '/admin/schools' },
      blocking: true,
    });

    // 2. A menu that is live today, with something on it that can actually be ordered.
    const liveMenu = menu.live?.menu ?? null;
    const upcoming = menu.upcoming[0] ?? null;
    let menuState: GateState = 'ok';
    let menuDetail: string;
    if (!menu.live && upcoming) {
      menuState = 'warning';
      menuDetail = `${upcoming.menuName} starts ${upcoming.validFrom}`;
    } else if (!menu.live) {
      menuState = 'missing';
      menuDetail = 'No menu — a parent sees an empty menu';
    } else if (!liveMenu) {
      menuState = 'missing';
      menuDetail = 'Assigned to a menu that no longer exists';
    } else if (menu.orderable === 0) {
      menuState = 'missing';
      menuDetail = `${liveMenu.name} — but nothing on it can be ordered`;
    } else {
      menuDetail = `${liveMenu.name} — ${menu.orderable} of ${liveMenu.items.length} orderable`;
    }
    gates.push({
      key: 'menu',
      label: 'Menu',
      state: menuState,
      detail: menuDetail,
      fix: menuState === 'ok' ? null : { label: 'Dishes and menus', href: '/admin/menus' },
      blocking: true,
    });

    // 3. Break windows. `P19` — with none, the school cannot be ordered from at all.
    gates.push({
      key: 'breaks',
      label: 'Break windows',
      state: myBreaks.length > 0 ? 'ok' : 'missing',
      detail: myBreaks.length > 0
        ? myBreaks.map((b) => `${b.label} ${b.startsAt.slice(0, 5)}–${b.endsAt.slice(0, 5)}`).join(' · ')
        : 'None — nothing can be ordered, whatever else is set',
      fix: myBreaks.length > 0 ? null : { label: 'Set them', href: '/admin/config' },
      blocking: true,
    });

    // 4. Service days. Inheriting is not an error — but the platform default is all seven, so a
    //    school that inherits accepts Sunday orders, and that is worth saying out loud rather than
    //    leaving to be discovered by a parent ordering for a Sunday.
    gates.push({
      key: 'serviceDays',
      label: 'Service days',
      state: mySchoolDays ? 'ok' : 'warning',
      detail: mySchoolDays
        ? days(mySchoolDays)
        : 'Inherited — the platform default is all seven days, including Sunday',
      fix: mySchoolDays ? null : { label: 'Set them', href: '/admin/config' },
      blocking: false,
    });

    // 5. Where the monthly report goes. A gap, never a blocker: ordering works without it.
    const contact = school.contactEmail;
    gates.push({
      key: 'contact',
      label: 'Report contact',
      state: contact ? 'ok' : 'warning',
      detail: contact ?? 'None — the monthly report has nowhere to go',
      fix: contact ? null : { label: 'Add one', href: '/admin/schools' },
      blocking: false,
    });

    // `missing` blocks; `warning` informs. A menu that starts next term is a blocking *gate* in a
    // warning *state* — it is not wrong, it is not yet. Counting it as a blocker made a correctly
    // configured school read as broken, which is the exact confusion this screen removes.
    const blockers = gates.filter((g) => g.blocking && g.state === 'missing');
    const scheduled = blockers.length === 0 && gates.some((g) => g.key === 'menu' && g.state === 'warning');
    const state: SchoolState =
      blockers.length > 0 ? 'incomplete' : scheduled ? 'scheduled' : 'live';

    return { school, menu, gates, state, blockers };
  }).sort((a, b) => {
    // Incomplete first. This screen exists to show what needs doing, so the schools that need
    // nothing sort to the bottom — the opposite of alphabetical, and deliberately so.
    const rank = { incomplete: 0, scheduled: 1, live: 2 } as const;
    return rank[a.state] - rank[b.state] || a.school.name.localeCompare(b.school.name);
  });
}

/** One line for the whole estate, for the top of the screen. */
export function estate(list: SchoolReadiness[]) {
  return {
    total: list.length,
    live: list.filter((r) => r.state === 'live').length,
    scheduled: list.filter((r) => r.state === 'scheduled').length,
    incomplete: list.filter((r) => r.state === 'incomplete').length,
  };
}
