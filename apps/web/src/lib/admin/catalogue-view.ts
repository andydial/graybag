/**
 * Making the catalogue readable — `E10-22`.
 *
 * Pure functions over the shapes `api.fetchAdminDishes`, `fetchAdminMenus`, `fetchAdminSchools`
 * and `fetchMenuAssignments` return. The page fetches and draws; this file decides what the answer
 * is. Same split as `launch-checks.mjs`, for the same reason — the questions being answered here
 * are the ones somebody is about to trust the seeded data on.
 *
 * ## The question this exists for
 *
 * "Is Gem seeded correctly?" was unanswerable from any screen. Menus and schools were each
 * visible alone, dishes were listed in one long wall, and nothing joined them. Four days before
 * parents arrive, that is the only question worth asking, so it gets its own view rather than a
 * filter somebody has to know to apply.
 */
import { api } from '@graybag/shared';

type AdminDish = api.AdminDish;
type AdminMenu = api.AdminMenu;
type AdminMenuAssignment = api.AdminMenuAssignment;
type AdminSchool = api.AdminSchool;
const { isAssignmentLive } = api;

/** One school, and what a parent at that school would actually see today. */
export interface SchoolMenuRow {
  school: AdminSchool;
  /** The assignment in force today, with its menu resolved. Null means parents see nothing. */
  live: { assignment: AdminMenuAssignment; menu: AdminMenu | null } | null;
  /** Assignments that start later. Kept because "starts on the 22nd" is not "has no menu". */
  upcoming: AdminMenuAssignment[];
  /** Orderable dishes today: on the live menu, active there, and marked. */
  orderable: number;
  /**
   * Why a school cannot be ordered from, in the order somebody would fix them. Empty is good.
   * Deliberately about *ordering*, never about tidiness — a list that reports style gets skimmed.
   */
  problems: string[];
}

/**
 * A dish is orderable only when every one of these holds. They are separate checks because each
 * has a different fix and a different owner, and "not orderable" without which of them is failing
 * sends somebody to the wrong screen.
 */
function orderableOn(menu: AdminMenu | null, dishes: Map<string, AdminDish>): number {
  if (!menu) return 0;
  return menu.items.filter((item) => {
    if (!item.isActive) return false;
    const dish = dishes.get(item.dishId);
    // A retired dish still has its menu row; `is_active` on the dish is the catalogue-wide switch
    // and it wins over the per-menu one.
    return dish !== undefined && dish.isActive && dish.foodType !== null;
  }).length;
}

/**
 * @param today an **IST** service date, `YYYY-MM-DD`. Passed in, never read from the clock — see
 *   `isAssignmentLive`.
 */
export function schoolMenuRows(
  schools: AdminSchool[],
  assignments: AdminMenuAssignment[],
  menus: AdminMenu[],
  dishes: AdminDish[],
  today: string,
): SchoolMenuRow[] {
  const byMenuId = new Map(menus.map((m) => [m.id, m]));
  const byDishId = new Map(dishes.map((d) => [d.id, d]));

  return schools
    .map((school) => {
      const mine = assignments.filter((a) => a.schoolId === school.id);
      const liveAssignment = mine.find((a) => isAssignmentLive(a, today)) ?? null;
      const menu = liveAssignment ? (byMenuId.get(liveAssignment.menuId) ?? null) : null;
      const upcoming = mine
        .filter((a) => a.revokedAt === null && a.validFrom > today)
        .sort((a, b) => a.validFrom.localeCompare(b.validFrom));

      const orderable = orderableOn(menu, byDishId);
      const problems: string[] = [];

      if (!school.isActive || school.onboardedAt === null) {
        // First, because nothing below it matters while this is true — the school is not in the
        // parent-facing picker at all (`P1`).
        problems.push('Not onboarded — this school does not appear in the app’s school picker');
      }
      if (!liveAssignment) {
        problems.push(
          upcoming.length > 0
            ? `No menu today — the next one starts ${upcoming[0]!.validFrom}`
            : 'No menu assigned — parents at this school see an empty menu',
        );
      } else if (!menu) {
        // An assignment pointing at a menu that did not come back. Almost always a revoked or
        // deleted menu, and it looks identical to "assigned" on any screen that does not join.
        problems.push('Assigned to a menu that no longer exists');
      } else if (menu.items.length === 0) {
        problems.push('The assigned menu has no dishes on it');
      } else if (orderable === 0) {
        problems.push('No dish on the menu can be ordered — every one is inactive or unmarked');
      }

      return { school, live: liveAssignment ? { assignment: liveAssignment, menu } : null, upcoming, orderable, problems };
    })
    .sort((a, b) => a.school.name.localeCompare(b.school.name));
}

/** The options on the dish-list filter, each with its own count so the numbers are visible first. */
export interface MenuFilterOption {
  value: string;
  label: string;
  count: number;
}

export const ALL_DISHES = 'all';
export const NO_MENU = 'none';

export function menuFilterOptions(dishes: AdminDish[], menus: AdminMenu[]): MenuFilterOption[] {
  const onAnyMenu = new Set(menus.flatMap((m) => m.items.map((i) => i.dishId)));
  return [
    { value: ALL_DISHES, label: 'All dishes', count: dishes.length },
    ...menus.map((m) => ({
      value: m.id,
      label: m.name,
      // Every row on the menu, active or not. The filter answers "what is on this menu", and a
      // parked dish is on it — the row says so separately.
      count: new Set(m.items.map((i) => i.dishId)).size,
    })),
    {
      value: NO_MENU,
      label: 'Not on any menu',
      count: dishes.filter((d) => !onAnyMenu.has(d.id)).length,
    },
  ];
}

export function filterDishes(dishes: AdminDish[], menus: AdminMenu[], filter: string): AdminDish[] {
  if (filter === ALL_DISHES) return dishes;
  if (filter === NO_MENU) {
    const onAnyMenu = new Set(menus.flatMap((m) => m.items.map((i) => i.dishId)));
    return dishes.filter((d) => !onAnyMenu.has(d.id));
  }
  const menu = menus.find((m) => m.id === filter);
  if (!menu) return dishes;
  const on = new Set(menu.items.map((i) => i.dishId));
  return dishes.filter((d) => on.has(d.id));
}

/** Which menus a dish is on, and at what price — shown on the dish itself so the join is visible. */
export interface DishPlacement {
  menuId: string;
  menuName: string;
  pricePaise: number;
  availableDays: number[];
  isActive: boolean;
}

export function placementsFor(dishId: string, menus: AdminMenu[]): DishPlacement[] {
  return menus.flatMap((m) =>
    m.items
      .filter((i) => i.dishId === dishId)
      .map((i) => ({
        menuId: m.id,
        menuName: m.name,
        pricePaise: i.pricePaise,
        availableDays: i.availableDays,
        isActive: i.isActive,
      })),
  );
}
