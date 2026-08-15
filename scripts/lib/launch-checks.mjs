// What an environment is missing before it can take a real order — `E17-52`.
//
// Pure functions over a snapshot, so every rule is testable with object literals and no database.
// `scripts/check-launch.mjs` fetches the snapshot and prints; this file decides.
//
// ## What counts as a finding
//
// Only things that **stop a parent ordering, or make an order wrong**. Not style, not tidiness,
// not "you might also want to". A launch check that reports twelve things when two matter gets
// skimmed on the morning it matters most, and the two get missed.
//
// Each finding carries the fix, not just the fault. On 17 August the person reading this is
// alone, and "3 schools have no menu" without the command to fix it is half an answer.

/** `blocker` stops ordering outright. `warning` degrades it. Nothing else exists on purpose. */
export const BLOCKER = 'blocker';
export const WARNING = 'warning';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {object} s snapshot — see `check-launch.mjs`
 * @returns {{level: string, title: string, detail: string, fix: string}[]}
 */
export function findings(s) {
  const out = [];
  const activeSchools = s.schools.filter((x) => x.isActive);

  // ------------------------------------------------------------------- the allergen vocabulary
  //
  // First, because it is the only finding here that fails *silently on a safety path*. Production
  // had zero rows in `allergen`, and nothing said so: `dish_allergen` and `recipient_allergen`
  // share this vocabulary, and the match between them is the whole mechanism of an allergy
  // warning. Empty means no dish can be tagged, no child's allergy can be recorded, and the
  // kitchen's badges never fire — all of which looks exactly like "nobody has any allergies".
  //
  // Checked before anything else because a missing allergen is worse than a missing menu, and a
  // missing menu is at least loud.
  const liveAllergens = (s.allergens ?? []).filter((a) => a.isActive);
  if (liveAllergens.length === 0) {
    out.push({
      level: BLOCKER,
      title: 'no allergens exist at all — every allergy warning is silently disabled',
      detail:
        'The `allergen` table is empty. `dish_allergen` and `recipient_allergen` both reference ' +
        'it, so no dish can be tagged, no parent can record a child’s allergy, and the kitchen ' +
        'board and packing sheet show no flags. Nothing errors — it reads as "nobody has any ' +
        'allergies", on a product that feeds children.',
      fix: 'Apply supabase/migrations/0063_allergen_vocabulary.sql. Tagging which dish contains what is separate, and is yours.',
    });
  }

  // ---------------------------------------------------------------- dishes without a food type
  //
  // First because it is the one that was actually wrong in production: 79 of 79.
  const unmarked = s.dishes.filter((d) => d.isActive && d.foodType === null);
  if (unmarked.length > 0) {
    const offered = new Set(s.menuItems.filter((i) => i.isActive).map((i) => i.dishId));
    const live = unmarked.filter((d) => offered.has(d.id));
    out.push({
      level: live.length > 0 ? BLOCKER : WARNING,
      title: `${plural(unmarked.length, 'dish', 'dishes')} with no veg / non-veg / egg marking`,
      detail:
        live.length > 0
          ? `${plural(live.length, 'of them is', 'of them are')} on a live menu right now. A parent ` +
            `cannot tell whether they are vegetarian, and in this market that is the first thing ` +
            `many families check.`
          : 'None is on a live menu yet, so nothing is being offered unmarked — but any attempt ' +
            'to put one on a menu will now be refused.',
      fix:
        'Open /admin/menus, "Select the N with no food type", then Veg — and correct the few that ' +
        'are not. Or: --export-dishes dishes.csv, fill the food_type column, hand it back.',
      names: unmarked.slice(0, 8).map((d) => d.name),
      more: Math.max(0, unmarked.length - 8),
    });
  }

  // ---------------------------------------------------------------- schools with no live menu
  const assignedSchools = new Set(s.assignments.filter((a) => a.isLive).map((a) => a.schoolId));
  const noMenu = activeSchools.filter((x) => !assignedSchools.has(x.id));
  if (noMenu.length > 0) {
    out.push({
      level: BLOCKER,
      title: `${plural(noMenu.length, 'school has', 'schools have')} no menu today`,
      detail:
        'An active school with no live menu assignment shows a parent an empty menu. Nothing ' +
        'can be ordered and the app cannot explain why.',
      fix: 'Assign a menu with tools/bulk-import — the menu file carries school_code and valid_from.',
      names: noMenu.map((x) => x.code),
      more: 0,
    });
  }

  // ---------------------------------------------------------------- schools with no break window
  //
  // `P19`: a school with no windows cannot be ordered from and says so. That is a correct state,
  // and it is still a launch blocker if it is unintentional — which for an onboarded school it is.
  const withBreaks = new Set(s.breakTimes.filter((b) => b.isActive).map((b) => b.schoolId));
  const noBreaks = activeSchools.filter((x) => x.onboardedAt !== null && !withBreaks.has(x.id));
  if (noBreaks.length > 0) {
    out.push({
      level: BLOCKER,
      title: `${plural(noBreaks.length, 'onboarded school has', 'onboarded schools have')} no break windows`,
      detail:
        'P19: a school with no windows cannot be ordered from at all. The app says so rather than ' +
        'failing, but no order can be placed.',
      fix: 'Add break_time rows for the school. The parent picks one at checkout.',
      names: noBreaks.map((x) => x.code),
      more: 0,
    });
  }

  // ---------------------------------------------------------------- break labels
  //
  // `E05-30` / `P20`: the picker shows the label, with the times underneath. A label that IS the
  // time range therefore renders as "10:40AM - 11:15AM 10:40–11:15" — and a parent choosing
  // between two breaks reads a duplicated time instead of "Morning break". Andy's brief was
  // explicit that a parent should not have to read raw data to choose.
  //
  // A warning, not a blocker: ordering works, it just reads badly.
  const rawLabels = s.breakTimes.filter(
    (b) => b.isActive && b.label !== undefined && /^\s*\d{1,2}[:.]\d{2}\s*(am|pm)?\s*[-–]/i.test(b.label),
  );
  if (rawLabels.length > 0) {
    out.push({
      level: WARNING,
      title: `${plural(rawLabels.length, 'break window')} labelled with its own time range`,
      detail:
        'The picker shows the label with the times underneath, so these render as the time twice. ' +
        'P20: a parent should not have to read raw data to choose a break.',
      fix: 'Rename them — "Morning break", "Second break". The times stay where they are.',
      names: [...new Set(rawLabels.map((b) => b.label))],
      more: 0,
    });
  }

  // ---------------------------------------------------------------- onboarding
  const notOnboarded = activeSchools.filter((x) => x.onboardedAt === null);
  if (notOnboarded.length > 0) {
    out.push({
      level: BLOCKER,
      title: `${plural(notOnboarded.length, 'school is', 'schools are')} active but never onboarded`,
      detail:
        'P1: only an onboarded school appears in the app\'s picker. These are invisible to every ' +
        'parent, which looks identical to the school not existing.',
      fix: 'Set onboarded_at — /admin/schools shows which, and the importer sets it on create.',
      names: notOnboarded.map((x) => x.code),
      more: 0,
    });
  }

  // ---------------------------------------------------------------- service days
  //
  // A warning, not a blocker: null means "inherit", and the platform default is all seven days,
  // so ordering works. It is worth saying because "we do not serve Saturdays" is the commonest
  // thing a school assumes was configured when it was not.
  const noServiceDays = activeSchools.filter((x) => x.serviceDays === null);
  if (noServiceDays.length > 0) {
    out.push({
      level: WARNING,
      title: `${plural(noServiceDays.length, 'school has', 'schools have')} no service days set`,
      detail:
        'They inherit the platform default, which is all seven days — so parents can order for ' +
        'Sundays. That is correct only if it is intended.',
      fix: 'Set them per school on /admin/config, or in the schools CSV.',
      names: noServiceDays.map((x) => x.code),
      more: 0,
    });
  }

  // ---------------------------------------------------------------- the money question
  //
  // `[DM-14]`. `price_is_tax_inclusive` is deliberately NULL until answered, and the tax
  // calculation refuses to run without it. That makes it a hard blocker on taking any money.
  if (s.platformConfig.priceIsTaxInclusive === null) {
    out.push({
      level: BLOCKER,
      title: 'platform_config.price_is_tax_inclusive is not set',
      detail:
        '[DM-14]. The tax calculation refuses to run until this is answered, so no checkout can ' +
        'complete. Menu prices are GST-exclusive by decision — this column has to say so.',
      fix: 'Set it to false (prices are exclusive; 5% is added at checkout).',
      names: [],
      more: 0,
    });
  }

  // ---------------------------------------------------------------- menus with nothing on them
  const emptyMenus = s.menus.filter(
    (m) => !s.menuItems.some((i) => i.menuId === m.id && i.isActive),
  );
  if (emptyMenus.length > 0) {
    out.push({
      level: BLOCKER,
      title: `${plural(emptyMenus.length, 'menu has', 'menus have')} no dishes on offer`,
      detail: 'A school pointed at one of these sees an empty menu.',
      fix: 'Add items with tools/bulk-import, or activate the ones that are parked.',
      names: emptyMenus.map((m) => m.name),
      more: 0,
    });
  }

  // ---------------------------------------------------------------- secrets and settings
  for (const missing of s.missingSecrets) {
    out.push({
      level: BLOCKER,
      title: `${missing.name} is not set`,
      detail: missing.why,
      fix: missing.fix,
      names: [],
      more: 0,
    });
  }

  return out;
}

/** Blockers first, then warnings; stable within each. */
export function ranked(list) {
  return [...list].sort((a, b) => (a.level === b.level ? 0 : a.level === BLOCKER ? -1 : 1));
}

export function summarise(list) {
  const blockers = list.filter((f) => f.level === BLOCKER).length;
  const warnings = list.length - blockers;
  return { blockers, warnings, ready: blockers === 0 };
}
