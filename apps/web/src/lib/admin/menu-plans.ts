/**
 * What a named menu actually is, and where it is being served — `E10-49`.
 *
 * ## Why a menu needs its own screen
 *
 * A dish exists once; a menu is a **named, reusable set of dishes with prices**, assigned to one
 * or more schools over a date window. Everything about that sentence is invisible on the dish
 * workbench, which shows a dish as "on a menu" and is satisfied.
 *
 * The state this exists to surface is a menu that is **assigned to nobody**. It is invisible in
 * both directions today: the workbench counts its dishes as placed, and the school screen reports
 * a school as having no menu without ever mentioning that a finished one is sitting unused. Two
 * screens each showing half of a problem is how it survives a month.
 *
 * ## Live, scheduled and ended are three states, not two
 *
 * `AdminMenuAssignment` deliberately keeps the dates rather than resolving them away, because
 * *"Paragon's menu starts on the 22nd"* and *"Paragon has no menu"* look identical once the dates
 * are thrown out, and only one of them is a problem. This module keeps that distinction and adds
 * nothing to it: `validTo` is **exclusive**, as `0001`'s constraint and every read in the system
 * treat it.
 */
import type { api } from '@graybag/shared';

export type AssignmentState = 'live' | 'scheduled' | 'ended' | 'revoked';

export interface MenuSchool {
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  state: AssignmentState;
  validFrom: string;
  validTo: string | null;
}

export interface MenuPlan {
  menu: api.AdminMenu;
  /** Every school this menu has ever been assigned to, with what that assignment is doing now. */
  schools: MenuSchool[];
  /** Schools serving it **today**. The number that decides whether a menu is doing anything. */
  liveCount: number;
  /** Menu items that are switched on. A parked item is not on sale. */
  liveItems: number;
  /** Cheapest and dearest live item, in paise. Null when nothing is on sale. */
  priceRange: { lowPaise: number; highPaise: number } | null;
  /**
   * Dishes on this menu that cannot be safely published.
   *
   * Only **blocking** faults, and only one of them: a missing food type. A parent cannot tell
   * whether an untyped dish is vegetarian, which in this market is not a cosmetic gap. A missing
   * photo is untidy and belongs on the workbench; it does not stop a menu going out, and putting
   * it here would make every menu look broken and teach people to ignore the warning.
   */
  untypedDishes: string[];
}

/**
 * Which state an assignment is in on `today`.
 *
 * `validTo` is exclusive — the first day the menu is *not* served — so a menu with
 * `validTo` equal to today has already ended. Getting that backwards serves a menu one day too
 * long, which is the kind of bug that only shows up as a parent ordering something the kitchen
 * has stopped making.
 */
export function assignmentState(a: api.AdminMenuAssignment, today: string): AssignmentState {
  if (a.revokedAt !== null) return 'revoked';
  if (a.validFrom > today) return 'scheduled';
  if (a.validTo !== null && a.validTo <= today) return 'ended';
  return 'live';
}

export function buildMenuPlans(
  menus: readonly api.AdminMenu[],
  assignments: readonly api.AdminMenuAssignment[],
  dishes: readonly api.AdminDish[],
  today: string,
): MenuPlan[] {
  const foodTypeById = new Map(dishes.map((d) => [d.id, d.foodType]));
  const nameById = new Map(dishes.map((d) => [d.id, d.name]));

  const byMenu = new Map<string, MenuSchool[]>();
  for (const a of assignments) {
    const list = byMenu.get(a.menuId) ?? [];
    list.push({
      schoolId: a.schoolId,
      schoolName: a.schoolName,
      schoolCode: a.schoolCode,
      state: assignmentState(a, today),
      validFrom: a.validFrom,
      validTo: a.validTo,
    });
    byMenu.set(a.menuId, list);
  }

  return menus
    .map((menu) => {
      const schools = (byMenu.get(menu.id) ?? []).sort(
        // Live first: it is the only state that means the menu is feeding somebody right now.
        (x, y) => ORDER[x.state] - ORDER[y.state] || x.schoolName.localeCompare(y.schoolName),
      );
      const live = menu.items.filter((i) => i.isActive);
      const prices = live.map((i) => i.pricePaise);

      const untyped = [...new Set(menu.items.map((i) => i.dishId))]
        // A dish the caller could not read is not evidence of a missing food type — it is
        // evidence of a narrower grant, and reporting it as a fault would send somebody looking
        // for a problem that is not there.
        .filter((id) => foodTypeById.has(id) && foodTypeById.get(id) === null)
        .map((id) => nameById.get(id) ?? id)
        .sort((a, b) => a.localeCompare(b));

      return {
        menu,
        schools,
        liveCount: schools.filter((s) => s.state === 'live').length,
        liveItems: live.length,
        priceRange: prices.length === 0
          ? null
          : { lowPaise: Math.min(...prices), highPaise: Math.max(...prices) },
        untypedDishes: untyped,
      };
    })
    .sort(
      // Menus serving nobody first. This screen is opened to find what is not working, and a
      // list sorted by name buries the one row worth acting on among the ones that are fine.
      (a, b) => a.liveCount - b.liveCount || a.menu.name.localeCompare(b.menu.name),
    );
}

const ORDER: Record<AssignmentState, number> = { live: 0, scheduled: 1, ended: 2, revoked: 3 };

/** Menus serving no school today. The headline number, and the reason for the screen. */
export function unassignedCount(plans: readonly MenuPlan[]): number {
  return plans.filter((p) => p.liveCount === 0).length;
}
