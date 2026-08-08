-- =============================================================================
-- authorization.test.sql — E02-09 / Q04
--
-- Asserts EVERY ALLOW and EVERY DENY in the matrix of docs/authorization-model.md
-- §8, every numbered denial in §9, and every structural invariant in §12, against
-- 0001_initial_schema.sql + 0002_rls_policies.sql.
--
-- D8 and CLAUDE.md non-negotiable #2: the legacy Bubble app exposed every order and
-- every child record publicly. This suite is the thing that makes that impossible to
-- regress. It must fail loudly when a policy is REMOVED and — the direction that
-- actually leaks data — when a policy is ADDED.
--
-- -----------------------------------------------------------------------------
-- HOW TO RUN
--
--   supabase start && supabase test db
--
-- It CANNOT run against a bare postgres:16 container: app_user.id is a foreign key
-- to auth.users(id), so the auth schema must exist, and impersonation reads
-- auth.uid() (docs/learnings.md). This is a constraint on E01's CI design.
--
-- -----------------------------------------------------------------------------
-- FIXTURE UUID NAMESPACE — READ BEFORE ADDING A FIXTURE (E02-24)
--
-- Every UUID this file inserts carries **7e57** ("test") in its second group:
--
--   a0000000-7e57-0000-0000-000000000001
--            ^^^^
--
-- `supabase db reset` applies supabase/seed.sql BEFORE the suite runs, and seed.sql
-- uses the same readable prefixes (a0 = user, d1 = order, e1 = …) with 0000 there.
-- Seventeen ids overlapped, so the first insert died on a duplicate key and pg_prove
-- reported `Tests: 0` — not one failing assertion, but the entire suite skipped while
-- CI went green. That is the exact false confidence non-negotiable #2 exists to stop.
--
-- So: a new fixture gets 7e57, always. Nothing in seed.sql may use it.
-- `scripts/check-test-fixtures.mjs` enforces the split and runs in the smoke test.
--
-- -----------------------------------------------------------------------------
-- HOW A PERSONA IS IMPERSONATED, AND WHY THAT IS THE MOST DANGEROUS PART
--
--   select set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);
--   set local role authenticated;
--
-- auth.uid() reads request.jwt.claims. A BROKEN SETUP MAKES EVERY DENY PASS FOR THE
-- WRONG REASON — if the role never changes, or the claim is malformed, "sees zero
-- rows" is true because the query ran as postgres with RLS bypassed, or as a user
-- with no rows. That is the single most likely way this suite lies to us, so Part 0
-- asserts the harness itself before a single deny is trusted.
--
-- -----------------------------------------------------------------------------
-- HOW THE MATRIX IS ENCODED
--
-- §8's matrix is 62 tables x 5 personas. Rather than 310 hand-written assertions
-- that drift from the document, each persona gets ONE set_eq over the exact set of
-- tables in which that persona can see at least one row. It covers every allow and
-- every deny in that column at once, and on failure it names precisely which table
-- leaked or went dark. Row-level correctness — A cannot see B's data — is then
-- asserted individually in Part 5 and Part 7, which is where §9 lives.
--
-- Two things to hold on to when reading the expected sets:
--
--   * They are "the matrix column UNION the persona's own self-rows". A kitchen
--     operator is a real app_user and therefore reads their own app_user row and
--     their own permission_grant rows. §8 shows "—" there because it describes what
--     the TEMPLATE'S GRANTS open, not what the human sees; §2.2 says the same thing
--     in prose. Where that distinction matters it is asserted separately.
--   * A table is absent from an expected set either because policy denies it or
--     because this fixture gives that persona no row in it. Where the difference is
--     load-bearing — PlatformAdmin and recipient_allergen, PlatformAdmin and another
--     user's device_token — there is an explicit targeted assertion as well.
--
-- Plan is `no_plan`: the count would be a second literal to maintain alongside the
-- policy inventory in Part 2, which is the assertion that actually protects us.
-- =============================================================================

begin;

-- The harness's own tables and functions live in their own schema, never in public:
-- a helper table in public would show up in tests_visible_counts() and in the
-- "public contains exactly these 61 tables" assertion, and a suite that has to make
-- exceptions for itself is a suite that can be fooled. Rolled back with everything
-- else at the end.
create schema tests_tmp;
grant usage on schema tests_tmp to public;

set local search_path = public, tests_tmp, extensions, pg_catalog;

-- pgTAP goes in `extensions`, not `public`, where Supabase already keeps it. It ships
-- views of its own (tap_funky, pg_all_foreign_keys); installed into public they would
-- trip Part 1's "every view in public is security_invoker" assertion — the suite
-- failing because of the suite. Part 1 also excludes extension-owned objects, so this
-- is belt and braces rather than the only defence.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgtap') then
    if exists (select 1 from pg_namespace where nspname = 'extensions') then
      execute 'create extension pgtap with schema extensions';
    else
      execute 'create extension pgtap';
    end if;
  end if;
end;
$$;

-- `select * from no_plan()`, not `plan(no_plan)`. no_plan() is a set-returning
-- function; the bare identifier parses as a column reference and fails with
-- "column no_plan does not exist" — which aborts the transaction and makes every
-- assertion below report as an error rather than a failure.
select * from no_plan();

-- -----------------------------------------------------------------------------
-- A NOTE ON throws_ok, because getting it wrong is silent and this suite did.
--
-- pgTAP's signatures are:
--     throws_ok(sql, errcode)
--     throws_ok(sql, errcode, errmsg)
--     throws_ok(sql, errcode, errmsg, description)
--
-- So `throws_ok(sql, '42501', 'my description')` compares the DESCRIPTION against
-- the error message and fails on every correctly-denied statement — 17 of them here.
-- The denial is working; the assertion is asking the wrong question, and the failure
-- reads like a security hole rather than a typo.
--
-- Always pass four arguments, with `null` for errmsg unless the exact wording is the
-- thing under test. Asserting the SQLSTATE and not the prose also keeps the suite
-- from breaking when an error message is reworded.
-- -----------------------------------------------------------------------------


-- =============================================================================
-- PART 0 — Fixtures and the impersonation harness
--
-- Every id is a literal so that persona switching can be written inline: a helper
-- function that performs SET ROLE is one more thing that can silently not work.
--
--   a0000000-…  app_user / auth.users        c1…  city        c2…  kitchen
--   c3…  school       c4…  school_class      c5…  break_time
--   d1…  recipient    d2…  asset             d3…  allergen    d4…  dish_category
--   d5…  dish         d6…  menu              d7…  menu_item   d8…  menu_assignment
--   d9…  menu_item_price_override
--   e1…  order_group  e2…  order             e3…  payment     e4…  refund
--   e5…  invoice      e6…  ledger_account    e7…  ledger_transaction
--   e8…  payout       e9…  school_report
--   f1…  policy_version   f2…  data_subject_request   f3…  device_token
-- =============================================================================

-- auth.users first — app_user.id references it. Only `id` is supplied: every other
-- column in the gotrue schema is nullable or defaulted, and touching more of it
-- would couple this suite to a gotrue version.
insert into auth.users (id) values
  ('a0000000-7e57-0000-0000-000000000001'),  -- custA          customer, guardian of recipA/recipA2
  ('a0000000-7e57-0000-0000-000000000002'),  -- custB          customer, guardian of recipB/recipB1
  ('a0000000-7e57-0000-0000-000000000003'),  -- custC          co-guardian of recipA, can_manage = false
  ('a0000000-7e57-0000-0000-000000000004'),  -- custDisabled   is_disabled, WITH data and WITH grants
  ('a0000000-7e57-0000-0000-000000000005'),  -- custDeleted    deleted_at set
  ('a0000000-7e57-0000-0000-000000000006'),  -- kitchOpA       kitchen_operator @ kitchenA
  ('a0000000-7e57-0000-0000-000000000007'),  -- kitchOpB       kitchen_operator @ kitchenB
  ('a0000000-7e57-0000-0000-000000000008'),  -- schoolViewer   school_viewer @ schoolA1
  ('a0000000-7e57-0000-0000-000000000009'),  -- platformAdmin  every permission @ platform
  ('a0000000-7e57-0000-0000-00000000000a'),  -- cityMgr        city-scoped @ cityA
  ('a0000000-7e57-0000-0000-00000000000b'),  -- expiredGrantee grant with expires_at in the past
  ('a0000000-7e57-0000-0000-00000000000c'),  -- revokedGrantee grant with revoked_at set
  ('a0000000-7e57-0000-0000-00000000000d');  -- schoolScoped   orders.view @ schoolA1 only

insert into app_user (id, phone_e164, first_name, last_name, is_disabled, deleted_at) values
  ('a0000000-7e57-0000-0000-000000000001', '+919000000001', 'Asha',   'Customer', false, null),
  ('a0000000-7e57-0000-0000-000000000002', '+919000000002', 'Bikram', 'Customer', false, null),
  ('a0000000-7e57-0000-0000-000000000003', '+919000000003', 'Chitra', 'Coguard',  false, null),
  ('a0000000-7e57-0000-0000-000000000004', '+919000000004', 'Dev',    'Disabled', true,  null),
  ('a0000000-7e57-0000-0000-000000000005', '+919000000005', 'Esha',   'Deleted',  false, now()),
  ('a0000000-7e57-0000-0000-000000000006', '+919000000006', 'Farid',  'Kitchen',  false, null),
  ('a0000000-7e57-0000-0000-000000000007', '+919000000007', 'Gita',   'Kitchen',  false, null),
  ('a0000000-7e57-0000-0000-000000000008', '+919000000008', 'Hari',   'School',   false, null),
  ('a0000000-7e57-0000-0000-000000000009', '+919000000009', 'Ira',    'Admin',    false, null),
  ('a0000000-7e57-0000-0000-00000000000a', '+919000000010', 'Jai',    'City',     false, null),
  ('a0000000-7e57-0000-0000-00000000000b', '+919000000011', 'Kiran',  'Expired',  false, null),
  ('a0000000-7e57-0000-0000-00000000000c', '+919000000012', 'Lata',   'Revoked',  false, null),
  ('a0000000-7e57-0000-0000-00000000000d', '+919000000013', 'Manish', 'Scoped',   false, null);

insert into city (id, code, name, state_name, gst_state_code) values
  ('c1000000-7e57-0000-0000-000000000001', 'sas_nagar', 'SAS Nagar (Mohali)', 'Punjab', '03'),
  ('c1000000-7e57-0000-0000-000000000002', 'chandigarh','Chandigarh',         'Chandigarh', '04');

insert into kitchen (id, code, name, city_id) values
  ('c2000000-7e57-0000-0000-000000000001', 'kitchen_a', 'Kitchen A', 'c1000000-7e57-0000-0000-000000000001'),
  ('c2000000-7e57-0000-0000-000000000002', 'kitchen_b', 'Kitchen B', 'c1000000-7e57-0000-0000-000000000002');

-- schoolA1 and schoolA2 are both served by kitchenA — that pair is what makes the
-- kitchen -> school scope-widening assertion (§9 item 15) meaningful.
insert into school (id, code, name, city_id, kitchen_id, onboarded_at) values
  ('c3000000-7e57-0000-0000-000000000001', 'school_a1', 'School A1', 'c1000000-7e57-0000-0000-000000000001', 'c2000000-7e57-0000-0000-000000000001', now()),
  ('c3000000-7e57-0000-0000-000000000002', 'school_a2', 'School A2', 'c1000000-7e57-0000-0000-000000000001', 'c2000000-7e57-0000-0000-000000000001', now()),
  ('c3000000-7e57-0000-0000-000000000003', 'school_b1', 'School B1', 'c1000000-7e57-0000-0000-000000000002', 'c2000000-7e57-0000-0000-000000000002', now());

insert into school_class (id, school_id, class_label, section_label) values
  ('c4000000-7e57-0000-0000-000000000001', 'c3000000-7e57-0000-0000-000000000001', '5', 'A');

insert into break_time (id, school_id, code, label, starts_at, ends_at) values
  ('c5000000-7e57-0000-0000-000000000001', 'c3000000-7e57-0000-0000-000000000001', 'break_1', 'Morning break', '10:40', '11:15');

insert into break_time_class (break_time_id, school_class_id) values
  ('c5000000-7e57-0000-0000-000000000001', 'c4000000-7e57-0000-0000-000000000001');

-- Recipients. recipOrphan is the D10 test: created_by_user_id is custA, but the only
-- guardian_link is to custB, so custA must see nothing.
insert into recipient (id, first_name, school_id, school_class_id, created_by_user_id) values
  ('d1000000-7e57-0000-0000-000000000001', 'Aarav', 'c3000000-7e57-0000-0000-000000000001', 'c4000000-7e57-0000-0000-000000000001', 'a0000000-7e57-0000-0000-000000000001'),
  ('d1000000-7e57-0000-0000-000000000002', 'Bela',  'c3000000-7e57-0000-0000-000000000001', null, 'a0000000-7e57-0000-0000-000000000002'),
  ('d1000000-7e57-0000-0000-000000000003', 'Chetan','c3000000-7e57-0000-0000-000000000003', null, 'a0000000-7e57-0000-0000-000000000002'),
  ('d1000000-7e57-0000-0000-000000000004', 'Divya', 'c3000000-7e57-0000-0000-000000000001', null, 'a0000000-7e57-0000-0000-000000000004'),
  ('d1000000-7e57-0000-0000-000000000005', 'Eshan', 'c3000000-7e57-0000-0000-000000000001', null, 'a0000000-7e57-0000-0000-000000000001'),  -- recipOrphan
  ('d1000000-7e57-0000-0000-000000000006', 'Farah', 'c3000000-7e57-0000-0000-000000000001', null, 'a0000000-7e57-0000-0000-000000000001'),  -- recipRevoked
  ('d1000000-7e57-0000-0000-000000000007', 'Gopal', 'c3000000-7e57-0000-0000-000000000002', null, 'a0000000-7e57-0000-0000-000000000001');  -- recipA2, at schoolA2

insert into guardian_link (id, recipient_id, user_id, relationship, can_order, can_manage, is_primary, revoked_at) values
  ('d1a00000-7e57-0000-0000-000000000001', 'd1000000-7e57-0000-0000-000000000001', 'a0000000-7e57-0000-0000-000000000001', 'mother',   true,  true,  true,  null),
  ('d1a00000-7e57-0000-0000-000000000002', 'd1000000-7e57-0000-0000-000000000001', 'a0000000-7e57-0000-0000-000000000003', 'guardian', true,  false, false, null),
  ('d1a00000-7e57-0000-0000-000000000003', 'd1000000-7e57-0000-0000-000000000002', 'a0000000-7e57-0000-0000-000000000002', 'father',   true,  true,  true,  null),
  ('d1a00000-7e57-0000-0000-000000000004', 'd1000000-7e57-0000-0000-000000000003', 'a0000000-7e57-0000-0000-000000000002', 'father',   true,  true,  true,  null),
  ('d1a00000-7e57-0000-0000-000000000005', 'd1000000-7e57-0000-0000-000000000004', 'a0000000-7e57-0000-0000-000000000004', 'father',   true,  true,  true,  null),
  ('d1a00000-7e57-0000-0000-000000000006', 'd1000000-7e57-0000-0000-000000000005', 'a0000000-7e57-0000-0000-000000000002', 'mother',   true,  true,  true,  null),
  ('d1a00000-7e57-0000-0000-000000000007', 'd1000000-7e57-0000-0000-000000000006', 'a0000000-7e57-0000-0000-000000000001', 'mother',   true,  true,  true,  now()),
  ('d1a00000-7e57-0000-0000-000000000008', 'd1000000-7e57-0000-0000-000000000007', 'a0000000-7e57-0000-0000-000000000001', 'mother',   true,  true,  true,  null);

insert into allergen (id, code, display_name) values
  ('d3000000-7e57-0000-0000-000000000001', 'peanut', 'Peanut');

-- Two rows: recipA's is asserted on by the kitchen (the fulfilment path) and must
-- survive the whole run; recipA2's exists so that the customer-plane DELETE — the
-- only DELETE in the customer plane, §13.4 — can be exercised without destroying a
-- fixture something else depends on.
insert into recipient_allergen (recipient_id, allergen_id, severity) values
  ('d1000000-7e57-0000-0000-000000000001', 'd3000000-7e57-0000-0000-000000000001', 'anaphylaxis'),
  ('d1000000-7e57-0000-0000-000000000007', 'd3000000-7e57-0000-0000-000000000001', 'intolerance');

insert into asset (id, kind, bucket, path) values
  ('d2000000-7e57-0000-0000-000000000001', 'dish_image',  'dish-images', 'dish/a.jpg'),
  ('d2000000-7e57-0000-0000-000000000002', 'invoice_pdf', 'invoices',    'inv/a.pdf'),
  ('d2000000-7e57-0000-0000-000000000003', 'report_pdf',  'reports',     'rep/a.pdf'),
  ('d2000000-7e57-0000-0000-000000000004', 'import_file', 'imports',     'imp/a.xlsx');

insert into dish_category (id, code, display_name) values
  ('d4000000-7e57-0000-0000-000000000001', 'quick_bites', 'Quick bites');

insert into dish (id, kitchen_id, name, category_id, image_asset_id) values
  ('d5000000-7e57-0000-0000-000000000001', 'c2000000-7e57-0000-0000-000000000001', 'Veg Sandwich', 'd4000000-7e57-0000-0000-000000000001', 'd2000000-7e57-0000-0000-000000000001'),
  ('d5000000-7e57-0000-0000-000000000002', 'c2000000-7e57-0000-0000-000000000002', 'Paneer Roll',  'd4000000-7e57-0000-0000-000000000001', null);

insert into dish_allergen (dish_id, allergen_id) values
  ('d5000000-7e57-0000-0000-000000000001', 'd3000000-7e57-0000-0000-000000000001');

insert into menu (id, kitchen_id, name, status) values
  ('d6000000-7e57-0000-0000-000000000001', 'c2000000-7e57-0000-0000-000000000001', 'Menu A', 'active'),
  ('d6000000-7e57-0000-0000-000000000002', 'c2000000-7e57-0000-0000-000000000002', 'Menu B', 'active');

insert into menu_item (id, menu_id, dish_id, price_paise) values
  ('d7000000-7e57-0000-0000-000000000001', 'd6000000-7e57-0000-0000-000000000001', 'd5000000-7e57-0000-0000-000000000001', 10000),
  ('d7000000-7e57-0000-0000-000000000002', 'd6000000-7e57-0000-0000-000000000002', 'd5000000-7e57-0000-0000-000000000002', 10000);

insert into menu_assignment (id, school_id, menu_id, valid_from) values
  ('d8000000-7e57-0000-0000-000000000001', 'c3000000-7e57-0000-0000-000000000001', 'd6000000-7e57-0000-0000-000000000001', current_date - 1),
  ('d8000000-7e57-0000-0000-000000000002', 'c3000000-7e57-0000-0000-000000000002', 'd6000000-7e57-0000-0000-000000000001', current_date - 1),
  ('d8000000-7e57-0000-0000-000000000003', 'c3000000-7e57-0000-0000-000000000003', 'd6000000-7e57-0000-0000-000000000002', current_date - 1);

insert into menu_item_price_override (id, school_id, menu_item_id, price_paise, valid_from) values
  ('d9000000-7e57-0000-0000-000000000001', 'c3000000-7e57-0000-0000-000000000001', 'd7000000-7e57-0000-0000-000000000001', 9000, current_date - 1);

insert into menu_item_capacity (menu_item_id, service_date, capacity_total, remaining) values
  ('d7000000-7e57-0000-0000-000000000001', current_date, 100, 100);

-- school_menu_version rows are created by the trigger on school insert (0001 §14).

insert into kitchen_config (kitchen_id) values ('c2000000-7e57-0000-0000-000000000001');
insert into school_config  (school_id)  values ('c3000000-7e57-0000-0000-000000000001');
insert into config_change_log (scope_type, scope_id, setting_key, old_value, new_value) values
  ('platform', null, 'order_cutoff_time', '"00:00"'::jsonb, '"09:00"'::jsonb);

-- Orders. ogA/orderA is custA's; ogB/orderB is custB's at the SAME school (customer
-- isolation); ogB1/orderB1 is custB's at a school served by a DIFFERENT kitchen
-- (scope widening, both directions); ogA2/orderA2 is at schoolA2, the second school
-- kitchenA serves; ogD/orderD belongs to the disabled account.
insert into order_group (id, customer_user_id, idempotency_key, city_id, status,
                         subtotal_paise, tax_total_paise, discount_paise, wallet_applied_paise, payable_paise) values
  ('e1000000-7e57-0000-0000-000000000001', 'a0000000-7e57-0000-0000-000000000001', 'idem-a',  'c1000000-7e57-0000-0000-000000000001', 'paid', 10000, 500, 0, 0, 10500),
  ('e1000000-7e57-0000-0000-000000000002', 'a0000000-7e57-0000-0000-000000000002', 'idem-b',  'c1000000-7e57-0000-0000-000000000001', 'paid', 20000, 1000, 0, 0, 21000),
  ('e1000000-7e57-0000-0000-000000000003', 'a0000000-7e57-0000-0000-000000000002', 'idem-b1', 'c1000000-7e57-0000-0000-000000000002', 'paid', 10000, 500, 0, 0, 10500),
  ('e1000000-7e57-0000-0000-000000000004', 'a0000000-7e57-0000-0000-000000000001', 'idem-a2', 'c1000000-7e57-0000-0000-000000000001', 'paid', 10000, 500, 0, 0, 10500),
  ('e1000000-7e57-0000-0000-000000000005', 'a0000000-7e57-0000-0000-000000000004', 'idem-d',  'c1000000-7e57-0000-0000-000000000001', 'paid', 10000, 500, 0, 0, 10500);

insert into "order" (id, order_group_id, order_ref, correlation_id, customer_user_id, recipient_id,
                     school_id, kitchen_id, city_id, service_date, break_time_id, delivery_mode, status,
                     subtotal_paise, tax_cgst_paise, tax_sgst_paise, total_paise,
                     cutoff_at, config_snapshot, school_name_snapshot, recipient_name_snapshot) values
  ('e2000000-7e57-0000-0000-000000000001', 'e1000000-7e57-0000-0000-000000000001', 'GB-A0001', gen_random_uuid(), 'a0000000-7e57-0000-0000-000000000001', 'd1000000-7e57-0000-0000-000000000001', 'c3000000-7e57-0000-0000-000000000001', 'c2000000-7e57-0000-0000-000000000001', 'c1000000-7e57-0000-0000-000000000001', current_date, 'c5000000-7e57-0000-0000-000000000001', 'classroom', 'paid', 10000, 250, 250, 10500, now(), '{}'::jsonb, 'School A1', 'Aarav'),
  ('e2000000-7e57-0000-0000-000000000002', 'e1000000-7e57-0000-0000-000000000002', 'GB-B0001', gen_random_uuid(), 'a0000000-7e57-0000-0000-000000000002', 'd1000000-7e57-0000-0000-000000000002', 'c3000000-7e57-0000-0000-000000000001', 'c2000000-7e57-0000-0000-000000000001', 'c1000000-7e57-0000-0000-000000000001', current_date, null, 'counter', 'paid', 20000, 500, 500, 21000, now(), '{}'::jsonb, 'School A1', 'Bela'),
  ('e2000000-7e57-0000-0000-000000000003', 'e1000000-7e57-0000-0000-000000000003', 'GB-B1001', gen_random_uuid(), 'a0000000-7e57-0000-0000-000000000002', 'd1000000-7e57-0000-0000-000000000003', 'c3000000-7e57-0000-0000-000000000003', 'c2000000-7e57-0000-0000-000000000002', 'c1000000-7e57-0000-0000-000000000002', current_date, null, 'counter', 'paid', 10000, 250, 250, 10500, now(), '{}'::jsonb, 'School B1', 'Chetan'),
  ('e2000000-7e57-0000-0000-000000000004', 'e1000000-7e57-0000-0000-000000000004', 'GB-A2001', gen_random_uuid(), 'a0000000-7e57-0000-0000-000000000001', 'd1000000-7e57-0000-0000-000000000007', 'c3000000-7e57-0000-0000-000000000002', 'c2000000-7e57-0000-0000-000000000001', 'c1000000-7e57-0000-0000-000000000001', current_date, null, 'counter', 'paid', 10000, 250, 250, 10500, now(), '{}'::jsonb, 'School A2', 'Gopal'),
  ('e2000000-7e57-0000-0000-000000000005', 'e1000000-7e57-0000-0000-000000000005', 'GB-D0001', gen_random_uuid(), 'a0000000-7e57-0000-0000-000000000004', 'd1000000-7e57-0000-0000-000000000004', 'c3000000-7e57-0000-0000-000000000001', 'c2000000-7e57-0000-0000-000000000001', 'c1000000-7e57-0000-0000-000000000001', current_date, null, 'counter', 'paid', 10000, 250, 250, 10500, now(), '{}'::jsonb, 'School A1', 'Divya');

insert into order_line (order_id, line_no, menu_item_id, dish_id, quantity, unit_price_paise,
                        line_subtotal_paise, tax_cgst_paise, tax_sgst_paise, line_total_paise, dish_name_snapshot) values
  ('e2000000-7e57-0000-0000-000000000001', 1, 'd7000000-7e57-0000-0000-000000000001', 'd5000000-7e57-0000-0000-000000000001', 1, 10000, 10000, 250, 250, 10500, 'Veg Sandwich'),
  ('e2000000-7e57-0000-0000-000000000002', 1, 'd7000000-7e57-0000-0000-000000000001', 'd5000000-7e57-0000-0000-000000000001', 2, 10000, 20000, 500, 500, 21000, 'Veg Sandwich'),
  ('e2000000-7e57-0000-0000-000000000003', 1, 'd7000000-7e57-0000-0000-000000000002', 'd5000000-7e57-0000-0000-000000000002', 1, 10000, 10000, 250, 250, 10500, 'Paneer Roll');

insert into order_event (order_id, from_status, to_status, actor_type, note, correlation_id) values
  ('e2000000-7e57-0000-0000-000000000001', 'pending_payment', 'paid', 'payment_provider', 'internal note, not for the parent', gen_random_uuid());

-- Customer B gets a full money trail of their own, so that Customer A's isolation
-- assertions have something real to fail against. An is_empty over a table holding
-- only the caller's own rows passes for the wrong reason.
insert into payment (id, order_group_id, provider_order_id, amount_paise, status, correlation_id) values
  ('e3000000-7e57-0000-0000-000000000001', 'e1000000-7e57-0000-0000-000000000001', 'order_rzp_a', 10500, 'captured', gen_random_uuid()),
  ('e3000000-7e57-0000-0000-000000000002', 'e1000000-7e57-0000-0000-000000000002', 'order_rzp_b', 21000, 'captured', gen_random_uuid());

insert into payment_webhook_event (provider, provider_event_id, event_type, signature_verified, payload) values
  ('razorpay', 'evt_a', 'payment.captured', true, '{}'::jsonb);

insert into refund (id, order_group_id, order_id, payment_id, destination, amount_paise, reason_code, status, correlation_id) values
  ('e4000000-7e57-0000-0000-000000000001', 'e1000000-7e57-0000-0000-000000000001', 'e2000000-7e57-0000-0000-000000000001', 'e3000000-7e57-0000-0000-000000000001', 'wallet', 5000, 'goodwill', 'completed', gen_random_uuid()),
  ('e4000000-7e57-0000-0000-000000000002', 'e1000000-7e57-0000-0000-000000000002', 'e2000000-7e57-0000-0000-000000000002', 'e3000000-7e57-0000-0000-000000000002', 'wallet', 1000, 'goodwill', 'completed', gen_random_uuid());

insert into refund_line (refund_id, order_line_id, quantity, amount_paise)
select 'e4000000-7e57-0000-0000-000000000001', ol.id, 1, 5000
  from order_line ol
 where ol.order_id = 'e2000000-7e57-0000-0000-000000000001' and ol.line_no = 1;

insert into refund_line (refund_id, order_line_id, quantity, amount_paise)
select 'e4000000-7e57-0000-0000-000000000002', ol.id, 1, 1000
  from order_line ol
 where ol.order_id = 'e2000000-7e57-0000-0000-000000000002' and ol.line_no = 1;

insert into ledger_account (id, code, owner_type, owner_id, account_type, normal_balance) values
  ('e6000000-7e57-0000-0000-000000000001', 'provider:razorpay:clearing', 'provider', null, 'provider_clearing', 'debit'),
  ('e6000000-7e57-0000-0000-000000000002', 'platform:revenue',           'platform', null, 'revenue',           'credit');

insert into ledger_transaction (id, reason_code, source_type, source_id, occurred_at) values
  ('e7000000-7e57-0000-0000-000000000001', 'migration_opening_balance', 'payment', 'e3000000-7e57-0000-0000-000000000001', now());

insert into ledger_entry (transaction_id, account_id, direction, amount_paise) values
  ('e7000000-7e57-0000-0000-000000000001', 'e6000000-7e57-0000-0000-000000000001', 'debit',  10500),
  ('e7000000-7e57-0000-0000-000000000001', 'e6000000-7e57-0000-0000-000000000002', 'credit', 10500);

insert into wallet_balance (user_id, balance_paise) values
  ('a0000000-7e57-0000-0000-000000000001', 5000);

insert into invoice_sequence (financial_year, last_sequence_no) values ('2026-27', 1);

insert into invoice (id, invoice_number, financial_year, sequence_no, order_group_id,
                     seller_gstin, seller_legal_name, seller_address, place_of_supply_state_code, sac_code,
                     buyer_name_snapshot, taxable_value_paise, cgst_rate_bps, cgst_paise,
                     sgst_rate_bps, sgst_paise, total_paise) values
  ('e5000000-7e57-0000-0000-000000000001', 'GB/2026-27/000001', '2026-27', 1, 'e1000000-7e57-0000-0000-000000000001',
   'PLACEHOLDER', 'GrayBag', 'Mohali', '03', '996331', 'Asha Customer',  10000, 250, 250, 250, 250, 10500),
  ('e5000000-7e57-0000-0000-000000000002', 'GB/2026-27/000002', '2026-27', 2, 'e1000000-7e57-0000-0000-000000000002',
   'PLACEHOLDER', 'GrayBag', 'Mohali', '03', '996331', 'Bikram Customer', 20000, 250, 500, 250, 500, 21000);

insert into invoice_line (invoice_id, line_no, order_line_id, description, sac_code, quantity,
                          unit_price_paise, taxable_value_paise, cgst_paise, sgst_paise, total_paise)
select 'e5000000-7e57-0000-0000-000000000001', 1, ol.id, 'Veg Sandwich', '996331', 1, 10000, 10000, 250, 250, 10500
  from order_line ol
 where ol.order_id = 'e2000000-7e57-0000-0000-000000000001' and ol.line_no = 1;

insert into invoice_line (invoice_id, line_no, order_line_id, description, sac_code, quantity,
                          unit_price_paise, taxable_value_paise, cgst_paise, sgst_paise, total_paise)
select 'e5000000-7e57-0000-0000-000000000002', 1, ol.id, 'Veg Sandwich', '996331', 2, 10000, 20000, 500, 500, 21000
  from order_line ol
 where ol.order_id = 'e2000000-7e57-0000-0000-000000000002' and ol.line_no = 1;

-- Two payouts for schoolA1: one draft (a school must NEVER see this — §9 item 19)
-- and one confirmed (a school must see exactly this one).
insert into payout (id, payee_type, payee_id, period_start, period_end, gross_sales_paise,
                    share_bps, share_paise, net_payable_paise, status, notes) values
  ('e8000000-7e57-0000-0000-000000000001', 'school', 'c3000000-7e57-0000-0000-000000000001', '2026-06-01', '2026-06-30', 100000, 1000, 10000, 10000, 'draft',     'internal working note'),
  ('e8000000-7e57-0000-0000-000000000002', 'school', 'c3000000-7e57-0000-0000-000000000001', '2026-07-01', '2026-07-31', 100000, 1000, 10000, 10000, 'confirmed', 'agreed with the principal');

insert into payout_line (payout_id, order_id, kind, amount_paise) values
  ('e8000000-7e57-0000-0000-000000000002', 'e2000000-7e57-0000-0000-000000000001', 'revenue_share', 1000);

-- A second school's report exists so that "a SchoolViewer sees their own and no
-- other" is a real assertion rather than a vacuous one.
insert into school_report (id, school_id, period_month, share_bps, pdf_asset_id, status) values
  ('e9000000-7e57-0000-0000-000000000001', 'c3000000-7e57-0000-0000-000000000001', '2026-07-01', 1000, 'd2000000-7e57-0000-0000-000000000003', 'sent'),
  ('e9000000-7e57-0000-0000-000000000002', 'c3000000-7e57-0000-0000-000000000003', '2026-07-01', 1000, null, 'sent');

insert into policy_document (code, display_name, applies_to) values
  ('privacy_policy', 'Privacy policy', 'both');

insert into policy_version (id, policy_code, version, effective_from, published_at, content_sha256) values
  ('f1000000-7e57-0000-0000-000000000001', 'privacy_policy', '1', now() - interval '1 day', now() - interval '1 day', 'sha-published'),
  ('f1000000-7e57-0000-0000-000000000002', 'privacy_policy', '2', now(),                    null,                    'sha-draft');

insert into user_policy_acceptance (user_id, policy_version_id, source) values
  ('a0000000-7e57-0000-0000-000000000001', 'f1000000-7e57-0000-0000-000000000001', 'app');

insert into consent_purpose (code, display_name, applies_to_subject) values
  ('child_data', 'Storing your child''s details', 'dependent');

insert into consent_record (user_id, subject_type, subject_id, purpose_code, action, capture_method) values
  ('a0000000-7e57-0000-0000-000000000001', 'recipient', 'd1000000-7e57-0000-0000-000000000001', 'child_data', 'granted', 'in_app_checkbox');

insert into data_subject_request (id, user_id, request_type, channel, due_at) values
  ('f2000000-7e57-0000-0000-000000000001', 'a0000000-7e57-0000-0000-000000000001', 'access', 'app', now() + interval '7 days');

insert into retention_policy (entity, retention_days, basis, action) values
  ('order_event', 365, 'operational', 'delete');

insert into purge_run (entity, cutoff_date) values ('order_event', current_date);

insert into idempotency_key (key, scope, request_hash, expires_at) values
  ('k-a', 'checkout', 'hash-a', now() + interval '1 day');

insert into device_token (id, user_id, platform) values
  ('f3000000-7e57-0000-0000-000000000001', 'a0000000-7e57-0000-0000-000000000001', 'ios');

insert into notification_preference (user_id, channel, category, enabled) values
  ('a0000000-7e57-0000-0000-000000000001', 'push', 'order_updates', true);

insert into notification_delivery (user_id, channel, template_code) values
  ('a0000000-7e57-0000-0000-000000000001', 'push', 'order.delivered');

insert into audit_log (actor_user_id, actor_type, action, source) values
  ('a0000000-7e57-0000-0000-000000000009', 'admin', 'test.fixture', 'job');

-- Grants. D11: templates are bundles that expand into grants, so the fixtures
-- expand them by hand exactly as the admin UI will.
--
-- Every non-city holder of orders.view also holds orders.view_pii. That is not
-- decoration: [AZ-02] says orders.view_pii cannot be enforced by RLS and is safe
-- ONLY while that is true, and Part 9 asserts it.
insert into permission_grant (user_id, permission_code, scope_type, scope_id, granted_by_user_id, expires_at, revoked_at)
-- Every column needs an explicit cast: literals inside a VALUES list resolve to
-- `text`, not to `unknown`, so they do NOT implicitly coerce to uuid the way a bare
-- literal in a plain INSERT would.
select u::uuid, p, s::scope_type, sid::uuid,
       'a0000000-7e57-0000-0000-000000000009'::uuid, exp::timestamptz, rev::timestamptz
from (values
  -- kitchOpA @ kitchenA
  ('a0000000-7e57-0000-0000-000000000006','orders.view','kitchen','c2000000-7e57-0000-0000-000000000001'::uuid,null::timestamptz,null::timestamptz),
  ('a0000000-7e57-0000-0000-000000000006','orders.view_pii','kitchen','c2000000-7e57-0000-0000-000000000001',null,null),
  ('a0000000-7e57-0000-0000-000000000006','orders.mark_delivered','kitchen','c2000000-7e57-0000-0000-000000000001',null,null),
  ('a0000000-7e57-0000-0000-000000000006','orders.cancel','kitchen','c2000000-7e57-0000-0000-000000000001',null,null),
  ('a0000000-7e57-0000-0000-000000000006','menu.view','kitchen','c2000000-7e57-0000-0000-000000000001',null,null),
  ('a0000000-7e57-0000-0000-000000000006','menu.edit','kitchen','c2000000-7e57-0000-0000-000000000001',null,null),
  ('a0000000-7e57-0000-0000-000000000006','dish.edit','kitchen','c2000000-7e57-0000-0000-000000000001',null,null),
  ('a0000000-7e57-0000-0000-000000000006','reports.view','kitchen','c2000000-7e57-0000-0000-000000000001',null,null),
  -- kitchOpB @ kitchenB
  ('a0000000-7e57-0000-0000-000000000007','orders.view','kitchen','c2000000-7e57-0000-0000-000000000002',null,null),
  ('a0000000-7e57-0000-0000-000000000007','orders.view_pii','kitchen','c2000000-7e57-0000-0000-000000000002',null,null),
  ('a0000000-7e57-0000-0000-000000000007','menu.view','kitchen','c2000000-7e57-0000-0000-000000000002',null,null),
  ('a0000000-7e57-0000-0000-000000000007','reports.view','kitchen','c2000000-7e57-0000-0000-000000000002',null,null),
  -- schoolViewer @ schoolA1
  ('a0000000-7e57-0000-0000-000000000008','reports.view','school','c3000000-7e57-0000-0000-000000000001',null,null),
  ('a0000000-7e57-0000-0000-000000000008','school.view','school','c3000000-7e57-0000-0000-000000000001',null,null),
  ('a0000000-7e57-0000-0000-000000000008','payouts.view','school','c3000000-7e57-0000-0000-000000000001',null,null),
  -- cityMgr @ cityA. orders.view_pii is NOT valid at city scope (0001 §17), which is
  -- why the [AZ-02] tripwire in Part 9 excludes city-scoped grants.
  ('a0000000-7e57-0000-0000-00000000000a','orders.view','city','c1000000-7e57-0000-0000-000000000001',null,null),
  ('a0000000-7e57-0000-0000-00000000000a','school.view','city','c1000000-7e57-0000-0000-000000000001',null,null),
  ('a0000000-7e57-0000-0000-00000000000a','reports.view','city','c1000000-7e57-0000-0000-000000000001',null,null),
  -- expired and revoked: identical grants, neither of which may authorize anything
  ('a0000000-7e57-0000-0000-00000000000b','orders.view','school','c3000000-7e57-0000-0000-000000000001',now() - interval '1 day',null),
  ('a0000000-7e57-0000-0000-00000000000b','orders.view_pii','school','c3000000-7e57-0000-0000-000000000001',now() - interval '1 day',null),
  ('a0000000-7e57-0000-0000-00000000000c','orders.view','school','c3000000-7e57-0000-0000-000000000001',null,now()),
  ('a0000000-7e57-0000-0000-00000000000c','orders.view_pii','school','c3000000-7e57-0000-0000-000000000001',null,now()),
  -- school-scoped only: the control for "widening is one-directional"
  ('a0000000-7e57-0000-0000-00000000000d','orders.view','school','c3000000-7e57-0000-0000-000000000001',null,null),
  ('a0000000-7e57-0000-0000-00000000000d','orders.view_pii','school','c3000000-7e57-0000-0000-000000000001',null,null),
  -- the disabled account holds real, live, unexpired grants. It must still see
  -- nothing anywhere (§9 item 8).
  ('a0000000-7e57-0000-0000-000000000004','orders.view','school','c3000000-7e57-0000-0000-000000000001',null,null),
  ('a0000000-7e57-0000-0000-000000000004','orders.view_pii','school','c3000000-7e57-0000-0000-000000000001',null,null)
) as v(u, p, s, sid, exp, rev);

-- platformAdmin: every permission, at platform.
insert into permission_grant (user_id, permission_code, scope_type, scope_id, granted_by_user_id)
select 'a0000000-7e57-0000-0000-000000000009', code, 'platform', null, 'a0000000-7e57-0000-0000-000000000009'
  from permission;

-- -----------------------------------------------------------------------------
-- The harness itself
-- -----------------------------------------------------------------------------

-- Returns the number of rows each table in a schema yields to the CURRENT role.
-- NOT security definer, deliberately — the whole point is that it runs as the
-- persona. A role with no privilege on the table (§10's revokes, or the migration
-- schema's revoked USAGE) counts as zero rather than aborting the transaction.
create function tests_tmp.tests_visible_counts(p_schema text)
returns table (tbl text, n bigint)
language plpgsql as $$
declare
  r record;
  c bigint;
begin
  -- Driven off pg_class/pg_namespace rather than pg_tables + to_regclass.
  -- to_regclass() resolves a name, and resolving a name in a schema the CURRENT role
  -- has no USAGE on raises `permission denied for schema ...` — from the FOR query
  -- itself, outside the per-table exception handler below, so it aborts the whole
  -- transaction. That is exactly the case this function exists to measure: `anon` has
  -- no USAGE on `migration`, which is a STRONGER denial than RLS returning no rows,
  -- and the suite must record it as zero rather than die on it.
  for r in
    select c.relname::text as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = p_schema
       and c.relkind = 'r'
       and not exists (select 1 from pg_depend d
                        where d.objid = c.oid and d.deptype = 'e')
     order by 1
  loop
    begin
      execute format('select count(*) from %I.%I', p_schema, r.tablename) into c;
    exception
      when insufficient_privilege or undefined_table or invalid_schema_name then
        c := 0;
    end;
    tbl := r.tablename;
    n   := c;
    return next;
  end loop;
end;
$$;
grant execute on function tests_tmp.tests_visible_counts(text) to public;

-- Attempts a bare INSERT and reports the SQLSTATE instead of aborting. Used for the
-- class-3 write wall, where the correct answer is always 42501 —
-- insufficient_privilege from §10's revoke, or from RLS having no policy to permit
-- it. Anything else (a NOT NULL violation, say) means the write got FURTHER than it
-- should have, and the test fails.
create function tests_tmp.tests_insert_sqlstate(p_table text) returns text
language plpgsql as $$
begin
  execute format('insert into public.%I default values', p_table);
  return 'NO ERROR';
exception when others then
  return sqlstate;
end;
$$;
grant execute on function tests_tmp.tests_insert_sqlstate(text) to public;

create table tests_tmp.tests_seen (persona text not null, tbl text not null);
grant all on tests_tmp.tests_seen to public;

-- The class-3 table list, kept identical to §10's revoke list in
-- 0002_rls_policies.sql. A new table that belongs in class 3 must be added in BOTH
-- places, which is the point: the duplication is the check.
create table tests_tmp.tests_class3 (tbl text primary key);
insert into tests_tmp.tests_class3 values
  ('order_group'), ('order'), ('order_line'), ('order_event'),
  ('payment'), ('payment_webhook_event'), ('refund'), ('refund_line'),
  ('ledger_account'), ('ledger_transaction'), ('ledger_entry'), ('wallet_balance'),
  ('invoice'), ('invoice_line'), ('invoice_sequence'), ('payout'), ('payout_line'),
  ('permission'), ('role_template'), ('role_template_permission'), ('permission_grant'),
  ('platform_config'), ('kitchen_config'), ('school_config'), ('config_change_log'),
  ('policy_document'), ('policy_version'), ('consent_purpose'),
  ('retention_policy'), ('purge_run'), ('idempotency_key'),
  ('audit_log'), ('school_report'), ('notification_delivery'),
  ('school_menu_version'), ('menu_item_capacity'), ('reason_code');
grant all on tests_tmp.tests_class3 to public;


-- =============================================================================
-- PART 0b — Assert the harness BEFORE trusting a single deny
--
-- A broken impersonation setup makes every deny pass for the wrong reason. If any
-- of these four fail, nothing below this line means anything.
-- =============================================================================

select is(current_user::text, session_user::text, 'harness: fixtures were loaded as the session role, not as a persona');

do $$ begin
  perform set_config('request.jwt.claims',
    '{"sub":"a0000000-7e57-0000-0000-000000000001","role":"authenticated"}', true);
end $$;
set local role authenticated;

select is(current_user::text, 'authenticated', 'harness: SET LOCAL ROLE actually switched the Postgres role');
select is((select auth.uid())::text, 'a0000000-7e57-0000-0000-000000000001',
          'harness: auth.uid() reads the impersonated subject from request.jwt.claims');
select isnt_empty($$ select 1 from "order" where id = 'e2000000-7e57-0000-0000-000000000001' $$,
                  'harness: an impersonated customer really does see their own order (so a later is_empty means something)');
reset role;


-- =============================================================================
-- PART 1 — Structural invariants (§12)
--
-- Cheap, and they catch whole classes of mistake that no per-row assertion would.
-- =============================================================================

select is_empty($$ select schemaname || '.' || tablename from pg_tables
                    where schemaname in ('public','migration') and not rowsecurity
                      and not exists (select 1 from pg_depend d
                                       where d.objid = to_regclass(quote_ident(schemaname) || '.' || quote_ident(tablename))
                                         and d.deptype = 'e') $$,
                '§9.3 / §12: RLS is enabled on every table in public and migration — if 0002 is ever missing or half-applied, the failure mode is "nobody can read anything" (D17)');

select is_empty($$ select schemaname || '.' || tablename || '.' || policyname from pg_policies
                    where schemaname = 'public'
                      and ('anon' = any(roles) or roles = '{public}' or roles is null) $$,
                '§9.4 / [AZ-03]: no policy in public grants anon or PUBLIC — the missing-TO-clause trap');

select is_empty($$ select schemaname || '.' || policyname from pg_policies
                    where schemaname = 'migration' $$,
                '§7.11: the migration schema has no policies, and never will');

-- Without the pin a SECURITY DEFINER function is a privilege-escalation vector
-- (docs/learnings.md). Extension-owned objects are excluded from this and the next
-- assertion: they are not ours to fix, and a suite that fails because of what an
-- extension ships gets disabled rather than read.
select is_empty($$ select p.proname from pg_proc p
                    join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.prosecdef
                     and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%'
                     and not exists (select 1 from pg_depend d
                                      where d.objid = p.oid and d.deptype = 'e') $$,
                '§12: every SECURITY DEFINER function in public pins search_path');

select is_empty($$ select c.relname from pg_class c
                    join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relkind = 'v'
                     and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=true%'
                     and not exists (select 1 from pg_depend d
                                      where d.objid = c.oid and d.deptype = 'e') $$,
                '§12: every view in public is security_invoker — the failure is silent, the view simply returns rows it should not');

select is_empty($$ select tablename || '.' || policyname from pg_policies
                    where schemaname = 'public'
                      and (coalesce(qual, '') like '%created_by_user_id%'
                        or coalesce(with_check, '') like '%created_by_user_id%') $$,
                'D10 / §12: created_by_user_id is never an authorization path — guardian_link is the only one');

-- FOR ALL uses its USING clause for both visibility and write-checks, so a
-- permissive FOR ALL policy is a write policy nobody noticed writing.
select is_empty($$ select tablename || '.' || policyname from pg_policies
                    where schemaname = 'public' and cmd = 'ALL' and permissive = 'PERMISSIVE' $$,
                '§5 Rule 3: no permissive policy uses FOR ALL — one policy per command');

-- Rule 3's other half. An UPDATE policy without WITH CHECK lets a user move a row
-- out of their own visibility.
select is_empty($$ select tablename || '.' || policyname from pg_policies
                    where schemaname = 'public' and cmd = 'UPDATE' and permissive = 'PERMISSIVE'
                      and with_check is null $$,
                '§5 Rule 3: every UPDATE policy carries WITH CHECK as well as USING');

-- docs/learnings.md: bare auth.uid() is STABLE, not IMMUTABLE, so the planner
-- re-evaluates it once per candidate row; wrapped in a scalar subquery it is hoisted
-- to an InitPlan and evaluated once per statement. On "order" that is the difference
-- between a policy that costs nothing and one that costs a function call per row.
--
-- Counted rather than regex-matched: every occurrence of `auth.uid()` in a rendered
-- predicate must be part of an occurrence of `SELECT auth.uid()`.
select is_empty($$
  select tablename || '.' || policyname
    from pg_policies,
         lateral (select coalesce(qual, '') || ' ' || coalesce(with_check, '') as s) x
   where schemaname = 'public'
     and (length(x.s) - length(replace(x.s, 'auth.uid()', ''))) / 10
       <> (length(x.s) - length(replace(x.s, 'SELECT auth.uid()', ''))) / 17 $$,
  'docs/learnings.md: every policy predicate wraps auth.uid() in a scalar subquery, never calls it bare');

select is_empty($$ select t.tbl from tests_tmp.tests_class3 t
                    join pg_policies p
                      on p.schemaname = 'public' and p.tablename = t.tbl
                     and p.permissive = 'PERMISSIVE'
                     and p.cmd in ('INSERT','UPDATE','DELETE','ALL') $$,
                '§5 Rule 4: no class-3 table has a write policy for authenticated');

select is_empty($$ select t.tbl || ':' || pv.priv from tests_tmp.tests_class3 t
                    cross join (values ('INSERT'),('UPDATE'),('DELETE')) as pv(priv)
                   where has_table_privilege('authenticated', 'public.' || quote_ident(t.tbl), pv.priv) $$,
                '§10: authenticated holds no INSERT/UPDATE/DELETE privilege on any class-3 table');

select is_empty($$ select tablename from pg_tables where schemaname = 'public'
                    and (has_table_privilege('anon', 'public.' || quote_ident(tablename), 'SELECT')
                      or has_table_privilege('anon', 'public.' || quote_ident(tablename), 'INSERT')
                      or has_table_privilege('anon', 'public.' || quote_ident(tablename), 'UPDATE')
                      or has_table_privilege('anon', 'public.' || quote_ident(tablename), 'DELETE')) $$,
                '§10: anon holds no table privilege at all in public — the second layer under RLS');


-- =============================================================================
-- PART 2 — The policy inventory
--
-- §12 item 5. The suite must fail when a policy is REMOVED and, more importantly,
-- when one is ADDED — adding a permissive policy can only ever widen access, and
-- that is the direction that leaks. set_eq rather than a bare count, so a failure
-- says which policy appeared or vanished instead of just "179 <> 180".
--
-- Changing this list means changing §8's matrix in docs/authorization-model.md in
-- the same PR. That is the whole mechanism.
-- =============================================================================

select set_eq(
  $$ select tablename || '.' || policyname from pg_policies
      where schemaname = 'public' and permissive = 'PERMISSIVE' $$,
  $$ values
    ('city.city_read_all'),
    ('dish_category.dish_category_read_all'),
    ('allergen.allergen_read_all'),
    ('dish_category.dish_category_insert_backoffice'),
    ('dish_category.dish_category_update_backoffice'),
    ('allergen.allergen_insert_backoffice'),
    ('allergen.allergen_update_backoffice'),
    ('reason_code.reason_code_read_customer'),
    ('reason_code.reason_code_read_backoffice'),
    ('asset.asset_read_images'),
    ('asset.asset_read_invoice_pdf'),
    ('asset.asset_read_report_pdf'),
    ('asset.asset_read_import_file'),
    ('asset.asset_insert_images'),
    ('asset.asset_update_images'),
    ('app_user.app_user_read_self'),
    ('app_user.app_user_read_admin'),
    ('app_user.app_user_update_self'),
    ('recipient.recipient_read_guardian'),
    ('recipient.recipient_insert_guardian'),
    ('recipient.recipient_update_guardian'),
    ('recipient.recipient_read_fulfilment'),
    ('recipient.recipient_read_admin'),
    ('guardian_link.guardian_link_read_self'),
    ('guardian_link.guardian_link_read_co_guardian'),
    ('guardian_link.guardian_link_insert_manager'),
    ('guardian_link.guardian_link_update_manager'),
    ('guardian_link.guardian_link_read_admin'),
    ('recipient_allergen.recipient_allergen_read_guardian'),
    ('recipient_allergen.recipient_allergen_write_guardian'),
    ('recipient_allergen.recipient_allergen_update_guardian'),
    ('recipient_allergen.recipient_allergen_delete_guardian'),
    ('recipient_allergen.recipient_allergen_read_fulfilment'),
    ('school.school_read_picker'),
    ('school.school_read_backoffice'),
    ('school.school_update_backoffice'),
    ('kitchen.kitchen_read_backoffice'),
    ('kitchen.kitchen_update_backoffice'),
    ('school_class.school_class_read_all'),
    ('break_time.break_time_read_all'),
    ('break_time_class.break_time_class_read_all'),
    ('school_class.school_class_read_backoffice'),
    ('break_time.break_time_read_backoffice'),
    ('school_class.school_class_insert_backoffice'),
    ('school_class.school_class_update_backoffice'),
    ('break_time.break_time_insert_backoffice'),
    ('break_time.break_time_update_backoffice'),
    ('break_time_class.break_time_class_insert_backoffice'),
    ('break_time_class.break_time_class_delete_backoffice'),
    ('menu.menu_read_customer'),
    ('menu_item.menu_item_read_customer'),
    ('dish.dish_read_customer'),
    ('dish_allergen.dish_allergen_read_customer'),
    ('menu_assignment.menu_assignment_read_customer'),
    ('menu_item_price_override.menu_item_price_override_read_customer'),
    ('school_menu_version.school_menu_version_read_customer'),
    ('menu.menu_read_backoffice'),
    ('menu.menu_write_backoffice'),
    ('menu.menu_update_backoffice'),
    ('dish.dish_read_backoffice'),
    ('dish.dish_write_backoffice'),
    ('dish.dish_update_backoffice'),
    ('menu_item.menu_item_read_backoffice'),
    ('menu_item.menu_item_insert_backoffice'),
    ('menu_item.menu_item_update_backoffice'),
    ('dish_allergen.dish_allergen_read_backoffice'),
    ('dish_allergen.dish_allergen_insert_backoffice'),
    ('dish_allergen.dish_allergen_update_backoffice'),
    ('dish_allergen.dish_allergen_delete_backoffice'),
    ('menu_assignment.menu_assignment_read_backoffice'),
    ('menu_assignment.menu_assignment_write_backoffice'),
    ('menu_assignment.menu_assignment_update_backoffice'),
    ('menu_item_price_override.menu_item_price_override_read_backoffice'),
    ('menu_item_price_override.menu_item_price_override_write_backoffice'),
    ('menu_item_price_override.menu_item_price_override_update_backoffice'),
    ('menu_item_capacity.menu_item_capacity_read_backoffice'),
    ('school_menu_version.school_menu_version_read_backoffice'),
    ('order_group.order_group_read_customer'),
    ('order_group.order_group_read_backoffice'),
    ('order.order_read_customer'),
    ('order.order_read_backoffice'),
    ('order_line.order_line_read_customer'),
    ('order_line.order_line_read_backoffice'),
    ('order_event.order_event_read_backoffice'),
    ('platform_config.platform_config_read'),
    ('kitchen_config.kitchen_config_read'),
    ('school_config.school_config_read'),
    ('config_change_log.config_change_log_read'),
    ('payment.payment_read_customer'),
    ('payment.payment_read_backoffice'),
    ('refund.refund_read_customer'),
    ('refund.refund_read_backoffice'),
    ('refund_line.refund_line_read_customer'),
    ('refund_line.refund_line_read_backoffice'),
    ('invoice.invoice_read_customer'),
    ('invoice.invoice_read_admin'),
    ('invoice_line.invoice_line_read_customer'),
    ('invoice_line.invoice_line_read_admin'),
    ('wallet_balance.wallet_balance_read_self'),
    ('wallet_balance.wallet_balance_read_admin'),
    ('ledger_account.ledger_account_read_admin'),
    ('ledger_transaction.ledger_transaction_read_admin'),
    ('ledger_entry.ledger_entry_read_admin'),
    ('payout.payout_read_admin'),
    ('payout.payout_read_school'),
    ('payout_line.payout_line_read_admin'),
    ('payment_webhook_event.payment_webhook_event_read_admin'),
    ('permission_grant.permission_grant_read_self'),
    ('permission_grant.permission_grant_read_admin'),
    ('permission.permission_read_admin'),
    ('role_template.role_template_read_admin'),
    ('role_template_permission.role_template_permission_read_admin'),
    ('policy_document.policy_document_read_all'),
    ('policy_version.policy_version_read_published'),
    ('policy_version.policy_version_read_admin'),
    ('consent_purpose.consent_purpose_read_all'),
    ('user_policy_acceptance.user_policy_acceptance_read_self'),
    ('user_policy_acceptance.user_policy_acceptance_insert_self'),
    ('user_policy_acceptance.user_policy_acceptance_read_admin'),
    ('consent_record.consent_record_read_self'),
    ('consent_record.consent_record_insert_self'),
    ('consent_record.consent_record_read_admin'),
    ('data_subject_request.dsr_read_self'),
    ('data_subject_request.dsr_insert_self'),
    ('data_subject_request.dsr_read_admin'),
    ('data_subject_request.dsr_update_admin'),
    ('retention_policy.retention_policy_read_admin'),
    ('purge_run.purge_run_read_admin'),
    ('device_token.device_token_read_self'),
    ('device_token.device_token_insert_self'),
    ('device_token.device_token_update_self'),
    ('device_token.device_token_delete_self'),
    ('notification_preference.notification_preference_read_self'),
    ('notification_preference.notification_preference_insert_self'),
    ('notification_preference.notification_preference_update_self'),
    ('notification_preference.notification_preference_delete_self'),
    ('notification_delivery.notification_delivery_read_self'),
    ('notification_delivery.notification_delivery_read_admin'),
    ('school_report.school_report_read_backoffice'),
    ('audit_log.audit_log_read_admin')
  $$,
  '§12 item 5: the set of permissive policies in public is EXACTLY the 140 in §7 of the authorization model');

-- §5 Rule 5. Restrictive, so it ANDs with everything else and cannot be defeated by
-- adding a permissive policy later. This is what makes "account deletion stops
-- access immediately" (D15) true rather than aspirational.
select set_eq(
  $$ select tablename from pg_policies
      where schemaname = 'public' and permissive = 'RESTRICTIVE' $$,
  $$ values
    ('city'), ('app_user'), ('asset'), ('dish_category'), ('allergen'), ('reason_code'),
    ('school'), ('school_class'), ('break_time'), ('break_time_class'),
    ('recipient'), ('guardian_link'), ('recipient_allergen'),
    ('dish'), ('dish_allergen'), ('menu'), ('menu_item'), ('menu_assignment'),
    ('menu_item_price_override'), ('school_menu_version'),
    ('order_group'), ('order'), ('order_line'),
    ('payment'), ('refund'), ('refund_line'), ('invoice'), ('invoice_line'), ('wallet_balance'),
    ('policy_document'), ('policy_version'), ('consent_purpose'),
    ('user_policy_acceptance'), ('consent_record'), ('data_subject_request'),
    ('device_token'), ('notification_preference'), ('notification_delivery'),
    ('permission_grant')
  $$,
  '§5 Rule 5: deny_dead_accounts is restrictive-applied to exactly the 39 tables carrying a customer-plane policy');

select is_empty($$ select tablename || '.' || policyname from pg_policies
                    where schemaname = 'public' and permissive = 'RESTRICTIVE'
                      and policyname <> 'deny_dead_accounts' $$,
                '§5 Rule 5: deny_dead_accounts is the only restrictive policy in the schema');

select is((select count(*)::int from pg_policies where schemaname = 'public'), 179,
          '§12 item 5: 179 policies in public — 140 permissive + 39 restrictive');

-- Catches a table added to the schema without being classified in §8 at all.
select set_eq(
  $$ select tablename from pg_tables where schemaname = 'public'
      and not exists (select 1 from pg_depend d
                       where d.objid = to_regclass('public.' || quote_ident(tablename))
                         and d.deptype = 'e') $$,
  $$ values
    ('allergen'),('app_user'),('asset'),('audit_log'),('break_time'),('break_time_class'),
    ('city'),('config_change_log'),('consent_purpose'),('consent_record'),
    ('data_subject_request'),('device_token'),('dish'),('dish_allergen'),('dish_category'),
    ('guardian_link'),('idempotency_key'),('invoice'),('invoice_line'),('invoice_sequence'),
    ('kitchen'),('kitchen_config'),('ledger_account'),('ledger_entry'),('ledger_transaction'),
    ('menu'),('menu_assignment'),('menu_item'),('menu_item_capacity'),('menu_item_price_override'),
    ('notification_delivery'),('notification_preference'),('order'),('order_event'),
    ('order_group'),('order_line'),('payment'),('payment_webhook_event'),('payout'),('payout_line'),
    ('permission'),('permission_grant'),('platform_config'),('policy_document'),('policy_version'),
    ('purge_run'),('reason_code'),('recipient'),('recipient_allergen'),('refund'),('refund_line'),
    ('retention_policy'),('role_template'),('role_template_permission'),('school'),('school_class'),
    ('school_config'),('school_menu_version'),('school_report'),('user_policy_acceptance'),
    ('wallet_balance')
  $$,
  '§8: public contains exactly the 61 tables the matrix classifies — a new table must be added to the matrix');


-- =============================================================================
-- PART 3 — anon (§8's most important column, and §9 items 1-2)
--
-- Every cell in the anonymous column of §8 is a dash, with no exceptions. That is
-- the single most important property in the model, and it is asserted mechanically
-- here rather than by reading.
--
-- The counts are captured as anon and asserted afterwards as the session role,
-- because §10 revokes anon's privileges on everything in public — including,
-- potentially, the pgTAP functions themselves.
-- =============================================================================

do $$ begin perform set_config('request.jwt.claims', '', true); end $$;
set local role anon;
insert into tests_seen select 'anon', tbl from tests_visible_counts('public')    where n > 0;
insert into tests_seen select 'anon', tbl from tests_visible_counts('migration') where n > 0;
reset role;

select is_empty($$ select tbl from tests_seen where persona = 'anon' $$,
                '§9 items 1-2: anon selects ZERO rows from every table in public and migration — including "order", recipient, recipient_allergen, app_user, payment and invoice');


-- =============================================================================
-- PART 4 — The matrix (§8), one persona at a time
-- =============================================================================

-- ---- Customer A -------------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000001","role":"authenticated"}', true); end $$;
set local role authenticated;
insert into tests_seen select 'custA', tbl from tests_visible_counts('public')    where n > 0;
insert into tests_seen select 'custA', tbl from tests_visible_counts('migration') where n > 0;
reset role;

select set_eq(
  $$ select tbl from tests_seen where persona = 'custA' $$,
  $$ values
    ('allergen'),('app_user'),('asset'),('break_time'),('break_time_class'),('city'),
    ('consent_purpose'),('consent_record'),('data_subject_request'),('device_token'),
    ('dish'),('dish_allergen'),('dish_category'),('guardian_link'),('invoice'),('invoice_line'),
    ('menu'),('menu_assignment'),('menu_item'),('menu_item_price_override'),
    ('notification_delivery'),('notification_preference'),('order'),('order_group'),('order_line'),
    ('payment'),('policy_document'),('policy_version'),('reason_code'),('recipient'),
    ('recipient_allergen'),('refund'),('refund_line'),('school'),('school_class'),
    ('school_menu_version'),('user_policy_acceptance'),('wallet_balance')
  $$,
  '§8 Customer column: a customer reaches exactly these 38 tables — notably NOT kitchen, order_event ([AZ-06]), any config table, any ledger table, payout, permission or audit_log');

-- ---- KitchenOperator @ kitchenA ---------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000006","role":"authenticated"}', true); end $$;
set local role authenticated;
insert into tests_seen select 'kitchOpA', tbl from tests_visible_counts('public')    where n > 0;
insert into tests_seen select 'kitchOpA', tbl from tests_visible_counts('migration') where n > 0;
reset role;

select set_eq(
  $$ select tbl from tests_seen where persona = 'kitchOpA' $$,
  $$ values
    ('allergen'),('app_user'),('asset'),('break_time'),('break_time_class'),('city'),
    ('consent_purpose'),('dish'),('dish_allergen'),('dish_category'),('menu'),('menu_assignment'),
    ('menu_item'),('menu_item_capacity'),('menu_item_price_override'),('order'),('order_event'),
    ('order_group'),('order_line'),('permission_grant'),('policy_document'),('policy_version'),
    ('reason_code'),('recipient'),('recipient_allergen'),('school'),('school_class'),
    ('school_menu_version'),('school_report')
  $$,
  '§8 KitchenOperator column: 29 tables. app_user and permission_grant are the operator''s OWN rows (§2.2); kitchen is absent because the seed template holds no kitchen.view (§7.3 finding)');

-- §9 items 16-17, named individually so a failure says which promise broke. Note the
-- role is re-entered: the set_eq above deliberately runs as the session role over the
-- captured counts, and an is_empty run outside a persona would pass as postgres for
-- entirely the wrong reason.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000006","role":"authenticated"}', true); end $$;
set local role authenticated;
select is_empty($$ select 1 from payment $$,             '§9 item 16: a KitchenOperator sees no payment — they hold neither orders.view_financials nor orders.refund. This is D3''s promise and the only thing that makes it real');
select is_empty($$ select 1 from refund $$,              '§9 item 16: a KitchenOperator sees no refund');
select is_empty($$ select 1 from invoice $$,             '§9 item 16: a KitchenOperator sees no invoice');
select is_empty($$ select 1 from ledger_entry $$,        '§9 item 16: a KitchenOperator sees no ledger_entry');
select is_empty($$ select 1 from payout $$,              '§9 item 16: a KitchenOperator sees no payout');
select is_empty($$ select 1 from app_user
                    where id <> 'a0000000-7e57-0000-0000-000000000006' $$,
                '§9 item 17 / §13.3 rule 4: a KitchenOperator sees NO app_user row but their own. The E09-07 last-4-digits search must be an Edge Function returning orders, never a table read');
select is_empty($$ select 1 from guardian_link $$,       '§7.2: a KitchenOperator has no business knowing who a child''s parents are');
select is_empty($$ select 1 from kitchen $$,
                '§7.3 finding: the seeded kitchen_operator template holds no kitchen.view, so an operator cannot read their OWN kitchen row. Workable but accidental — raised for E10-02. If this starts failing, somebody fixed the seed, which is fine: update the matrix');
reset role;

-- ---- SchoolViewer @ schoolA1 ------------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000008","role":"authenticated"}', true); end $$;
set local role authenticated;
insert into tests_seen select 'schoolViewer', tbl from tests_visible_counts('public')    where n > 0;
insert into tests_seen select 'schoolViewer', tbl from tests_visible_counts('migration') where n > 0;
reset role;

select set_eq(
  $$ select tbl from tests_seen where persona = 'schoolViewer' $$,
  $$ values
    ('allergen'),('app_user'),('asset'),('break_time'),('break_time_class'),('city'),
    ('consent_purpose'),('dish_category'),('menu_assignment'),('payout'),('permission_grant'),
    ('policy_document'),('policy_version'),('reason_code'),('school'),('school_class'),
    ('school_menu_version'),('school_report')
  $$,
  '§8 SchoolViewer column: 18 tables. §13.3 rule 5 — none of tier S, P or A');

-- ---- PlatformAdmin ----------------------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000009","role":"authenticated"}', true); end $$;
set local role authenticated;
insert into tests_seen select 'platformAdmin', tbl from tests_visible_counts('public')    where n > 0;
insert into tests_seen select 'platformAdmin', tbl from tests_visible_counts('migration') where n > 0;
reset role;

select set_eq(
  $$ select tbl from tests_seen where persona = 'platformAdmin' $$,
  $$ values
    ('allergen'),('app_user'),('asset'),('audit_log'),('break_time'),('break_time_class'),
    ('city'),('config_change_log'),('consent_purpose'),('consent_record'),
    ('data_subject_request'),('dish'),('dish_allergen'),('dish_category'),
    ('guardian_link'),('invoice'),('invoice_line'),
    ('kitchen'),('kitchen_config'),('ledger_account'),('ledger_entry'),('ledger_transaction'),
    ('menu'),('menu_assignment'),('menu_item'),('menu_item_capacity'),('menu_item_price_override'),
    ('notification_delivery'),('order'),('order_event'),
    ('order_group'),('order_line'),('payment'),('payment_webhook_event'),('payout'),('payout_line'),
    ('permission'),('permission_grant'),('platform_config'),('policy_document'),('policy_version'),
    ('purge_run'),('reason_code'),('recipient'),('refund'),('refund_line'),
    ('retention_policy'),('role_template'),('role_template_permission'),('school'),('school_class'),
    ('school_config'),('school_menu_version'),('school_report'),('user_policy_acceptance'),
    ('wallet_balance')
  $$,
  '§8 PlatformAdmin column: 56 tables — everything EXCEPT recipient_allergen, invoice_sequence, idempotency_key, and other users'' device_token / notification_preference');


-- =============================================================================
-- PART 5 — Customer isolation (§9 items 5-11) and the deliberate PlatformAdmin gaps
-- =============================================================================

do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000009","role":"authenticated"}', true); end $$;
set local role authenticated;

-- §7.2. users.view does not open it, consent.view does not open it. Reading a
-- child's health record requires service_role through a named, audited Edge
-- Function. If this ever passes, someone widened users.view.
select is_empty($$ select 1 from recipient_allergen $$,
                '§7.2: a PlatformAdmin holding EVERY permission still cannot read recipient_allergen — a child''s health data needs a named, audited Edge Function');
select is_empty($$ select 1 from device_token $$,
                '§8 row 57: a PlatformAdmin cannot read another user''s device_token');
select is_empty($$ select 1 from notification_preference $$,
                '§8 row 58: a PlatformAdmin cannot read another user''s notification_preference');
select is_empty($$ select 1 from invoice_sequence $$,
                '§7.7: invoice_sequence has no policy at all — its only correct reader is the transaction allocating a number (D14)');
select is_empty($$ select 1 from idempotency_key $$,
                '§7.7: idempotency_key has no policy at all — it holds replayed response bodies that are nobody else''s business');
reset role;

-- ---- The co-guardian: can_order but not can_manage ---------------------------
-- Asserted BEFORE Customer A's write block, which revokes this very link.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000003","role":"authenticated"}', true); end $$;
set local role authenticated;
select isnt_empty($$ select 1 from recipient where id = 'd1000000-7e57-0000-0000-000000000001' $$,
                  '§4.2: can_manage = false still reaches the recipient (auth_can_reach_recipient)');
-- Note the shape of this one. A failing USING clause does NOT raise: it filters the
-- row out of the statement, so the UPDATE succeeds and touches nothing. Asserting
-- throws_ok here would be asserting the wrong thing and would fail.
select lives_ok($$ update recipient set first_name = 'Renamed' where id = 'd1000000-7e57-0000-0000-000000000001' $$,
                '§4.2: an UPDATE by a can_manage = false guardian does not raise — RLS USING filters the row out');
select is((select first_name from recipient where id = 'd1000000-7e57-0000-0000-000000000001'), 'Aarav',
          '§4.2: …and the row is unchanged. auth_can_manage_recipient is a different function from auth_can_reach_recipient for exactly this reason');
select is_empty($$ select 1 from recipient where id = 'd1000000-7e57-0000-0000-000000000007' $$,
                '§4.2: …and a co-guardian reaches only the child they are linked to, not the other guardian''s other children');
reset role;

-- ---- Customer A cannot see Customer B -----------------------------------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000001","role":"authenticated"}', true); end $$;
set local role authenticated;

select is_empty($$ select 1 from order_group where customer_user_id <> 'a0000000-7e57-0000-0000-000000000001' $$,
                '§9 item 5: Customer A cannot select Customer B''s order_group');
select is_empty($$ select 1 from "order" where customer_user_id <> 'a0000000-7e57-0000-0000-000000000001' $$,
                '§9 item 5: Customer A cannot select Customer B''s order — the legacy Order was world-readable');
select is_empty($$ select 1 from order_line where order_id = 'e2000000-7e57-0000-0000-000000000002' $$,
                '§9 item 5: Customer A cannot select Customer B''s order_line');
select is_empty($$ select 1 from payment where order_group_id <> 'e1000000-7e57-0000-0000-000000000001' $$,
                '§9 item 5: Customer A cannot select Customer B''s payment');
select is_empty($$ select 1 from refund where order_group_id <> 'e1000000-7e57-0000-0000-000000000001' $$,
                '§9 item 5: Customer A cannot select Customer B''s refund');
select is_empty($$ select 1 from invoice where order_group_id <> 'e1000000-7e57-0000-0000-000000000001' $$,
                '§9 item 5: Customer A cannot select Customer B''s invoice');
select is_empty($$ select 1 from refund_line where refund_id = 'e4000000-7e57-0000-0000-000000000002' $$,
                '§9 item 5: Customer A cannot select Customer B''s refund_line (auth_owns_refund resolves through the group)');
select is_empty($$ select 1 from invoice_line where invoice_id = 'e5000000-7e57-0000-0000-000000000002' $$,
                '§9 item 5: Customer A cannot select Customer B''s invoice_line (auth_owns_invoice resolves through the group)');
select is_empty($$ select 1 from wallet_balance where user_id <> 'a0000000-7e57-0000-0000-000000000001' $$,
                '§9 item 5: Customer A cannot select Customer B''s wallet_balance');
select is_empty($$ select 1 from device_token where user_id <> 'a0000000-7e57-0000-0000-000000000001' $$,
                '§9 item 5: Customer A cannot select Customer B''s device_token');
select is_empty($$ select 1 from consent_record where user_id <> 'a0000000-7e57-0000-0000-000000000001' $$,
                '§9 item 5: Customer A cannot select Customer B''s consent_record');
select is_empty($$ select 1 from app_user where id <> 'a0000000-7e57-0000-0000-000000000001' $$,
                '§9 item 5: Customer A cannot select any other app_user row');

-- D10. This is the assertion the whole guardian_link design exists for.
select is_empty($$ select 1 from recipient where id = 'd1000000-7e57-0000-0000-000000000005' $$,
                '§9 item 6 / D10: Customer A cannot select a recipient they CREATED but have no guardian_link to — created_by_user_id authorizes nothing');
select is_empty($$ select 1 from recipient where id = 'd1000000-7e57-0000-0000-000000000002' $$,
                '§9 item 6: Customer A cannot select Customer B''s recipient');
select is_empty($$ select 1 from recipient where id = 'd1000000-7e57-0000-0000-000000000006' $$,
                '§9 item 7: a REVOKED guardian_link grants nothing — the recipient behind it is invisible');
select is_empty($$ select 1 from recipient_allergen
                    where recipient_id not in ('d1000000-7e57-0000-0000-000000000001',
                                               'd1000000-7e57-0000-0000-000000000007') $$,
                '§9 item 7: a revoked or absent link grants nothing on tier-S data either — Customer A sees the allergens of their own two children and nobody else''s');

select isnt_empty($$ select 1 from recipient where id = 'd1000000-7e57-0000-0000-000000000001' $$,
                  '§8 row 12: Customer A DOES see the recipient they hold a live guardian_link to');
select isnt_empty($$ select 1 from recipient where id = 'd1000000-7e57-0000-0000-000000000007' $$,
                  '§8 row 12: …including one at a second school (D2 — school lives on the recipient)');

-- [AZ-05], written as yes and awaiting Andy.
select isnt_empty($$ select 1 from guardian_link
                      where recipient_id = 'd1000000-7e57-0000-0000-000000000001'
                        and user_id = 'a0000000-7e57-0000-0000-000000000003' $$,
                  '[AZ-05]: a guardian sees the OTHER guardians on their child (the link row)…');
select is_empty($$ select 1 from app_user where id = 'a0000000-7e57-0000-0000-000000000003' $$,
                '[AZ-05]: …but not that guardian''s name, phone or email — app_user is not opened');

-- §9 item 9. The DPDP-relevant property, and a database constraint rather than an
-- Edge Function convention.
select throws_ok(
  $$ insert into consent_record (user_id, subject_type, subject_id, purpose_code, action, capture_method)
     values ('a0000000-7e57-0000-0000-000000000001', 'recipient', 'd1000000-7e57-0000-0000-000000000002',
             'child_data', 'granted', 'in_app_checkbox') $$,
  '42501', null,
  '§9 item 9: Customer A cannot record a consent_record ABOUT Customer B''s child');
select lives_ok(
  $$ insert into consent_record (user_id, subject_type, subject_id, purpose_code, action, capture_method)
     values ('a0000000-7e57-0000-0000-000000000001', 'recipient', 'd1000000-7e57-0000-0000-000000000001',
             'child_data', 'granted', 'in_app_checkbox') $$,
  '§7.9: …and can record one about their own child');

-- §9 item 10 — the §6.1 guard triggers. RLS cannot protect a column; these can.
select throws_ok($$ update app_user set is_disabled = true where id = 'a0000000-7e57-0000-0000-000000000001' $$,
                 '42501', null, '§9 item 10 / §6.1: a customer cannot set is_disabled on their own app_user row');
select throws_ok($$ update app_user set deleted_at = now() where id = 'a0000000-7e57-0000-0000-000000000001' $$,
                 '42501', null, '§9 item 10 / §6.1: a customer cannot set deleted_at on their own app_user row');
select throws_ok($$ update app_user set phone_e164 = '+919999999999' where id = 'a0000000-7e57-0000-0000-000000000001' $$,
                 '42501', null, '§6.1: a customer cannot rewrite phone_e164 without re-verifying by OTP');
select lives_ok($$ update app_user set first_name = 'Asha Rani' where id = 'a0000000-7e57-0000-0000-000000000001' $$,
                '§6.1: …but the columns that ARE theirs to set remain editable');

-- §9 item 11. Without this a guardian holding can_manage could re-point a link at
-- somebody else's child, which is D10's single answer turned back into two.
select throws_ok($$ update guardian_link set recipient_id = 'd1000000-7e57-0000-0000-000000000002'
                     where id = 'd1a00000-7e57-0000-0000-000000000001' $$,
                 '42501', null, '§9 item 11 / §6.1: a guardian cannot re-point a guardian_link at another child');
select throws_ok($$ update guardian_link set user_id = 'a0000000-7e57-0000-0000-000000000002'
                     where id = 'd1a00000-7e57-0000-0000-000000000001' $$,
                 '42501', null, '§6.1: …nor at another user');
select lives_ok($$ update guardian_link set revoked_at = now()
                    where id = 'd1a00000-7e57-0000-0000-000000000002' $$,
                '§7.2: …but a manager CAN revoke a co-guardian''s link, which is the whole point of [AZ-05]');

-- §6.1 on recipient, and the customer-plane write surface that IS open (class 1).
select throws_ok($$ update recipient set deleted_at = now() where id = 'd1000000-7e57-0000-0000-000000000001' $$,
                 '42501', null, '§6.1: a guardian cannot soft-delete a recipient directly — erasure is an Edge Function (D15)');
select lives_ok($$ update recipient set allergy_note = 'severe peanut allergy'
                    where id = 'd1000000-7e57-0000-0000-000000000001' $$,
                '§7.2: a guardian with can_manage CAN edit their own child''s details');
-- Deletes recipA2's row, not recipA's: the kitchen fulfilment assertions in Part 7
-- depend on recipA's allergen surviving, and a test that quietly destroys another
-- test's fixture is a test that reports the wrong reason for a failure.
select lives_ok($$ delete from recipient_allergen
                    where recipient_id = 'd1000000-7e57-0000-0000-000000000007' $$,
                '§7.2 / §13.4: DELETE is permitted on recipient_allergen and nowhere else in the customer plane — a child''s health data is deleted outright on erasure, because there is no statutory reason to retain it');

reset role;

-- ---- §9 item 8: a disabled account, and a deleted one, see nothing anywhere ---
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000004","role":"authenticated"}', true); end $$;
set local role authenticated;
insert into tests_seen select 'custDisabled', tbl from tests_visible_counts('public') where n > 0;
reset role;

select is_empty($$ select tbl from tests_seen where persona = 'custDisabled' $$,
                '§9 item 8 / §5 Rule 5: a DISABLED account sees nothing in any table, despite owning orders and holding live, unexpired grants');

do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000005","role":"authenticated"}', true); end $$;
set local role authenticated;
insert into tests_seen select 'custDeleted', tbl from tests_visible_counts('public') where n > 0;
reset role;

select is_empty($$ select tbl from tests_seen where persona = 'custDeleted' $$,
                '§9 item 8 / D15: a SOFT-DELETED account sees nothing in any table — deletion stops access immediately, not eventually');


-- =============================================================================
-- PART 6 — The write wall (§9 items 12-14)
--
-- Class 3 is where default-deny does the work: there is no policy to get wrong, and
-- the test is "authenticated cannot insert, ever".
-- =============================================================================

do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000001","role":"authenticated"}', true); end $$;
set local role authenticated;
insert into tests_seen
select 'class3-custA', t.tbl from tests_tmp.tests_class3 t
 where tests_tmp.tests_insert_sqlstate(t.tbl) <> '42501';
reset role;

select is_empty($$ select tbl from tests_seen where persona = 'class3-custA' $$,
                '§9 item 12: a customer cannot INSERT into ANY class-3 table. An INSERT policy on "order" would let them supply total_paise = 0');

-- §9 item 13 is the one people are surprised by. Platform admin is not a database
-- superuser; it is a set of grants that open reads and authorize Edge Functions.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000009","role":"authenticated"}', true); end $$;
set local role authenticated;
insert into tests_seen
select 'class3-admin', t.tbl from tests_tmp.tests_class3 t
 where tests_tmp.tests_insert_sqlstate(t.tbl) <> '42501';
reset role;

select is_empty($$ select tbl from tests_seen where persona = 'class3-admin' $$,
                '§9 item 13: a PlatformAdmin holding EVERY permission also cannot INSERT into any class-3 table');

-- The specific tables §9 item 12 names, spelled out so a failure is unambiguous.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000001","role":"authenticated"}', true); end $$;
set local role authenticated;
select is(tests_insert_sqlstate('order'),            '42501', '§9 item 12: no INSERT into "order"');
select is(tests_insert_sqlstate('order_group'),      '42501', '§9 item 12: no INSERT into order_group');
select is(tests_insert_sqlstate('order_line'),       '42501', '§9 item 12: no INSERT into order_line');
select is(tests_insert_sqlstate('payment'),          '42501', '§9 item 12: no INSERT into payment');
select is(tests_insert_sqlstate('refund'),           '42501', '§9 item 12: no INSERT into refund');
select is(tests_insert_sqlstate('invoice'),          '42501', '§9 item 12: no INSERT into invoice');
select is(tests_insert_sqlstate('ledger_entry'),     '42501', '§9 item 12: no INSERT into ledger_entry');
select is(tests_insert_sqlstate('wallet_balance'),   '42501', '§9 item 12: no INSERT into wallet_balance');
select is(tests_insert_sqlstate('permission_grant'), '42501', '§9 item 12: no INSERT into permission_grant — self-granting orders.refund must be impossible, not merely guarded');

-- Two tables that are NOT in §10's revoke list and are therefore stopped by RLS
-- alone. Worth asserting separately: they are the case where the second layer is
-- absent by design.
select throws_ok($$ insert into city (code, name, state_name, gst_state_code)
                    values ('x', 'X', 'X', '01') $$,
                 '42501', null, '§7.1: city is class 3 — stopped by RLS, since §10 does not revoke its write privileges');
select throws_ok($$ insert into kitchen (code, name, city_id)
                    values ('x', 'X', 'c1000000-7e57-0000-0000-000000000001') $$,
                 '42501', null, '§7.3: kitchen creation is class 3 too');
reset role;

-- §9 item 14 — the append-only guarantee, which is a trigger and not a grant, and
-- therefore holds even for the role that bypasses RLS.
set local role service_role;
select throws_ok($$ update order_event set note = 'rewritten' where order_id = 'e2000000-7e57-0000-0000-000000000001' $$,
                 '23001', null, '§9 item 14: order_event is append-only even for service_role');
select throws_ok($$ delete from order_event where order_id = 'e2000000-7e57-0000-0000-000000000001' $$,
                 '23001', null, '§9 item 14: …and cannot be deleted either');
select throws_ok($$ update ledger_entry set amount_paise = 1 where transaction_id = 'e7000000-7e57-0000-0000-000000000001' $$,
                 '23001', null, '§9 item 14: ledger_entry is append-only even for service_role — corrections are reversals');
select throws_ok($$ update ledger_transaction set memo = 'x' where id = 'e7000000-7e57-0000-0000-000000000001' $$,
                 '23001', null, '§9 item 14: ledger_transaction is append-only even for service_role');
select throws_ok($$ update consent_record set action = 'withdrawn' where user_id = 'a0000000-7e57-0000-0000-000000000001' $$,
                 '23001', null, '§9 item 14: consent_record is append-only even for service_role — a withdrawal is a new row');
select throws_ok($$ update user_policy_acceptance set source = 'web' where user_id = 'a0000000-7e57-0000-0000-000000000001' $$,
                 '23001', null, '§9 item 14: user_policy_acceptance is append-only even for service_role');
select throws_ok($$ update audit_log set action = 'x' where actor_type = 'admin' $$,
                 '23001', null, '§9 item 14: audit_log is append-only even for service_role');
reset role;


-- =============================================================================
-- PART 7 — Back-office scope (§9 items 15-22)
-- =============================================================================

-- ---- §9 item 15: kitchen -> school widening, in both directions --------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000006","role":"authenticated"}', true); end $$;
set local role authenticated;
select isnt_empty($$ select 1 from "order" where school_id = 'c3000000-7e57-0000-0000-000000000001' $$,
                  '§9 item 15: kitchenA''s operator sees orders at schoolA1');
select isnt_empty($$ select 1 from "order" where school_id = 'c3000000-7e57-0000-0000-000000000002' $$,
                  '§9 item 15: …and at schoolA2, the other school kitchenA serves — that IS the kitchen->school widening (E09-10)');
select is_empty($$ select 1 from "order" where school_id = 'c3000000-7e57-0000-0000-000000000003' $$,
                  '§9 item 15: …and NO order at a school served by a different kitchen');
select isnt_empty($$ select 1 from recipient where id = 'd1000000-7e57-0000-0000-000000000001' $$,
                  '§5 Rule 8: kitchenA''s operator sees the child they are cooking for');
select is_empty($$ select 1 from recipient where id = 'd1000000-7e57-0000-0000-000000000005' $$,
                  '§5 Rule 8: …and NOT a child enrolled at the same school who has never ordered. Need-to-know beats scope on children''s data');
select isnt_empty($$ select 1 from recipient_allergen where recipient_id = 'd1000000-7e57-0000-0000-000000000001' $$,
                  '§7.2: …but does see that child''s allergens, because a kitchen must not send a peanut dish to an allergic child');
reset role;

do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000007","role":"authenticated"}', true); end $$;
set local role authenticated;
select isnt_empty($$ select 1 from "order" where school_id = 'c3000000-7e57-0000-0000-000000000003' $$,
                  '§9 item 15: kitchenB''s operator sees orders at schoolB1…');
select is_empty($$ select 1 from "order" where school_id in ('c3000000-7e57-0000-0000-000000000001','c3000000-7e57-0000-0000-000000000002') $$,
                  '§9 item 15: …and none of kitchenA''s. Asserting the reverse direction is how an inverted comparison gets caught');
select is_empty($$ select 1 from menu where kitchen_id = 'c2000000-7e57-0000-0000-000000000001' $$,
                '§7.4: kitchenB''s operator cannot read kitchenA''s menu');
reset role;

-- ---- §9 item 18-19: SchoolViewer -------------------------------------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000008","role":"authenticated"}', true); end $$;
set local role authenticated;
select isnt_empty($$ select 1 from school_report where school_id = 'c3000000-7e57-0000-0000-000000000001' $$,
                  '§9 item 18: a SchoolViewer sees their own school_report — aggregates only, and the absence of recipient_id is the control');
select is_empty($$ select 1 from school_report where school_id <> 'c3000000-7e57-0000-0000-000000000001' $$,
                '§9 item 18: …and no other school''s');
select is_empty($$ select 1 from "order" $$,             '§9 item 18: a SchoolViewer selects zero rows from "order"');
select is_empty($$ select 1 from order_line $$,          '§9 item 18: …zero from order_line');
select is_empty($$ select 1 from recipient $$,           '§9 item 18: …zero from recipient (tier P)');
select is_empty($$ select 1 from recipient_allergen $$,  '§9 item 18: …zero from recipient_allergen (tier S)');
select is_empty($$ select 1 from app_user
                    where id <> 'a0000000-7e57-0000-0000-000000000008' $$,
                '§9 item 18: …and no app_user row but their own (tier A)');
select is_empty($$ select 1 from payout_line $$,
                '§9 item 18 / [AZ-04]: …and zero from payout_line — a payout line names an order_id, which is order-level detail');
select isnt_empty($$ select 1 from payout where id = 'e8000000-7e57-0000-0000-000000000002' $$,
                  '[AZ-04] option (a): a school DOES see its confirmed payout, MDR deduction and notes included');
select is_empty($$ select 1 from payout where id = 'e8000000-7e57-0000-0000-000000000001' $$,
                '§9 item 19 / [AZ-04]: a school sees NO payout at status draft');
reset role;

-- ---- §9 item 20: expired and revoked grants authorize nothing ---------------
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-00000000000b","role":"authenticated"}', true); end $$;
set local role authenticated;
select is_empty($$ select 1 from "order" $$,
                '§9 item 20: a grant with expires_at in the past authorizes nothing');
reset role;

do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-00000000000c","role":"authenticated"}', true); end $$;
set local role authenticated;
select is_empty($$ select 1 from "order" $$,
                '§9 item 20: a grant with revoked_at set authorizes nothing');
-- Deliberate: permission_grant_read_self has no revoked_at filter. A former kitchen
-- operator can still see that the access they used to hold was revoked, and when.
-- Revoking is not the same as erasing the record of it (0001 §8: "revoked, never
-- deleted"), and hiding it would make the admin UI unable to show grant history.
select isnt_empty($$ select 1 from permission_grant
                      where user_id = 'a0000000-7e57-0000-0000-00000000000c' and revoked_at is not null $$,
                  '§7.8: a revoked grant remains VISIBLE to its own holder while authorizing nothing — grants are revoked, never deleted');
reset role;

-- ---- §9 items 21-22: widening is one-directional -----------------------------
-- Asserted through auth_has_permission directly, because the comparison being
-- inverted is exactly the bug that a row-level test would hide.
select ok(auth_has_permission('a0000000-7e57-0000-0000-00000000000d', 'orders.view', 'school', 'c3000000-7e57-0000-0000-000000000001'),
          '§9 item 21: a school-scoped grant satisfies a check at school scope');
select ok(not auth_has_permission('a0000000-7e57-0000-0000-00000000000d', 'orders.view', 'kitchen', 'c2000000-7e57-0000-0000-000000000001'),
          '§9 item 21: a school-scoped grant does NOT satisfy a check at kitchen scope — widening is one-directional');
select ok(not auth_has_permission('a0000000-7e57-0000-0000-00000000000d', 'orders.view', 'platform', null),
          '§9 item 21: …nor at platform scope');
select ok(auth_has_permission('a0000000-7e57-0000-0000-00000000000a', 'orders.view', 'school', 'c3000000-7e57-0000-0000-000000000001'),
          '§9 item 22: a city-scoped grant reaches a school in that city');
select ok(auth_has_permission('a0000000-7e57-0000-0000-00000000000a', 'orders.view', 'school', 'c3000000-7e57-0000-0000-000000000002'),
          '§9 item 22: …every school in that city');
select ok(auth_has_permission('a0000000-7e57-0000-0000-00000000000a', 'orders.view', 'kitchen', 'c2000000-7e57-0000-0000-000000000001'),
          '§9 item 22: …and every kitchen in that city');
select ok(not auth_has_permission('a0000000-7e57-0000-0000-00000000000a', 'orders.view', 'school', 'c3000000-7e57-0000-0000-000000000003'),
          '§9 item 22: …and NOTHING outside it. A Chandigarh report must never scan Mohali data (D9)');
select ok(not auth_has_permission('a0000000-7e57-0000-0000-00000000000a', 'orders.view', 'kitchen', 'c2000000-7e57-0000-0000-000000000002'),
          '§9 item 22: …no kitchen outside it either');
select ok(not auth_has_permission('a0000000-7e57-0000-0000-000000000004', 'orders.view', 'school', 'c3000000-7e57-0000-0000-000000000001'),
          '§9 item 8: a disabled account holds no permission, whatever its grants say');


-- =============================================================================
-- PART 8 — Referential and config (§9 items 23-26)
-- =============================================================================

-- §9 item 23. Without the biconditional in 0001, a school-scoped grant with a null
-- scope_id would silently mean "every school".
select throws_ok(
  $$ insert into permission_grant (user_id, permission_code, scope_type, scope_id, granted_by_user_id)
     values ('a0000000-7e57-0000-0000-00000000000d', 'orders.view', 'school', null,
             'a0000000-7e57-0000-0000-000000000009') $$,
  '23514', null,
  '§9 item 23: a school-scoped permission_grant with a null scope_id cannot be inserted — it would silently mean "every school"');

-- §9 items 25-26 — the silent-null trap that §7.6 exists to close.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000001","role":"authenticated"}', true); end $$;
set local role authenticated;

select isnt_empty($$ select 1 from effective_config_public('c3000000-7e57-0000-0000-000000000001') $$,
                  '§9 item 25: effective_config_public returns a row for a customer with a live recipient at that school');
select is((select cgst_rate_bps from effective_config_public('c3000000-7e57-0000-0000-000000000001')), 250,
          '§7.6 / M2: …and the statutory tax rate really is in it, because the cart has to show CGST 2.5% + SGST 2.5% rather than a single lump "5% tax"');
select is((select revenue_share_bps from resolve_effective_config('c3000000-7e57-0000-0000-000000000001')), null::integer,
          '§7.6 / M4: revenue_share_bps is reachable by NO customer path — it is not a column on effective_config_public at all, and the raw resolver returns null');
select is((select price_is_tax_inclusive from effective_config_public('c3000000-7e57-0000-0000-000000000001')), false,
          '[DM-14] / [DM-20] ANSWERED (SC2, migration 0003): prices are GST-EXCLUSIVE, and the customer-facing resolver surfaces it. This assertion previously required NULL — "nobody has said" — and is inverted rather than deleted because the flag decides what every stored price MEANS');

select is_empty($$ select 1 from platform_config $$,
                '§7.6: a customer cannot read platform_config directly — revenue_share_bps sits on the same rows as the cutoff (M4)');
select is_empty($$ select 1 from school_config $$,
                '§7.6: …nor school_config');

-- The tripwire. If someone "fixes" the config policies by opening them to customers,
-- this test tells them exactly what they broke.
select ok((select resolve_effective_config('c3000000-7e57-0000-0000-000000000001') is null),
          '§9 item 26 / docs/learnings.md: resolve_effective_config() returns a NULL ROW as authenticated — it is invoker-rights and inner-joins platform_config. Use effective_config_public()');
reset role;

-- A school in the picker but with no recipient of mine: the wrapper is gated on
-- reachability, not on being logged in.
do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000009","role":"authenticated"}', true); end $$;
set local role authenticated;
select isnt_empty($$ select 1 from effective_config_public('c3000000-7e57-0000-0000-000000000003') $$,
                  '§7.6: effective_config_public is reachable for any school in the picker (auth_school_is_public), which is what makes the add-a-child form fillable');
reset role;


-- =============================================================================
-- PART 9 — Helper functions, menu reachability, and the self-enforcing tripwires
--          ([AZ-02] orders.view_pii, and the §10 forbidden-write-grant tripwire)
-- =============================================================================

do $$ begin perform set_config('request.jwt.claims', '{"sub":"a0000000-7e57-0000-0000-000000000001","role":"authenticated"}', true); end $$;
set local role authenticated;

select ok(auth_is_live_user(),                                                                 '§4.1: auth_is_live_user is true for a live customer');
select ok(auth_can_reach_recipient('d1000000-7e57-0000-0000-000000000001'),                    '§4.2: auth_can_reach_recipient follows the live guardian_link');
select ok(not auth_can_reach_recipient('d1000000-7e57-0000-0000-000000000005'),                '§4.2 / D10: …and not created_by_user_id');
select ok(not auth_can_reach_recipient('d1000000-7e57-0000-0000-000000000006'),                '§4.2: …and not a revoked link');
select ok(auth_can_manage_recipient('d1000000-7e57-0000-0000-000000000001'),                   '§4.2: auth_can_manage_recipient honours can_manage');
select ok(auth_can_order_for_recipient('d1000000-7e57-0000-0000-000000000001'),                '§4.2: auth_can_order_for_recipient honours can_order — used by the checkout Edge Function, not by a policy');
select ok(auth_can_reach_school('c3000000-7e57-0000-0000-000000000001'),                       '§4.2: auth_can_reach_school is true where I have a live recipient');
select ok(not auth_can_reach_school('c3000000-7e57-0000-0000-000000000003'),                   '§4.2: …and false where I do not');
select ok(auth_school_is_public('c3000000-7e57-0000-0000-000000000003'),                       '§4.6: auth_school_is_public is true for any onboarded, active, non-offboarded school');
select ok(not auth_is_back_office(),                                                           '§4.3: a customer is not back office');
select ok(auth_customer_can_see_menu('d6000000-7e57-0000-0000-000000000001'),                  '§4.5: a customer sees the menu assigned to their school today');
select ok(not auth_customer_can_see_menu('d6000000-7e57-0000-0000-000000000002'),              '§4.5: …and not a menu assigned only to a school they cannot reach');
select ok(auth_customer_can_see_dish('d5000000-7e57-0000-0000-000000000001'),                  '§4.5: …and the dishes on it');
select ok(not auth_customer_can_see_dish('d5000000-7e57-0000-0000-000000000002'),              '§4.5: …and not the other kitchen''s dishes');
select ok(auth_owns_order('e2000000-7e57-0000-0000-000000000001'),                             '§4.4: auth_owns_order');
select ok(not auth_owns_order('e2000000-7e57-0000-0000-000000000002'),                         '§4.4: …and not somebody else''s');
select ok(auth_owns_group('e1000000-7e57-0000-0000-000000000001'),                             '§4.4: auth_owns_group');
select ok(auth_owns_refund('e4000000-7e57-0000-0000-000000000001'),                            '§4.6: auth_owns_refund');
select ok(auth_owns_invoice('e5000000-7e57-0000-0000-000000000001'),                           '§4.6: auth_owns_invoice');
select is(auth_break_time_school_id('c5000000-7e57-0000-0000-000000000001'),
          'c3000000-7e57-0000-0000-000000000001'::uuid,                                        '§7.3 (addition): auth_break_time_school_id resolves the break to its school without inheriting break_time''s RLS');

-- The menu the customer actually sees: only the assigned, active one, with the
-- school's price override alongside it.
select isnt_empty($$ select 1 from menu_item_price_override where school_id = 'c3000000-7e57-0000-0000-000000000001' $$,
                  '§7.4: a customer sees their own school''s price override, or the app shows the wrong number');
select is_empty($$ select 1 from menu where id = 'd6000000-7e57-0000-0000-000000000002' $$,
                '§7.4: …and not another kitchen''s menu');
select is_empty($$ select 1 from menu_item_capacity $$,
                '§7.4: menu_item_capacity is not readable by a customer — "sold out" is not expressible client-side until E18-12 adds a policy. A known gap, not a surprise');
select is_empty($$ select 1 from order_event $$,
                '§9 / [AZ-06]: a customer sees NO order_event — note and metadata carry staff and provider text');
select is_empty($$ select 1 from reason_code where is_customer_visible = false $$,
                '[DM-22]: a customer sees only customer-visible reason codes');
select is_empty($$ select 1 from policy_version where published_at is null $$,
                '§7.9: a customer sees only PUBLISHED policy versions');
reset role;

-- [AZ-02]. orders.view_pii cannot be enforced by RLS: anyone who can see an "order"
-- row sees recipient_name_snapshot. Option (a) — enforce the split in the api/ layer
-- — is safe ONLY while every holder of orders.view also holds orders.view_pii.
--
-- These two assertions are the deadline enforcing itself. The moment E20-09's
-- analyst grant appears, they fail, and option (b) — moving the tier-P snapshot
-- columns to a 1:1 order_recipient_snapshot table with its own policy — becomes due.
select is_empty(
  $$ select rtp.role_code from role_template_permission rtp
      where rtp.permission_code = 'orders.view'
        and not exists (select 1 from role_template_permission r2
                         where r2.role_code = rtp.role_code
                           and r2.permission_code = 'orders.view_pii') $$,
  '[AZ-02]: no role template bundles orders.view without orders.view_pii. When one does, §6.2 option (b) is due BEFORE it ships');

select is_empty(
  $$ select g.permission_code || '@' || g.scope_type from permission_grant g
      where g.permission_code = 'orders.view'
        and g.scope_type <> 'city'
        and g.revoked_at is null
        and (g.expires_at is null or g.expires_at > now())
        and not exists (select 1 from permission_grant g2
                         where g2.user_id = g.user_id
                           and g2.permission_code = 'orders.view_pii'
                           and g2.revoked_at is null
                           and (g2.expires_at is null or g2.expires_at > now())) $$,
  '[AZ-02]: no live grant of orders.view without orders.view_pii (city scope excluded — orders.view_pii is not grantable there)');

-- -----------------------------------------------------------------------------
-- The §10 GRANT tripwire — the [AZ-02] recommendation's sibling for table
-- privileges (authorization-model.md §14, dpdp-compliance.md §5.1).
--
-- Part 1 already asserts the NEGATIVE for class 3 ("authenticated holds no
-- INSERT/UPDATE/DELETE on any class-3 table") and for anon ("no table privilege at
-- all"). This asserts the POSITIVE COMPLEMENT: the exact set of tables on which
-- authenticated is ALLOWED to hold a write privilege. Together they pin the write
-- surface from both sides, so the moment a forbidden grant appears — someone runs
-- `GRANT INSERT ON "order" TO authenticated`, or opens a direct customer-plane write
-- that would bypass RLS on a class-3 table — this set_eq fails and names the table.
--
-- The allowed set is defined structurally, not as a hand-kept literal that would
-- drift: it is every table in public that is NOT class 3. That is the union of the
-- class-1 customer-owned and class-2 back-office-catalogue tables (§5 Rule 4), plus
-- `city` and `kitchen`, which are class 3 by policy but deliberately kept out of
-- §10's revoke list (they are stopped by RLS alone — see the city/kitchen INSERT
-- assertions in Part 6). A class-3 table is precisely one whose writes are
-- service_role only, so it must appear in NEITHER the revoke list NOR this allowed
-- set; a table drifting between the two lists is exactly the mistake this catches.
select set_eq(
  $$ select t.tablename from pg_tables t
      where t.schemaname = 'public'
        and t.tablename not in (select tbl from tests_tmp.tests_class3)
        and not exists (select 1 from pg_depend d
                         where d.objid = to_regclass('public.' || quote_ident(t.tablename))
                           and d.deptype = 'e')
        and ( has_table_privilege('authenticated', 'public.' || quote_ident(t.tablename), 'INSERT')
           or has_table_privilege('authenticated', 'public.' || quote_ident(t.tablename), 'UPDATE')
           or has_table_privilege('authenticated', 'public.' || quote_ident(t.tablename), 'DELETE') ) $$,
  $$ select t.tablename from pg_tables t
      where t.schemaname = 'public'
        and t.tablename not in (select tbl from tests_tmp.tests_class3)
        and not exists (select 1 from pg_depend d
                         where d.objid = to_regclass('public.' || quote_ident(t.tablename))
                           and d.deptype = 'e') $$,
  '§10 grant tripwire: authenticated holds a write privilege on EXACTLY the non-class-3 tables — a forbidden grant on any class-3 table (a direct customer-plane write that would bypass RLS) fails here the moment it appears');

-- The same tripwire, stated the other way for an unambiguous failure message: no
-- class-3 table may carry ANY write privilege for authenticated at the grant level.
-- (Part 1 asserts the INSERT/UPDATE/DELETE trio table-by-table; this is the set form,
-- so a single new grant names its own table.)
select is_empty(
  $$ select t.tbl || ':' || pv.priv from tests_tmp.tests_class3 t
      cross join (values ('INSERT'),('UPDATE'),('DELETE')) as pv(priv)
     where has_table_privilege('authenticated', 'public.' || quote_ident(t.tbl), pv.priv) $$,
  '§10 grant tripwire: no class-3 table carries INSERT, UPDATE or DELETE for authenticated — the second layer under RLS, asserted as a set');

-- §11 — storage. Three private buckets and one public one; the private ones have no
-- policy at all, which is the point.
--
-- Read through a helper rather than inline, because `storage.buckets` is resolved at
-- PARSE time: an `or` guard around a direct reference does not save a database
-- without the storage extension, it just fails earlier. Returns null when storage is
-- absent, and the assertions below treat null as "not asserted".
create function tests_tmp.bucket_is_public(p_id text) returns boolean
language plpgsql stable as $$
declare v boolean;
begin
  if to_regclass('storage.buckets') is null then
    return null;
  end if;
  execute 'select public from storage.buckets where id = $1' into v using p_id;
  return v;
end;
$$;

select ok(tests_tmp.bucket_is_public('invoices') is not true,
          '§11: the invoices bucket is PRIVATE. An invoice PDF carries buyer_name_snapshot, buyer_phone_snapshot and pickup_codes; a guessable public path is the legacy failure in another medium');
select ok(tests_tmp.bucket_is_public('reports')  is not true,
          '§11: the reports bucket is PRIVATE — access is a signed URL gated on reports.view at the report''s school');
select ok(tests_tmp.bucket_is_public('imports')  is not true,
          '§11: the imports bucket is PRIVATE — uploaded spreadsheets carry unvalidated data');
select ok(coalesce(tests_tmp.bucket_is_public('dish-images'), true),
          '§11: dish-images is the one public bucket — long-cached, CDN-served, no PII');
select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
      where schemaname = 'storage'
        and ('anon' = any(roles) or roles = '{public}') $$,
  '§11 / [AZ-03]: no policy in the storage schema names anon or PUBLIC either');


select * from finish();
rollback;
