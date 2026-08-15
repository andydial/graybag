-- =============================================================================
-- 0059_food_type_required_on_menu.sql — a dish reaches a menu marked, or not at all. `E10-21`.
-- =============================================================================
--
-- **79 dishes reached production with `food_type` null on every single one.** In this market a
-- parent who cannot tell whether a dish is vegetarian is not a missing nicety; it is the most
-- likely day-one complaint, and for some families it is the whole decision.
--
-- `[DM-17]` left the column nullable for a good reason — the source Excel had no such field, and
-- inventing one would have been inventing a fact about food. That reason covers a dish sitting in
-- the catalogue. It does not cover a dish **offered to a parent**, which is what a `menu_item` is.
--
-- So the column stays nullable and the *offer* is guarded. A dish can exist unmarked; it cannot be
-- put on a menu unmarked.
--
-- ## Why a trigger and not a constraint
--
-- The fact lives on `dish` and the row being written is `menu_item`, so this is a cross-table
-- rule and a `check` constraint cannot express it. A foreign key cannot either — it is a
-- predicate on a column of the parent, not on its existence.
--
-- ## Why it fires only for an ACTIVE menu item
--
-- `is_active = false` means the dish is on the menu but not offered. Blocking that would stop
-- somebody parking a dish on next term's menu before its details are complete, which is ordinary
-- and harmless: nothing reaches a parent. The rule is about what is *offered*, and `is_active` is
-- precisely how this schema says "offered".
--
-- ## What this deliberately does NOT do
--
-- It does not touch the 83 `menu_item` rows already in production. A trigger fires on write, so
-- existing rows stand until something updates them — and a migration that retro-actively emptied
-- two live menus is not a guard, it is an outage.
--
-- Those rows are exactly what `npm run check:launch` reports, and what the bulk editor on
-- `/admin/menus` exists to fix in one action. The order matters and it is deliberate: the tool
-- ships in the same change as the guard, so there is never a state where the rule exists and the
-- means to satisfy it does not.
--
-- **This will make `tools/bulk-import` fail** on any menu row whose dish is unmarked. That is the
-- intended forcing function, and the error message below is written to be read by the person
-- running it at the time.
-- =============================================================================

create function assert_dish_is_marked()
returns trigger
language plpgsql
-- SECURITY DEFINER with a pinned search_path: the trigger reads `dish`, and a caller whose RLS
-- hides the row would otherwise get "dish not found" for a dish that exists — a confusing refusal
-- for the wrong reason. The pin is mandatory whenever DEFINER is, and for the usual reason.
security definer set search_path = public
as $$
declare
  v_food_type food_type;
  v_name      text;
begin
  -- Inactive is not offered. See the header.
  if new.is_active is not true then
    return new;
  end if;

  select d.food_type, d.name into v_food_type, v_name
    from dish d where d.id = new.dish_id;

  if v_food_type is null then
    raise exception
      'dish "%" has no food type, so it cannot be put on a menu', coalesce(v_name, new.dish_id::text)
      using errcode = '23514',
            hint = 'Set it to veg, non_veg or egg first — /admin/menus can set the whole '
                   'catalogue at once, or add a food_type column to the dishes CSV. '
                   'A parent cannot tell whether an unmarked dish is vegetarian.';
  end if;

  return new;
end;
$$;

comment on function assert_dish_is_marked() is
  'E10-21. A dish may exist unmarked; it may not be OFFERED unmarked. Fires only for an active '
  'menu_item, because is_active=false is how this schema says "on the menu but not offered", and '
  'blocking that would stop somebody preparing next term''s menu.';

create trigger menu_item_dish_is_marked
  before insert or update on menu_item
  for each row execute function assert_dish_is_marked();

comment on trigger menu_item_dish_is_marked on menu_item is
  'E10-21. Deliberately does not touch rows already written — a trigger fires on write, and a '
  'migration that emptied two live menus would be an outage rather than a guard. Existing '
  'offenders are reported by `npm run check:launch`.';
