// What the file would do to the database, decided before anything is written.
//
// Pure functions over a snapshot of what already exists, so the whole planner is testable with
// object literals and no database. `apply.mjs` executes a plan; it makes no decisions of its own.
//
// ## Create, update, unchanged — and never delete
//
// A row absent from the file is **left alone**. A partial file is the ordinary case on an import
// day: Andy exports the dishes he has changed, not the whole catalogue. Treating absence as
// deletion turns one narrow export into an emptied menu, which is exactly the failure
// `tools/menu-import` put behind `--deactivate-missing`. This tool does not offer the flag,
// because 17 August is not the day to discover what it does.
//
// ## Blockers versus errors
//
// A validation error is a bad row. A **blocker** is a row that is internally fine but cannot be
// written — a dish naming a kitchen that does not exist, a menu naming a dish that is in neither
// the file nor the database. They are reported separately because the fixes are different: one is
// a typo in the row, the other is a missing prerequisite or an import run in the wrong order.

const lower = (s) => (s === null || s === undefined ? '' : String(s).toLowerCase());

/** Fields compared when deciding whether an existing row needs an update. */
const SCHOOL_FIELDS = [
  'name', 'institutionType', 'addressLine1', 'addressLine2', 'postcode',
  'contactName', 'contactEmail', 'contactPhone',
];

const DISH_FIELDS = ['description', 'ingredientsText', 'caloriesKcal', 'portionText', 'foodType', 'isActive'];

/**
 * Only fields the file actually carried are compared.
 *
 * A CSV that omits `description` entirely must not be read as "set every description to null".
 * That distinction — absent versus empty — is why `changedFields` skips `null` on the incoming
 * side rather than treating it as a value, and it is the difference between a narrow update and
 * silently blanking a column across the catalogue.
 */
function changedFields(incoming, existing, fields) {
  const changed = [];
  for (const f of fields) {
    const next = incoming[f];
    if (next === null || next === undefined) continue;
    if (existing[f] !== next) changed.push(f);
  }
  return changed;
}

/**
 * @param records validated school records
 * @param snapshot { schools: [{code,name,...}], kitchens: [{code,id}], cities: [{name,id}] }
 */
export function planSchools(records, snapshot) {
  const byCode = new Map(snapshot.schools.map((s) => [lower(s.code), s]));
  const kitchens = new Set(snapshot.kitchens.map((k) => lower(k.code)));
  const cities = new Map(snapshot.cities.map((c) => [lower(c.code), c]));

  const creates = [];
  const updates = [];
  const unchanged = [];
  const blockers = [];

  for (const r of records) {
    if (!kitchens.has(r.kitchenCode)) {
      blockers.push({
        row: r.__row,
        message:
          `kitchen_code "${r.kitchenCode}" does not exist. Kitchens are not created by import — ` +
          `they are created once, in the admin screen or by hand. Existing: ${[...kitchens].join(', ') || '(none)'}`,
      });
      continue;
    }
    if (!cities.has(lower(r.city))) {
      blockers.push({
        row: r.__row,
        message:
          `city_code "${r.city}" does not exist. Cities are reference data and are not created ` +
          `by import. Existing: ${[...cities.keys()].join(', ') || '(none)'}`,
      });
      continue;
    }

    const existing = byCode.get(r.code);
    if (!existing) {
      creates.push(r);
      continue;
    }

    const changed = changedFields(r, existing, SCHOOL_FIELDS);
    // Config lives on `school_config`, not on `school`, so it is tracked separately: a school
    // whose only change is its cutoff is not a `school` update at all.
    const configChanged = [];
    if (r.serviceDays !== null && String(r.serviceDays) !== String(existing.serviceDays ?? '')) configChanged.push('service_days');
    if (r.cutoffTime !== null && r.cutoffTime !== (existing.cutoffTime ?? null)) configChanged.push('order_cutoff_time');
    if (r.cutoffDaysBefore !== null && r.cutoffDaysBefore !== (existing.cutoffDaysBefore ?? null)) configChanged.push('order_cutoff_days_before');

    if (changed.length === 0 && configChanged.length === 0) unchanged.push({ ...r, id: existing.id });
    else updates.push({ ...r, id: existing.id, changed, configChanged });
  }

  return { creates, updates, unchanged, blockers };
}

export function planDishes(records, snapshot) {
  const kitchens = new Set(snapshot.kitchens.map((k) => lower(k.code)));
  const categories = new Set(snapshot.categories.map((c) => lower(c.code)));
  const allergens = new Set(snapshot.allergens.map((a) => lower(a.code)));
  const byKey = new Map(snapshot.dishes.map((d) => [`${lower(d.kitchenCode)}::${lower(d.name)}`, d]));

  const creates = [];
  const updates = [];
  const unchanged = [];
  const blockers = [];

  for (const r of records) {
    if (!kitchens.has(r.kitchenCode)) {
      blockers.push({ row: r.__row, message: `kitchen_code "${r.kitchenCode}" does not exist` });
      continue;
    }
    if (!categories.has(lower(r.category))) {
      blockers.push({
        row: r.__row,
        message:
          `category "${r.category}" is not one of the seeded category CODES: ${[...categories].join(', ')}. ` +
          `Use the code (quick_bites), not the display name (Quick Bites) — categories are ` +
          `reference data, and a typo here would silently want a second "Beverages"`,
      });
      continue;
    }

    // An unknown allergen code is a BLOCKER, never a warning. `dish_allergen` and
    // `recipient_allergen` share one vocabulary, and a code that matches nothing means the
    // allergen warning silently never fires for that dish — which is the one failure on this
    // whole screen that could hurt a child.
    const unknown = r.allergens.filter((a) => !allergens.has(a));
    if (unknown.length > 0) {
      blockers.push({
        row: r.__row,
        message:
          `unknown allergen code(s): ${unknown.join(', ')}. Valid codes: ${[...allergens].join(', ')}. ` +
          `These are CODES, not labels — an unmatched code means the allergy warning never fires ` +
          `for this dish, silently`,
      });
      continue;
    }

    const existing = byKey.get(`${r.kitchenCode}::${lower(r.name)}`);
    if (!existing) {
      creates.push(r);
      continue;
    }

    const changed = changedFields(r, existing, DISH_FIELDS);
    const before = [...(existing.allergens ?? [])].map(lower).sort().join(',');
    const after = [...r.allergens].sort().join(',');
    // Allergens are only compared when the file said something. A blank column means "not
    // supplied", and reading it as "remove every allergen" is the same silent-blanking failure.
    if (r.allergens.length > 0 && before !== after) changed.push('allergens');

    if (changed.length === 0) unchanged.push({ ...r, id: existing.id });
    else updates.push({ ...r, id: existing.id, changed });
  }

  return { creates, updates, unchanged, blockers };
}

/**
 * Menus, their items, and their assignments to schools.
 *
 * Rows are grouped into menus here rather than in validation, because grouping is a decision
 * about the plan and validation is a decision about a row.
 */
export function planMenus(records, snapshot) {
  const kitchens = new Set(snapshot.kitchens.map((k) => lower(k.code)));
  const schools = new Set(snapshot.schools.map((s) => lower(s.code)));
  const dishesByKey = new Map(snapshot.dishes.map((d) => [`${lower(d.kitchenCode)}::${lower(d.name)}`, d]));
  // **Menus are matched on their NAME**, because `menu` has no code column — `D4` deliberately
  // removed the legacy identifiers, and the name is the only stable stored handle there is.
  //
  // The file's `menu_code` groups rows *within the file*; it is not what identifies the menu in
  // the database. Keying this map on `menu_code` was the first version and it matched nothing,
  // so every run created a fresh menu and the third run tripped
  // `menu_assignment_no_overlap` — two live assignments of two identical menus to one school.
  // Caught by running the importer three times, which is the only thing that finds it.
  const menusByKey = new Map(snapshot.menus.map((m) => [`${lower(m.kitchenCode)}::${lower(m.name)}`, m]));

  // Dishes AND schools created earlier in the same run count as existing. Without this a single
  // file set describing a new school, its dishes and its menu blocks on its own first half — which
  // is the ordinary way this tool will be used, not an edge case.
  const pendingDishes = new Set((snapshot.pendingDishes ?? []).map((d) => `${lower(d.kitchenCode)}::${lower(d.name)}`));
  const pendingSchools = new Set((snapshot.pendingSchools ?? []).map((s) => lower(s.code)));

  const blockers = [];
  const menus = new Map();

  for (const r of records) {
    if (!kitchens.has(r.kitchenCode)) {
      blockers.push({ row: r.__row, message: `kitchen_code "${r.kitchenCode}" does not exist` });
      continue;
    }
    const dishKey = `${r.kitchenCode}::${lower(r.dishName)}`;
    if (!dishesByKey.has(dishKey) && !pendingDishes.has(dishKey)) {
      blockers.push({
        row: r.__row,
        message:
          `dish "${r.dishName}" does not exist at kitchen "${r.kitchenCode}", and is not being ` +
          `created by this run. Import dishes before menus, or include the dish file in the same run`,
      });
      continue;
    }
    if (r.schoolCode !== null && !schools.has(r.schoolCode) && !pendingSchools.has(r.schoolCode)) {
      blockers.push({
        row: r.__row,
        message:
          `school_code "${r.schoolCode}" does not exist, and is not being created by this run. ` +
          `Import schools before menus, or include the schools file in the same run`,
      });
      continue;
    }

    // Grouped by `menu_code` (the file's own handle) but LOOKED UP by name (the stored one).
    const key = `${r.kitchenCode}::${r.menuCode}`;
    if (!menus.has(key)) {
      const existing = menusByKey.get(`${r.kitchenCode}::${lower(r.menuName)}`);
      menus.set(key, {
        code: r.menuCode,
        name: r.menuName,
        kitchenCode: r.kitchenCode,
        id: existing?.id ?? null,
        isNew: !existing,
        items: [],
        assignments: new Map(),
        rows: [],
      });
    }
    const menu = menus.get(key);
    menu.rows.push(r.__row);
    menu.items.push({
      dishName: r.dishName,
      pricePaise: r.pricePaise,
      availableDays: r.availableDays,
      sortOrder: r.sortOrder,
      row: r.__row,
    });

    if (r.schoolCode !== null) {
      // One assignment per (school, validity) — repeating the school on every dish row of a menu
      // is what a spreadsheet naturally produces, and it must not become 40 assignments.
      const aKey = `${r.schoolCode}::${r.validFrom ?? ''}::${r.validTo ?? ''}`;
      if (!menu.assignments.has(aKey)) {
        menu.assignments.set(aKey, {
          schoolCode: r.schoolCode,
          validFrom: r.validFrom,
          validTo: r.validTo,
          row: r.__row,
        });
      }
    }
  }

  // Does this menu actually change anything?
  //
  // Without this every re-run reported "1 change" and "3 writes" while the database was already
  // correct — the upserts were no-ops but the REPORT was not, and a dry run that overstates what
  // it will do is a dry run nobody reads twice. `price_paise` arrives from PostgREST as a number
  // and `available_days` as an array, so both are compared by value.
  const storedItems = snapshot.menuItems ?? [];
  for (const menu of menus.values()) {
    if (menu.isNew) {
      menu.changed = true;
      continue;
    }
    const mine = storedItems.filter((i) => i.menuId === menu.id);
    const byName = new Map(mine.map((i) => [lower(i.dishName), i]));
    menu.changed = menu.items.some((item) => {
      const stored = byName.get(lower(item.dishName));
      if (!stored) return true;
      return (
        Number(stored.pricePaise) !== Number(item.pricePaise) ||
        String(stored.availableDays) !== String(item.availableDays) ||
        Number(stored.sortOrder) !== Number(item.sortOrder)
      );
    });
  }

  // An assignment with no validity has nowhere to start. Reported once per menu rather than per
  // row, because the operator's fix is one column on the whole block.
  for (const menu of menus.values()) {
    for (const a of menu.assignments.values()) {
      if (a.validFrom === null) {
        blockers.push({
          row: a.row,
          message:
            `menu "${menu.code}" is assigned to school "${a.schoolCode}" with no valid_from. ` +
            `An assignment needs a start date — valid_to may be blank for open-ended`,
        });
      }
    }
  }

  return { menus: [...menus.values()], blockers };
}

/** Everything is a no-op and nothing is broken. */
export const planIsEmpty = (plan) =>
  plan.creates.length === 0 && plan.updates.length === 0;
