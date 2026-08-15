// The reads and writes. `connect()` lives in `connect.mjs`, so this file imports **nothing** —
// every function here takes the client as an argument, which is what lets `snapshot()` run in a
// browser against the api/ module (`E10-29`) instead of being reimplemented there.
//
// ## Why the service role, and why that is allowed here
//
// `config/eslint-api-module.js` scopes the api-module ban to `apps/**` and `packages/**`.
// `tools/**` is deliberately outside it — `tools/seed-kitchen-day` and `tools/menu-import`
// already work this way. The reasoning holds: `A4`'s promise is that the *application* can be
// put behind an API server without a rewrite, and a one-off batch job run from a laptop is not
// the application.
//
// It does mean this file bypasses RLS entirely. So it is small, it is the only place with the
// key, and it never takes a table name from input.
//
// ## Reads are snapshots, writes are explicit
//
// `snapshot()` pulls everything the planner needs in one pass. The planner then decides, and
// `apply()` performs exactly what the plan says. Nothing in this file decides whether a row
// should change.


const rows = async (query, what) => {
  const { data, error } = await query;
  if (error) throw new Error(`reading ${what}: ${error.message}`);
  return data ?? [];
};

/**
 * Everything the planner needs, read once.
 *
 * Read in full rather than filtered to what the file mentions, because the planner has to answer
 * "does this kitchen exist" and "is this category one of the seeded ones" — questions about the
 * whole set, not about the rows in hand. These tables are small: a few kitchens, a few hundred
 * dishes.
 */
export async function snapshot(db) {
  const [cities, kitchens, schools, schoolConfigs, categories, allergens, dishes, dishAllergens, menus, breakTimes, menuItems] =
    await Promise.all([
      rows(db.from('city').select('id,code,name'), 'cities'),
      rows(db.from('kitchen').select('id,code,name'), 'kitchens'),
      rows(db.from('school').select('id,code,name,city_id,kitchen_id,institution_type,address_line1,address_line2,postcode,contact_name,contact_email,contact_phone,is_active,onboarded_at'), 'schools'),
      rows(db.from('school_config').select('school_id,service_days,order_cutoff_time,order_cutoff_days_before'), 'school config'),
      rows(db.from('dish_category').select('id,code,display_name'), 'dish categories'),
      rows(db.from('allergen').select('id,code'), 'allergens'),
      rows(db.from('dish').select('id,kitchen_id,name,description,ingredients_text,calories_kcal,portion_text,food_type,category_id,is_active'), 'dishes'),
      rows(db.from('dish_allergen').select('dish_id,allergen_id'), 'dish allergens'),
      rows(db.from('menu').select('id,kitchen_id,name,status'), 'menus'),
      rows(db.from('break_time').select('id,school_id,code,label,starts_at,ends_at,sort_order,is_active'), 'break times'),
      rows(db.from('menu_item').select('menu_id,dish_id,price_paise,available_days,sort_order'), 'menu items'),
    ]);

  const kitchenCodeById = new Map(kitchens.map((k) => [k.id, k.code]));
  const allergenCodeById = new Map(allergens.map((a) => [a.id, a.code]));
  const configBySchool = new Map(schoolConfigs.map((c) => [c.school_id, c]));

  const allergensByDish = new Map();
  for (const da of dishAllergens) {
    if (!allergensByDish.has(da.dish_id)) allergensByDish.set(da.dish_id, []);
    allergensByDish.get(da.dish_id).push(allergenCodeById.get(da.allergen_id));
  }

  return {
    raw: { cities, kitchens, categories, allergens },
    // Matched on `code`, never on the display name. `city.name` is "SAS Nagar (Mohali)" —
    // a value nobody types the same way twice, and a mismatch would read as "city does not
    // exist" on a row that is otherwise perfect.
    cities: cities.map((c) => ({ id: c.id, code: c.code, name: c.name })),
    kitchens: kitchens.map((k) => ({ id: k.id, code: k.code })),
    categories: categories.map((c) => ({ id: c.id, code: c.code, name: c.display_name })),
    allergens: allergens.map((a) => ({ id: a.id, code: a.code })),
    schools: schools.map((s) => {
      const cfg = configBySchool.get(s.id);
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        institutionType: s.institution_type,
        addressLine1: s.address_line1,
        addressLine2: s.address_line2,
        postcode: s.postcode,
        contactName: s.contact_name,
        contactEmail: s.contact_email,
        contactPhone: s.contact_phone,
        // Read because `exportBreakTimes` and `planBreakTimes` both ask "is this school actually
        // open" — a deactivated or never-onboarded school reaches no parent, so offering to fix
        // its break windows would be noise. Absent from this snapshot until `E05-30`, which made
        // every school look inactive and silently produced an export with no template rows.
        isActive: s.is_active !== false,
        onboardedAt: s.onboarded_at ?? null,
        serviceDays: cfg?.service_days ?? null,
        cutoffTime: cfg?.order_cutoff_time ?? null,
        cutoffDaysBefore: cfg?.order_cutoff_days_before ?? null,
      };
    }),
    dishes: dishes.map((d) => ({
      id: d.id,
      name: d.name,
      kitchenCode: kitchenCodeById.get(d.kitchen_id),
      description: d.description,
      ingredientsText: d.ingredients_text,
      caloriesKcal: d.calories_kcal,
      portionText: d.portion_text,
      foodType: d.food_type,
      isActive: d.is_active,
      allergens: allergensByDish.get(d.id) ?? [],
    })),
    // `menu` has no `code` column — `D4` deliberately removed the legacy identifiers. The file's
    // `menu_code` is matched against the menu NAME, which is the only stable handle there is.
    menus: menus.map((m) => ({
      id: m.id,
      code: m.name,
      name: m.name,
      kitchenCode: kitchenCodeById.get(m.kitchen_id),
    })),
    breakTimes: breakTimes.map((b) => {
      const school = schools.find((s) => s.id === b.school_id);
      return {
        id: b.id,
        schoolId: b.school_id,
        schoolCode: school?.code ?? '',
        code: b.code,
        label: b.label,
        // Postgres renders `time` as HH:MM:SS; the validator normalises to the same, so these
        // compare directly. Comparing "10:40" against "10:40:00" would report a change on every
        // run and make the plan untrustworthy.
        startsAt: b.starts_at,
        endsAt: b.ends_at,
        sortOrder: b.sort_order,
        isActive: b.is_active !== false,
      };
    }),
    // Keyed by menu id, and each item carries the DISH NAME rather than its id, because that is
    // what the file speaks. Without this the planner cannot tell "this menu already says exactly
    // this" from "this menu needs writing", and every re-run reports changes it is not making.
    menuItems: menuItems.map((mi) => {
      const d = dishes.find((x) => x.id === mi.dish_id);
      return {
        menuId: mi.menu_id,
        dishName: d?.name ?? '',
        pricePaise: mi.price_paise,
        availableDays: mi.available_days,
        sortOrder: mi.sort_order,
      };
    }),
  };
}

/**
 * Every dish as a row ready to edit and re-import — `E10-21`.
 *
 * The point is the round trip: `--export-dishes` writes exactly the columns `--dishes` reads, so
 * a catalogue can be pulled into a spreadsheet, a `food_type` column filled in, and the same file
 * handed straight back. 79 dishes with nothing marked is a spreadsheet job, not a form job.
 *
 * `name` and `kitchen_code` are the match key, so they are first and must not be edited.
 */
export async function exportDishes(db) {
  const [kitchens, categories, dishes, dishAllergens, allergens] = await Promise.all([
    rows(db.from('kitchen').select('id,code'), 'kitchens'),
    rows(db.from('dish_category').select('id,code'), 'dish categories'),
    rows(db.from('dish').select('id,kitchen_id,name,category_id,food_type,calories_kcal,portion_text,is_active').order('name'), 'dishes'),
    rows(db.from('dish_allergen').select('dish_id,allergen_id'), 'dish allergens'),
    rows(db.from('allergen').select('id,code'), 'allergens'),
  ]);

  const kitchenById = new Map(kitchens.map((k) => [k.id, k.code]));
  const categoryById = new Map(categories.map((c) => [c.id, c.code]));
  const allergenById = new Map(allergens.map((a) => [a.id, a.code]));
  const byDish = new Map();
  for (const da of dishAllergens) {
    if (!byDish.has(da.dish_id)) byDish.set(da.dish_id, []);
    byDish.get(da.dish_id).push(allergenById.get(da.allergen_id));
  }

  return dishes.map((d) => ({
    name: d.name,
    kitchen_code: kitchenById.get(d.kitchen_id) ?? '',
    category: categoryById.get(d.category_id) ?? '',
    food_type: d.food_type ?? '',
    calories_kcal: d.calories_kcal ?? '',
    portion: d.portion_text ?? '',
    allergens: (byDish.get(d.id) ?? []).sort().join(';'),
    is_active: d.is_active ? 'true' : 'false',
  }));
}

/**
 * Break windows as a CSV ready to fill in — `E05-30`.
 *
 * Writes every window that exists, then a **template row for each active, onboarded school that
 * has none**: labels filled in, sort order filled in, and the **times deliberately blank**.
 *
 * Blank, not copied from another school. `P19` says a school with no windows cannot be ordered
 * from; the fix for that is the school's real times, and pre-filling somebody else's would put a
 * time nobody agreed to in front of a parent. `catalogue.sql` refused exactly this from the
 * legacy option set and its comment says why. The validator refuses a blank time, so the file
 * cannot be applied until a human has typed them.
 */
export async function exportBreakTimes(db) {
  const snap = await snapshot(db);
  const out = [];

  for (const b of snap.breakTimes) {
    out.push({
      school_code: b.schoolCode,
      // The STORED code, not one derived from the label. `break_time` is unique on
      // (school_id, code), and deriving it from the label meant an exported row whose label had
      // since been edited — or which never matched, as production's `break-1` against the label
      // `"10:40AM - 11:15AM"` — came back as a CREATE and duplicated the window. An export that
      // cannot be re-imported unchanged is not an export.
      code: b.code,
      label: b.label,
      starts_at: (b.startsAt ?? '').slice(0, 5),
      ends_at: (b.endsAt ?? '').slice(0, 5),
      sort_order: b.sortOrder ?? '',
      is_active: b.isActive ? 'true' : 'false',
    });
  }

  const haveWindows = new Set(snap.breakTimes.filter((b) => b.isActive).map((b) => b.schoolCode));

  /**
   * How many windows to offer, and what to call them.
   *
   * The **count and ordering** are copied from the school that already has windows — that is the
   * real shape, and two breaks is a fact about the school day rather than a guess.
   *
   * The **labels are not copied.** Production's existing labels are the raw time ranges
   * (`"10:40AM - 11:15AM"`), which `P20` and `check:launch` both call out: the picker shows the
   * label with the times underneath, so a parent reads the time twice. Copying that to two more
   * schools would spread a known defect across the whole estate on the day it was noticed.
   *
   * So the template offers friendly names. They are a starting point an operator edits, not a
   * claim about the school — unlike the times, which are left blank because they are.
   */
  const FRIENDLY = ['Morning break', 'Second break', 'Third break', 'Fourth break'];
  const existingShape = [...new Map(snap.breakTimes.map((b) => [b.code, b])).values()]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const shape = (existingShape.length > 0
    ? existingShape
    : [{ sortOrder: 10 }, { sortOrder: 20 }]
  ).map((w, i) => ({ label: FRIENDLY[i] ?? `Break ${i + 1}`, sortOrder: w.sortOrder ?? (i + 1) * 10 }));

  const closed = [];
  for (const school of snap.schools) {
    if (!school.isActive || school.onboardedAt === null) continue;
    if (haveWindows.has(school.code)) continue;
    closed.push(school.code);
    for (const w of shape) {
      out.push({
        school_code: school.code,
        // Blank for a template row: there is nothing stored to preserve, so the validator derives
        // it from whatever label the operator settles on.
        code: '',
        label: w.label,
        starts_at: '',
        ends_at: '',
        sort_order: w.sortOrder ?? '',
        is_active: 'true',
      });
    }
  }

  return { rows: out, closed, shape, existing: snap.breakTimes };
}

export async function applyBreakTimes(db, plan) {
  let count = 0;

  for (const b of plan.creates) {
    must(
      await db.from('break_time').insert({
        school_id: b.schoolId,
        code: b.code,
        label: b.label,
        starts_at: b.startsAt,
        ends_at: b.endsAt,
        // Ordered by start time when unspecified: the kitchen reads these in the order the day
        // happens, not the order somebody typed them.
        sort_order: b.sortOrder ?? Number(b.startsAt.slice(0, 2)) * 60 + Number(b.startsAt.slice(3, 5)),
        is_active: b.isActive ?? true,
      }),
      `creating break window "${b.label}" for ${b.schoolCode}`,
    );
    count += 1;
  }

  for (const b of plan.updates) {
    const patch = {};
    if (b.changed.includes('label')) patch.label = b.label;
    if (b.changed.includes('starts_at')) patch.starts_at = b.startsAt;
    if (b.changed.includes('ends_at')) patch.ends_at = b.endsAt;
    if (b.changed.includes('sort_order')) patch.sort_order = b.sortOrder;
    if (b.changed.includes('is_active')) patch.is_active = b.isActive;
    // Qualified by the row's own id. `E06-38`.
    must(await db.from('break_time').update(patch).eq('id', b.id),
      `updating break window "${b.label}" for ${b.schoolCode}`);
    count += 1;
  }

  return count;
}

const must = (result, what) => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
};

/**
 * Perform a plan.
 *
 * **Not transactional across statements.** PostgREST has no transaction spanning several
 * requests, so a failure part-way leaves earlier writes in place. That is survivable *only*
 * because every write here is idempotent on a natural key: re-running after a failure updates
 * what landed and creates what did not. It is also why the order below is fixed — schools, then
 * dishes, then menus — so a partial run never leaves a menu pointing at a dish that is not there.
 */
export async function applySchools(db, plan, snap) {
  const cityByCode = new Map(snap.cities.map((c) => [c.code.toLowerCase(), c.id]));
  const kitchenByCode = new Map(snap.kitchens.map((k) => [k.code.toLowerCase(), k.id]));
  let count = 0;

  for (const s of plan.creates) {
    const inserted = must(
      await db.from('school').insert({
        code: s.code,
        name: s.name,
        city_id: cityByCode.get(s.city.toLowerCase()),
        kitchen_id: kitchenByCode.get(s.kitchenCode),
        institution_type: s.institutionType,
        address_line1: s.addressLine1,
        address_line2: s.addressLine2,
        postcode: s.postcode,
        contact_name: s.contactName,
        contact_email: s.contactEmail,
        contact_phone: s.contactPhone,
        // `onboarded_at` gates the parent-facing picker (`P1`). Set on import: a school in this
        // file is a school being onboarded, and leaving it null makes the import look like it
        // did nothing.
        onboarded_at: new Date().toISOString(),
      }).select('id').single(),
      `creating school ${s.code}`,
    );
    count += 1;
    await writeSchoolConfig(db, inserted.id, s);
  }

  for (const s of plan.updates) {
    if (s.changed.length > 0) {
      const patch = {};
      if (s.changed.includes('name')) patch.name = s.name;
      if (s.changed.includes('institutionType')) patch.institution_type = s.institutionType;
      if (s.changed.includes('addressLine1')) patch.address_line1 = s.addressLine1;
      if (s.changed.includes('addressLine2')) patch.address_line2 = s.addressLine2;
      if (s.changed.includes('postcode')) patch.postcode = s.postcode;
      if (s.changed.includes('contactName')) patch.contact_name = s.contactName;
      if (s.changed.includes('contactEmail')) patch.contact_email = s.contactEmail;
      if (s.changed.includes('contactPhone')) patch.contact_phone = s.contactPhone;
      must(await db.from('school').update(patch).eq('id', s.id), `updating school ${s.code}`);
    }
    if (s.configChanged.length > 0) await writeSchoolConfig(db, s.id, s);
    count += 1;
  }

  return count;
}

/**
 * `school_config` is upserted, and only the columns the file supplied are set.
 *
 * A blank cutoff column means "inherit", which is a NULL — but a *missing* column means "the file
 * had no opinion", which must leave whatever is there alone. Writing every column on every import
 * would silently clear an override somebody set in the admin screen.
 */
async function writeSchoolConfig(db, schoolId, s) {
  const patch = { school_id: schoolId };
  if (s.serviceDays !== null) patch.service_days = s.serviceDays;
  if (s.cutoffTime !== null) patch.order_cutoff_time = s.cutoffTime;
  if (s.cutoffDaysBefore !== null) patch.order_cutoff_days_before = s.cutoffDaysBefore;
  if (Object.keys(patch).length === 1) return;
  must(await db.from('school_config').upsert(patch, { onConflict: 'school_id' }), `configuring school ${s.code}`);
}

export async function applyDishes(db, plan, snap) {
  const kitchenByCode = new Map(snap.kitchens.map((k) => [k.code.toLowerCase(), k.id]));
  const categoryByCode = new Map(snap.categories.map((c) => [c.code.toLowerCase(), c.id]));
  const allergenByCode = new Map(snap.allergens.map((a) => [a.code.toLowerCase(), a.id]));
  let count = 0;

  for (const d of plan.creates) {
    const inserted = must(
      await db.from('dish').insert({
        kitchen_id: kitchenByCode.get(d.kitchenCode),
        name: d.name,
        description: d.description,
        ingredients_text: d.ingredientsText,
        calories_kcal: d.caloriesKcal,
        portion_text: d.portionText,
        food_type: d.foodType,
        category_id: categoryByCode.get(d.category.toLowerCase()),
        // A NEW dish defaults to active. `isActive` is null when the file had no `is_active`
        // column, which for an existing dish means "leave it alone" — but a row being created has
        // nothing to leave alone, and a dish imported as inactive would be invisible for no
        // stated reason.
        is_active: d.isActive ?? true,
      }).select('id').single(),
      `creating dish ${d.name}`,
    );
    await writeDishAllergens(db, inserted.id, d, allergenByCode);
    count += 1;
  }

  for (const d of plan.updates) {
    const patch = {};
    if (d.changed.includes('description')) patch.description = d.description;
    if (d.changed.includes('ingredientsText')) patch.ingredients_text = d.ingredientsText;
    if (d.changed.includes('caloriesKcal')) patch.calories_kcal = d.caloriesKcal;
    if (d.changed.includes('portionText')) patch.portion_text = d.portionText;
    if (d.changed.includes('foodType')) patch.food_type = d.foodType;
    if (d.changed.includes('isActive')) patch.is_active = d.isActive;
    if (Object.keys(patch).length > 0) {
      must(await db.from('dish').update(patch).eq('id', d.id), `updating dish ${d.name}`);
    }
    if (d.changed.includes('allergens')) await writeDishAllergens(db, d.id, d, allergenByCode);
    count += 1;
  }

  return count;
}

/**
 * Allergens are replaced as a set, and the delete is always qualified by `dish_id`.
 *
 * `E06-38` cost this project two incidents on an unqualified DELETE, and
 * `scripts/check-unqualified-writes.mjs` exists because of it.
 */
async function writeDishAllergens(db, dishId, d, allergenByCode) {
  if (d.allergens.length === 0) return;
  must(await db.from('dish_allergen').delete().eq('dish_id', dishId), `clearing allergens for ${d.name}`);
  must(
    await db.from('dish_allergen').insert(
      d.allergens.map((code) => ({ dish_id: dishId, allergen_id: allergenByCode.get(code) })),
    ),
    `setting allergens for ${d.name}`,
  );
}

export async function applyMenus(db, menus, snap) {
  const kitchenByCode = new Map(snap.kitchens.map((k) => [k.code.toLowerCase(), k.id]));
  const schoolByCode = new Map(snap.schools.map((s) => [s.code.toLowerCase(), s.id]));
  // Re-read dishes: the dish pass may have created some of these moments ago.
  const fresh = must(await db.from('dish').select('id,kitchen_id,name'), 'reading dishes');
  const dishByKey = new Map(
    fresh.map((d) => [`${d.kitchen_id}::${d.name.toLowerCase()}`, d.id]),
  );
  let count = 0;

  for (const m of menus) {
    const kitchenId = kitchenByCode.get(m.kitchenCode);
    let menuId = m.id;

    if (menuId === null) {
      menuId = must(
        // `menu_status` is draft | active | retired. NOT "published" — that is the name of the
        // *timestamp* column, and the two do not match. An imported menu goes straight to `active`
        // because it is being imported in order to be served; a menu that lands as `draft` is
        // invisible to every parent with nothing on screen to say why.
        await db.from('menu').insert({
          kitchen_id: kitchenId,
          name: m.name,
          status: 'active',
          published_at: new Date().toISOString(),
        }).select('id').single(),
        `creating menu ${m.code}`,
      ).id;
    }

    for (const item of m.items) {
      const dishId = dishByKey.get(`${kitchenId}::${item.dishName.toLowerCase()}`);
      // `menu_item` has `unique (menu_id, dish_id)`, so an upsert on it is what makes a re-run
      // safe rather than duplicating every line.
      must(
        await db.from('menu_item').upsert(
          {
            menu_id: menuId,
            dish_id: dishId,
            price_paise: item.pricePaise,
            available_days: item.availableDays,
            sort_order: item.sortOrder,
            is_active: true,
          },
          { onConflict: 'menu_id,dish_id' },
        ),
        `adding ${item.dishName} to menu ${m.code}`,
      );
      count += 1;
    }

    for (const a of m.assignments.values()) {
      const schoolId = schoolByCode.get(a.schoolCode);
      // An assignment is append-only in spirit — `menu_assignment` has `revoked_at` rather than a
      // delete — so an existing live assignment is left alone rather than re-created.
      //
      // Checked per SCHOOL, not per (school, menu, valid_from). `menu_assignment_no_overlap` is an
      // exclusion constraint over the school and the validity range: a school may not have two
      // live assignments covering the same day, whichever menus they name. Narrowing the check to
      // one menu id meant a re-run inserted an overlapping row and the database refused it — the
      // right refusal, arriving after the tool had already decided to write.
      const live = must(
        await db.from('menu_assignment').select('id,menu_id,valid_from,valid_to')
          .eq('school_id', schoolId).is('revoked_at', null),
        `checking assignments for ${a.schoolCode}`,
      );
      // `valid_to` is exclusive and null means open-ended.
      const overlaps = live.some((e) =>
        (e.valid_to === null || e.valid_to > a.validFrom) &&
        (a.validTo === null || a.validTo > e.valid_from));
      if (overlaps) continue;

      must(
        await db.from('menu_assignment').insert({
          school_id: schoolId,
          menu_id: menuId,
          valid_from: a.validFrom,
          valid_to: a.validTo,
        }),
        `assigning menu ${m.code} to ${a.schoolCode}`,
      );
      count += 1;
    }
  }

  return count;
}
