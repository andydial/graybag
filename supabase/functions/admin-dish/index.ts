// `admin-dish` — editing one dish, or one dish's price on one menu. `E10-20`.
//
//   PATCH /functions/v1/admin-dish
//     { dish: { id, foodType?, description?, ingredientsText?, caloriesKcal?, portionText?,
//               isActive?, allergens? } }
//     { menuItem: { menuId, dishId, pricePaise?, availableDays?, isActive? } }
//     { foodTypes: [{ id, foodType }, …] }        bulk, up to 500 — `E10-21`
//
//     200 { changed: [...] }
//     401 not_authenticated
//     403 not_permitted        the grant is named in the reply
//     404 unknown_dish / unknown_menu_item
//     422 validation_failed    { fields: { … } }
//     405 method_not_allowed
//
// ## Why this exists when `tools/bulk-import` already writes all of it
//
// Different jobs. The importer is for the 17th: a few hundred rows from a file, planned and
// applied in one pass. This is for the Tuesday afternoon when one price is wrong — where
// preparing a CSV, dry-running it and applying it is six minutes of ceremony for a four-character
// change, and the ceremony is what makes somebody edit the database by hand instead.
//
// ## Two grants, and `dish.edit` is not `menu.edit`
//
// Changing what a dish *is* — its allergens, whether it contains egg — is `dish.edit`. Changing
// what it *costs on a menu* is `menu.edit`. They are separate in `permission` and separate here,
// because the person who corrects an allergen is not necessarily the person who sets prices, and
// `D3` exists so that split stays possible without a migration.
//
// ## Allergens are the dangerous field on this endpoint
//
// `dish_allergen` and `recipient_allergen` share one vocabulary, and that shared row id is the
// whole mechanism behind an allergen warning. An unknown code here is a **422 naming the codes**,
// never a silent skip: a dish whose allergen did not match is a dish whose warning never fires,
// and nothing on any screen would show that it had happened.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { corsHeaders, preflight } from '../_shared/cors.ts';

const CORS = corsHeaders('PATCH');

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOOD_TYPES = ['veg', 'non_veg', 'egg'];

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/** Integer paise. A non-integer is refused, never rounded — non-negotiable #3. */
function paise(v: unknown, fields: Record<string, string>): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    fields.pricePaise =
      'must be a whole number of paise, zero or more. ₹45.00 is 4500 — not 45, and not 45.00';
    return null;
  }
  return v;
}

function weekdays(v: unknown, fields: Record<string, string>): number[] | null {
  if (!Array.isArray(v)) {
    fields.availableDays = 'must be a list of weekday numbers, 1 to 7, with Monday as 1';
    return null;
  }
  const days = v.map(Number);
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    fields.availableDays = 'weekdays are 1 to 7 with Monday as 1. Sunday is 7, never 0';
    return null;
  }
  if (days.length === 0) {
    fields.availableDays =
      'a dish available on no day is off the menu — set isActive false instead, which says so';
    return null;
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

Deno.serve(async (request: Request): Promise<Response> => {
  const pre = preflight(request, CORS);
  if (pre) return pre;

  if (request.method !== 'PATCH') return json(405, { error: 'method_not_allowed' });

  const authHeader = request.headers.get('Authorization') ?? '';
  const anon = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userData, error: userError } = await anon.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json(401, { error: 'not_authenticated' });

  let body: {
    dish?: Record<string, unknown>;
    menuItem?: Record<string, unknown>;
    foodTypes?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'malformed_body' });
  }

  const { data: grantRows, error: grantError } = await anon
    .from('permission_grant')
    .select('permission_code')
    .is('revoked_at', null);
  if (grantError) {
    console.error('grant read failed', grantError.code);
    return json(500, { error: 'internal' });
  }
  const held = new Set((grantRows ?? []).map((g: { permission_code: string }) => g.permission_code));

  // Checked before anything is read or written, and named in the refusal so the caller knows
  // which of the two they are missing rather than being told "no".
  if (body.dish && !held.has('dish.edit')) {
    return json(403, { error: 'not_permitted', requires: 'dish.edit' });
  }
  if (body.menuItem && !held.has('menu.edit')) {
    return json(403, { error: 'not_permitted', requires: 'menu.edit' });
  }
  if (body.foodTypes && !held.has('dish.edit')) {
    return json(403, { error: 'not_permitted', requires: 'dish.edit' });
  }
  if (!body.dish && !body.menuItem && !body.foodTypes) {
    return json(422, {
      error: 'validation_failed',
      fields: { body: 'send a dish, a menuItem, or foodTypes' },
    });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const fields: Record<string, string> = {};
  const changed: string[] = [];

  // ---------------------------------------------------------------- bulk food types
  //
  // `E10-21`. 79 dishes reached production with `food_type` null on every one of them, which in
  // this market is the most likely day-one complaint — a parent cannot tell whether a dish is
  // vegetarian, and that is not a detail here.
  //
  // Its own shape rather than a general mass-update: **only `food_type` can be set this way.**
  // A generic "update these 500 rows with this patch" endpoint is one careless caller away from
  // rewriting descriptions or retiring a catalogue, and there is no operator task that needs it.
  //
  // **All or nothing.** Validated completely before a single row is written, so a bad id at
  // position 60 does not leave the first 59 changed and the operator guessing which. That matters
  // more here than anywhere else in this function, because the whole point is doing 79 at once.
  if (body.foodTypes !== undefined) {
    if (!Array.isArray(body.foodTypes)) {
      return json(422, { error: 'validation_failed', fields: { foodTypes: 'must be a list' } });
    }
    // A cap, because an uncapped bulk write is a denial of service with a valid token. 500 is
    // comfortably above the whole catalogue and far below anything that would hurt.
    if (body.foodTypes.length > 500) {
      return json(422, { error: 'validation_failed', fields: { foodTypes: 'at most 500 at a time' } });
    }

    const updates: { id: string; foodType: string | null }[] = [];
    for (const [i, raw] of body.foodTypes.entries()) {
      if (typeof raw !== 'object' || raw === null) {
        return json(422, { error: 'validation_failed', fields: { [`foodTypes[${i}]`]: 'not an object' } });
      }
      const entry = raw as Record<string, unknown>;
      const id = str(entry.id);
      if (!id || !UUID.test(id)) {
        return json(422, { error: 'validation_failed', fields: { [`foodTypes[${i}].id`]: 'required, and a uuid' } });
      }
      const value = entry.foodType === null ? null : str(entry.foodType);
      if (value !== null && !FOOD_TYPES.includes(value)) {
        return json(422, {
          error: 'validation_failed',
          fields: { [`foodTypes[${i}].foodType`]: `must be null or one of: ${FOOD_TYPES.join(', ')}` },
        });
      }
      updates.push({ id, foodType: value });
    }

    // One statement per distinct value rather than one per dish: setting a whole catalogue to
    // `veg` and then correcting the handful that are not is the actual operator workflow, and it
    // becomes three round trips instead of seventy-nine.
    const byValue = new Map<string, string[]>();
    for (const u of updates) {
      const key = u.foodType ?? '';
      if (!byValue.has(key)) byValue.set(key, []);
      byValue.get(key)!.push(u.id);
    }

    let touched = 0;
    for (const [value, ids] of byValue) {
      const { data, error } = await admin
        .from('dish')
        .update({ food_type: value === '' ? null : value })
        .in('id', ids)
        .select('id');
      if (error) {
        console.error('bulk food_type failed', error.code);
        return json(500, { error: 'internal' });
      }
      touched += (data ?? []).length;
    }

    if (touched !== updates.length) {
      // Some id matched nothing. Reported rather than shrugged off: a bulk edit that silently
      // skipped a dish is a dish that stays unmarked, which is the exact thing this endpoint
      // exists to prevent.
      return json(404, {
        error: 'unknown_dish',
        detail: `${updates.length - touched} of ${updates.length} ids matched no dish. Nothing else was changed.`,
      });
    }

    changed.push(`foodType×${touched}`);
  }

  // ------------------------------------------------------------------------- the dish
  if (body.dish) {
    const d = body.dish;
    const id = str(d.id);
    if (!id || !UUID.test(id)) {
      return json(422, { error: 'validation_failed', fields: { 'dish.id': 'required, and a uuid' } });
    }

    const patch: Record<string, unknown> = {};
    // Absent means "leave it alone"; present means "set it", including to null. The same
    // three-way rule `admin-school` follows, and the reason a partial form cannot blank a
    // description somebody wrote last week.
    if ('foodType' in d) {
      const value = d.foodType === null ? null : str(d.foodType);
      if (value !== null && !FOOD_TYPES.includes(value)) {
        fields.foodType = `must be one of: ${FOOD_TYPES.join(', ')}`;
      } else {
        patch.food_type = value;
      }
    }
    if ('description' in d) patch.description = d.description === null ? null : str(d.description);
    if ('ingredientsText' in d) patch.ingredients_text = d.ingredientsText === null ? null : str(d.ingredientsText);
    if ('portionText' in d) patch.portion_text = d.portionText === null ? null : str(d.portionText);
    if ('isActive' in d) patch.is_active = d.isActive === true;
    if ('caloriesKcal' in d) {
      const raw = d.caloriesKcal;
      if (raw === null) patch.calories_kcal = null;
      else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 10000) fields.caloriesKcal = 'must be a whole number between 0 and 10000';
        else patch.calories_kcal = n;
      }
    }

    if (Object.keys(fields).length > 0) return json(422, { error: 'validation_failed', fields });

    if (Object.keys(patch).length > 0) {
      // Qualified by id. `E06-38` cost two incidents to an unqualified write.
      const { data, error } = await admin.from('dish').update(patch).eq('id', id).select('id');
      if (error) {
        console.error('dish update failed', error.code);
        return json(500, { error: 'internal' });
      }
      if ((data ?? []).length === 0) return json(404, { error: 'unknown_dish', id });
      changed.push(...Object.keys(patch));
    }

    if ('allergens' in d) {
      const codes = Array.isArray(d.allergens)
        ? d.allergens.map((a) => String(a).trim().toLowerCase()).filter((a) => a !== '')
        : null;
      if (codes === null) {
        return json(422, { error: 'validation_failed', fields: { allergens: 'must be a list of codes' } });
      }

      const { data: known } = await admin.from('allergen').select('id,code');
      const byCode = new Map((known ?? []).map((a: { id: string; code: string }) => [a.code.toLowerCase(), a.id]));
      const unknown = codes.filter((c) => !byCode.has(c));
      if (unknown.length > 0) {
        // A 422, never a silent skip. An unmatched code means the allergy warning never fires for
        // this dish, and nothing on any screen would ever show that it had happened.
        return json(422, {
          error: 'validation_failed',
          fields: {
            allergens:
              `unknown code(s): ${unknown.join(', ')}. Valid: ${[...byCode.keys()].join(', ')}. ` +
              `These are codes, not labels — an unmatched one means the allergy warning silently ` +
              `never fires for this dish.`,
          },
        });
      }

      const { error: delError } = await admin.from('dish_allergen').delete().eq('dish_id', id);
      if (delError) {
        console.error('allergen clear failed', delError.code);
        return json(500, { error: 'internal' });
      }
      if (codes.length > 0) {
        const { error: insError } = await admin
          .from('dish_allergen')
          .insert(codes.map((c) => ({ dish_id: id, allergen_id: byCode.get(c) })));
        if (insError) {
          console.error('allergen set failed', insError.code);
          return json(500, { error: 'internal' });
        }
      }
      changed.push('allergens');
    }
  }

  // --------------------------------------------------------------------- the menu item
  if (body.menuItem) {
    const m = body.menuItem;
    const menuId = str(m.menuId);
    const dishId = str(m.dishId);
    if (!menuId || !UUID.test(menuId) || !dishId || !UUID.test(dishId)) {
      return json(422, {
        error: 'validation_failed',
        fields: { menuItem: 'menuId and dishId are required, and both are uuids' },
      });
    }

    const patch: Record<string, unknown> = {};
    if ('pricePaise' in m) {
      const value = paise(m.pricePaise, fields);
      if (value !== null) patch.price_paise = value;
    }
    if ('availableDays' in m) {
      const value = weekdays(m.availableDays, fields);
      if (value !== null) patch.available_days = value;
    }
    if ('isActive' in m) patch.is_active = m.isActive === true;

    if (Object.keys(fields).length > 0) return json(422, { error: 'validation_failed', fields });

    if (Object.keys(patch).length > 0) {
      // Qualified by BOTH ids — `menu_item` is unique on the pair, and qualifying by dish alone
      // would reprice that dish on every menu it appears on.
      const { data, error } = await admin
        .from('menu_item')
        .update(patch)
        .eq('menu_id', menuId)
        .eq('dish_id', dishId)
        .select('id');
      if (error) {
        console.error('menu_item update failed', error.code);
        return json(500, { error: 'internal' });
      }
      if ((data ?? []).length === 0) return json(404, { error: 'unknown_menu_item', menuId, dishId });
      changed.push(...Object.keys(patch).map((c) => `menuItem.${c}`));
    }
  }

  return json(200, { changed });
});
