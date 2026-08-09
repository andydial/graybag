-- =============================================================================
-- seeds/staging-menu.sql — the menu side only, for STAGING
-- =============================================================================
--
-- `supabase/seed.sql` says in its own header: NEVER into staging or production. That
-- rule stands and this file does not break it — it is a different file with a
-- different contents rule.
--
-- **What is deliberately absent: people.** No `auth.users`, no `app_user`, no
-- `recipient`, no `guardian_link`. `seed.sql` seeds six users and six children because
-- the pgTAP authorization suite needs real subjects to impersonate; a staging database
-- being browsed from a phone needs none of them, and non-negotiable #4 says children's
-- data is regulated. Synthetic children are not regulated data, but the cheapest way to
-- never leak a fixture child is to not put one in a hosted database.
--
-- What it does seed is exactly enough for the Menu tab to work end to end: one city, one
-- kitchen, three schools, categories, allergens, dishes, three menus, their items, and
-- the assignments that make one of them live today. `school_menu_version` rows arrive by
-- trigger.
--
-- Everything is `on conflict do nothing`, so re-running it is safe.
--
-- **This is fixture data, not real menu data.** The real menus arrive with `E04-13`,
-- which is blocked on `[MI-01]` — the source workbook is not in the repository. Until
-- then a staging build shows plausible food with invented prices, and nothing here
-- should ever reach production.
--
-- Applied by `npm run db:seed:staging`. See `docs/environments.md`.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Cities. One, and only one, for v1.
-- -----------------------------------------------------------------------------
insert into city (id, code, name, state_name, gst_state_code, country_code, timezone) values
  ('c1000000-0000-0000-0000-000000000001', 'sas_nagar', 'SAS Nagar (Mohali)', 'Punjab', '03', 'IN', 'Asia/Kolkata')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Kitchen. One kitchen serves all three schools ([DM-16]: a school has exactly one).
-- -----------------------------------------------------------------------------
insert into kitchen (id, code, name, city_id, address_line1, postcode, contact_name, contact_email, contact_phone) values
  ('cc000000-0000-0000-0000-000000000001', 'mohali_central', 'GrayBag Kitchen, Mohali',
   'c1000000-0000-0000-0000-000000000001',
   'Plot 42, Industrial Area Phase 8B', '160071', 'Kitchen Manager', 'kitchen@example.invalid', '+919000000001')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Schools. Three, deliberately different from each other:
--   * Alpha    — a school, fully onboarded, the "normal" case most tests use.
--   * Bravo    — a school with its own config overrides, so the config resolution
--                chain (platform -> kitchen -> school, [DM-07]) has something to resolve.
--   * Chandra  — a COLLEGE, and not yet onboarded. Two edge cases in one row: an
--                institution_type that is not 'school', and a row that must NOT appear
--                in customer-facing lists because onboarded_at is null.
-- -----------------------------------------------------------------------------
insert into school (id, code, name, city_id, kitchen_id, institution_type,
                    address_line1, postcode, contact_name, contact_email, contact_phone, onboarded_at) values
  ('50000000-0000-0000-0000-000000000001', 'alpha_public', 'Alpha Public School',
   'c1000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', 'school',
   'Sector 68', '160062', 'Alpha Admin', 'alpha@example.invalid', '+919000000011', '2026-01-15T04:30:00Z'),

  ('50000000-0000-0000-0000-000000000002', 'bravo_intl', 'Bravo International School',
   'c1000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', 'school',
   'Sector 71', '160071', 'Bravo Admin', 'bravo@example.invalid', '+919000000012', '2026-02-01T04:30:00Z'),

  ('50000000-0000-0000-0000-000000000003', 'chandra_college', 'Chandra College',
   'c1000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001', 'college',
   'Sector 80', '160080', 'Chandra Admin', 'chandra@example.invalid', '+919000000013', null)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Classes. Alpha has sections, Chandra (a college) has classes with NO sections —
-- which is the `section_label is null` path [DM-08] warns about.
-- -----------------------------------------------------------------------------
insert into school_class (id, school_id, class_label, section_label, sort_order) values
  ('5c000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '5', 'A', 10),
  ('5c000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '5', 'B', 20),
  ('5c000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', '6', 'A', 30),
  ('5c000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000002', '4', 'A', 10),
  ('5c000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000002', '4', 'B', 20),
  ('5c000000-0000-0000-0000-000000000006', '50000000-0000-0000-0000-000000000003', 'FY B.Sc', null, 10)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Break times.
--
-- Times are real `time` values, not the legacy option-set strings. `legacy_option_value`
-- is populated because the legacy labels and values CONTRADICT each other
-- (docs/learnings.md, 2026-08-06) and E16-15 needs a hand-verified map — the fixture
-- carries the pairing so a migration test has something to assert against.
-- -----------------------------------------------------------------------------
insert into break_time (id, school_id, code, label, starts_at, ends_at, sort_order, legacy_option_value) values
  ('b7000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'break_1', 'Morning break',   '10:40', '11:15', 10, '10__00_am'),
  ('b7000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 'break_2', 'Lunch break',     '11:15', '11:40', 20, '10_15_am'),
  ('b7000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002', 'break_1', 'Mid-morning',     '10:00', '10:30', 10, null),
  ('b7000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000003', 'break_1', 'Canteen window',  '12:00', '13:00', 10, null)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Dish categories.
-- -----------------------------------------------------------------------------
insert into dish_category (id, code, display_name, sort_order) values
  ('dc000000-0000-0000-0000-000000000001', 'quick_bites',  'Quick Bites',  10),
  ('dc000000-0000-0000-0000-000000000002', 'main_meals',   'Main Meals',   20),
  ('dc000000-0000-0000-0000-000000000003', 'beverages',    'Beverages',    30)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Allergens.
--
-- A DELIBERATELY SMALL SET. [DM-13] is open: the real list must be reconciled against
-- the distinct values in the source workbook, which is not in the repository ([MI-01]).
-- Seeding twelve plausible codes here would look like an answer. These four exist only
-- so allergen JOINs have rows.
-- -----------------------------------------------------------------------------
insert into allergen (id, code, display_name, description, is_major, sort_order) values
  ('a1000000-0000-0000-0000-000000000001', 'milk',     'Milk',     'Dairy in any form',           true,  10),
  ('a1000000-0000-0000-0000-000000000002', 'gluten',   'Gluten',   'Wheat, barley, rye and oats', true,  20),
  ('a1000000-0000-0000-0000-000000000003', 'tree_nut', 'Tree nut', 'Almond, cashew, walnut',      true,  30),
  ('a1000000-0000-0000-0000-000000000004', 'soy',      'Soy',      'Soybean and soy derivatives', true,  40)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Dishes.
--
-- `food_type` is set here even though it is absent from the source Excel ([DM-17]) —
-- a fixture is the one place we may choose a value, and every dish having one keeps
-- the veg/non-veg display path exercised.
-- -----------------------------------------------------------------------------
insert into dish (id, kitchen_id, name, description, calories_kcal, portion_text, category_id, food_type) values
  ('d1000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001',
   'Veg Sandwich', 'Grilled sandwich with seasonal vegetables', 280, '1 sandwich',
   'dc000000-0000-0000-0000-000000000001', 'veg'),
  ('d1000000-0000-0000-0000-000000000002', 'cc000000-0000-0000-0000-000000000001',
   'Paneer Wrap', 'Whole wheat wrap with spiced paneer', 420, '1 wrap',
   'dc000000-0000-0000-0000-000000000001', 'veg'),
  ('d1000000-0000-0000-0000-000000000003', 'cc000000-0000-0000-0000-000000000001',
   'Rajma Chawal', 'Kidney beans with steamed rice', 560, '350 g',
   'dc000000-0000-0000-0000-000000000002', 'veg'),
  ('d1000000-0000-0000-0000-000000000004', 'cc000000-0000-0000-0000-000000000001',
   'Egg Fried Rice', 'Fried rice with egg', 610, '350 g',
   'dc000000-0000-0000-0000-000000000002', 'egg'),
  ('d1000000-0000-0000-0000-000000000005', 'cc000000-0000-0000-0000-000000000001',
   'Cold Coffee', 'Chilled milk coffee, no added sugar', 180, '250 ml',
   'dc000000-0000-0000-0000-000000000003', 'veg')
on conflict (id) do nothing;

-- Dish -> allergen. Cold Coffee is milk; the wrap is milk AND gluten, so the
-- warning path has a dish with more than one tag to render.
insert into dish_allergen (dish_id, allergen_id) values
  ('d1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002'),
  ('d1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001'),
  ('d1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002'),
  ('d1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Menus. Three, in three different lifecycle states, so anything that filters on
-- status has all three to filter.
--   Standard  — active, assigned to Alpha and Chandra
--   Premium   — active, assigned to Bravo, priced higher
--   Winter    — DRAFT, assigned to nothing. A draft menu must never reach a customer.
-- -----------------------------------------------------------------------------
insert into menu (id, kitchen_id, name, status, version, published_at) values
  ('e0000000-0000-0000-0000-000000000001', 'cc000000-0000-0000-0000-000000000001',
   'Standard Menu', 'active', 1, '2026-01-15T04:30:00Z'),
  ('e0000000-0000-0000-0000-000000000002', 'cc000000-0000-0000-0000-000000000001',
   'Premium Menu',  'active', 1, '2026-02-01T04:30:00Z'),
  ('e0000000-0000-0000-0000-000000000003', 'cc000000-0000-0000-0000-000000000001',
   'Winter Menu',   'draft',  1, null)
on conflict (id) do nothing;

-- Menu items. Prices are integer paise: 8000 = Rs 80.00.
-- Premium prices the same dishes higher, which is what makes a price-change test
-- meaningful without inventing a second kitchen.
insert into menu_item (id, menu_id, dish_id, price_paise, sort_order) values
  -- Standard
  ('e1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001',  8000, 10),
  ('e1000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 12000, 20),
  ('e1000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000003', 15000, 30),
  ('e1000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000005',  6000, 40),
  -- Premium
  ('e1000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002', 14000, 10),
  ('e1000000-0000-0000-0000-000000000006', 'e0000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000003', 18000, 20),
  ('e1000000-0000-0000-0000-000000000007', 'e0000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000004', 19000, 30),
  -- Winter (draft)
  ('e1000000-0000-0000-0000-000000000008', 'e0000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000003', 16000, 10)
on conflict (id) do nothing;

-- Menu assignments. The exclusion constraint forbids two overlapping live assignments
-- for one school, so these are open-ended and non-overlapping by construction.
-- Winter Menu is assigned to nothing, on purpose.
insert into menu_assignment (id, school_id, menu_id, valid_from, valid_to) values
  ('ea000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '2026-01-15', null),
  ('ea000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002', '2026-02-01', null),
  ('ea000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000001', '2026-03-01', null)
on conflict (id) do nothing;


-- -----------------------------------------------------------------------------
-- Config overrides, so the resolution chain has something to resolve ([DM-07]).
--
-- platform_config is already seeded by 0001 and is a singleton; it is not touched here.
--   kitchen  — a 23:00 cutoff, overriding the platform midnight default (D5).
--   Bravo    — counter pickup rather than classroom delivery, and a 15% revenue share.
--              Alpha and Chandra inherit, so a test can assert all three levels.
--
-- `price_is_tax_inclusive` is deliberately left NULL everywhere: [DM-20] is open, and
-- a fixture that picks a value is a guess about money that would silently propagate
-- into every invoice a test ever asserts.
-- -----------------------------------------------------------------------------
insert into kitchen_config (kitchen_id, order_cutoff_time) values
  ('cc000000-0000-0000-0000-000000000001', '23:00')
on conflict (kitchen_id) do nothing;

insert into school_config (school_id, default_delivery_mode, allow_classroom_delivery,
                           allow_counter_pickup, revenue_share_bps) values
  ('50000000-0000-0000-0000-000000000002', 'counter', false, true, 1500)
on conflict (school_id) do nothing;

commit;

