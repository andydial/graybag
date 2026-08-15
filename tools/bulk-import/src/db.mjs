// The only file here that talks to Supabase.
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

import { createClient } from '@supabase/supabase-js';

export function connect(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n\n' +
        '  set -a; . ./.secrets.staging.env; set +a\n\n' +
        'The service role key bypasses RLS. Never put it in a shell history, a script in the ' +
        'repository, or anything that reaches a browser.',
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

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
  const [cities, kitchens, schools, schoolConfigs, categories, allergens, dishes, dishAllergens, menus, menuItems] =
    await Promise.all([
      rows(db.from('city').select('id,code,name'), 'cities'),
      rows(db.from('kitchen').select('id,code,name'), 'kitchens'),
      rows(db.from('school').select('id,code,name,city_id,kitchen_id,institution_type,address_line1,address_line2,postcode,contact_name,contact_email,contact_phone'), 'schools'),
      rows(db.from('school_config').select('school_id,service_days,order_cutoff_time,order_cutoff_days_before'), 'school config'),
      rows(db.from('dish_category').select('id,code,display_name'), 'dish categories'),
      rows(db.from('allergen').select('id,code'), 'allergens'),
      rows(db.from('dish').select('id,kitchen_id,name,description,ingredients_text,calories_kcal,portion_text,food_type,category_id,is_active'), 'dishes'),
      rows(db.from('dish_allergen').select('dish_id,allergen_id'), 'dish allergens'),
      rows(db.from('menu').select('id,kitchen_id,name,status'), 'menus'),
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
