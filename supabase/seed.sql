-- =============================================================================
-- seed.sql — development and test fixture data (E01-13)
-- =============================================================================
--
-- Applied by `supabase db reset` after every migration has replayed. Loaded into
-- local Postgres and into CI's ephemeral database. NEVER into staging or production.
--
-- Shape: one city, one kitchen, three schools, three menus, six users, six recipients.
--
-- Four rules this file follows, and the reasons matter:
--
-- 1. **Every id is a fixed, readable UUID.** Tests reference these rows by id, and a
--    `gen_random_uuid()` fixture means every assertion has to look the row up by name
--    first. The pattern is `<table-prefix>0000-0000-0000-0000-<nnnnnnnnnnnn>`, so a
--    failing test's output says which kind of row it was.
--
-- 2. **Names are obviously synthetic** (`docs/testing-strategy.md` §4). Non-negotiable
--    #4: children's data is regulated under the DPDP Act. No fixture may carry a real
--    child's name, class or allergy — not even one invented to "look realistic", because
--    the point of an obviously-fake name is that nobody can mistake a leak for a fixture.
--    The pgTAP suite already uses Aarav and Bela; this continues that set.
--
-- 3. **All money is integer paise** (non-negotiable #3). 12000 is Rs 120.00. There is
--    no float anywhere in this file and there must never be.
--
-- 4. **Mohali only.** v1 is one city, one state, so GST is a flat 5% split CGST 2.5% +
--    SGST 2.5% and `gst_state_code` is 03 (Punjab) everywhere (`docs/mvp-scope.md`).
--    Nothing here should tempt anyone to build place-of-supply derivation.
--
-- What this file deliberately does NOT seed: orders, payments, invoices, ledger
-- entries. Those have state machines and money invariants, and a fixture that fakes
-- one by direct insert teaches tests to expect a state the application can never
-- produce. They arrive with the code that creates them (E05, E06, E07).
--
-- Idempotent: every insert is `on conflict do nothing`, so re-running it is safe.
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
-- Users.
--
-- `app_user.id` is a foreign key to `auth.users(id)`, so the auth rows come first.
-- v1 has no passwords (Google, Apple, email OTP — decision U1), so these carry no
-- password: they exist to satisfy the foreign key and to give the pgTAP suite real
-- subjects to impersonate.
--
-- This block is skipped when the auth schema is absent, so that the seed can also be
-- applied to a bare Postgres for a schema check. Everything above it is portable.
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('auth.users') is null then
    raise notice 'seed: auth.users absent — skipping users, recipients and guardian links';
    return;
  end if;

  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at,
                          created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'aarav.guardian@example.invalid',  now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bela.guardian@example.invalid',   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'chetan.guardian@example.invalid', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'divya.student@example.invalid',   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'kitchen.op@example.invalid',      now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'platform.admin@example.invalid',  now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}')
  on conflict (id) do nothing;

  -- Aarav's and Bela's guardians are native accounts. Chetan's is a MIGRATED account
  -- that has not been claimed yet (claimed_at null) — the [DM-11] state that E03-11
  -- and E16-01 both have to handle, and the one nobody remembers to make a fixture for.
  insert into app_user (id, phone_e164, phone_verified_at, email, email_verified_at,
                        first_name, last_name, migration_source, claimed_at, legacy_bubble_id)
  values
    ('a0000000-0000-0000-0000-000000000001', '+919000000101', now(), 'aarav.guardian@example.invalid',  now(), 'Anita',  'Guardian', 'native',          now(), null),
    ('a0000000-0000-0000-0000-000000000002', '+919000000102', now(), 'bela.guardian@example.invalid',   now(), 'Bhavna', 'Guardian', 'native',          now(), null),
    ('a0000000-0000-0000-0000-000000000003', '+919000000103', null,  'chetan.guardian@example.invalid', null,  'Chetan', 'Guardian', 'bubble_migrated', null,  'bubble_user_0003'),
    ('a0000000-0000-0000-0000-000000000004', '+919000000104', now(), 'divya.student@example.invalid',   now(), 'Divya',  'Student',  'native',          now(), null),
    ('a0000000-0000-0000-0000-000000000005', '+919000000105', now(), 'kitchen.op@example.invalid',      now(), 'Kiran',  'Operator', 'native',          now(), null),
    ('a0000000-0000-0000-0000-000000000006', '+919000000106', now(), 'platform.admin@example.invalid',  now(), 'Priya',  'Admin',    'native',          now(), null)
  on conflict (id) do nothing;

  -- Recipients. Synthetic names only (non-negotiable #4).
  --
  -- Divya is `is_self` — an adult ordering for herself at the college. That is the row
  -- that breaks any code assuming a recipient is always a child, and it is why
  -- is_minor is false and there is a guardian_link with relationship 'self'.
  insert into recipient (id, is_self, first_name, last_name, school_id, school_class_id,
                         class_label, section_label, is_minor, allergy_note, created_by_user_id)
  values
    ('40000000-0000-0000-0000-000000000001', false, 'Aarav', 'Testchild', '50000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-000000000001', '5', 'A', true,  null, 'a0000000-0000-0000-0000-000000000001'),
    ('40000000-0000-0000-0000-000000000002', false, 'Bela',  'Testchild', '50000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-000000000002', '5', 'B', true,  'Avoids dairy', 'a0000000-0000-0000-0000-000000000001'),
    ('40000000-0000-0000-0000-000000000003', false, 'Chirag','Testchild', '50000000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-000000000004', '4', 'A', true,  null, 'a0000000-0000-0000-0000-000000000002'),
    ('40000000-0000-0000-0000-000000000004', false, 'Deepa', 'Testchild', '50000000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-000000000005', '4', 'B', true,  null, 'a0000000-0000-0000-0000-000000000002'),
    ('40000000-0000-0000-0000-000000000005', false, 'Esha',  'Testchild', '50000000-0000-0000-0000-000000000001', null,                                   '6', 'A', true,  null, 'a0000000-0000-0000-0000-000000000003'),
    ('40000000-0000-0000-0000-000000000006', true,  'Divya', 'Student',   '50000000-0000-0000-0000-000000000003', '5c000000-0000-0000-0000-000000000006', 'FY B.Sc', null, false, null, 'a0000000-0000-0000-0000-000000000004')
  on conflict (id) do nothing;

  -- Esha (recipient 5) carries a declared allergy, so the warning path has a recipient
  -- whose allergen actually collides with a dish on her school's menu (gluten, in the
  -- Veg Sandwich).
  insert into recipient_allergen (recipient_id, allergen_id)
  values ('40000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000002')
  on conflict do nothing;

  -- Guardian links.
  --
  -- Aarav has TWO guardians, one of whom cannot order (can_order false). That is
  -- [AZ-05]'s shape and the only fixture that makes "a guardian who may view but not
  -- order" a testable state rather than a paragraph in a document.
  insert into guardian_link (id, recipient_id, user_id, relationship, can_order, can_manage, is_primary, created_by_user_id)
  values
    ('61000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'mother',   true,  true,  true,  'a0000000-0000-0000-0000-000000000001'),
    ('61000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'father',   false, false, false, 'a0000000-0000-0000-0000-000000000001'),
    ('61000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'mother',   true,  true,  true,  'a0000000-0000-0000-0000-000000000001'),
    ('61000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'father',   true,  true,  true,  'a0000000-0000-0000-0000-000000000002'),
    ('61000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'father',   true,  true,  true,  'a0000000-0000-0000-0000-000000000002'),
    ('61000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000003', 'guardian', true,  true,  true,  'a0000000-0000-0000-0000-000000000003'),
    ('61000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000004', 'self',     true,  true,  true,  'a0000000-0000-0000-0000-000000000004')
  on conflict (id) do nothing;
end;
$$;

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
