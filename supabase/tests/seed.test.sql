-- =============================================================================
-- seed.test.sql — E01-13
--
-- Asserts that supabase/seed.sql loaded, and that the properties the fixtures exist
-- FOR are actually present. Row counts alone would pass while the fixture quietly
-- stopped exercising the thing it was written to exercise — a guardian who cannot
-- order, a draft menu assigned to nothing, an allergy that collides with a real dish.
-- Those are the assertions below.
--
-- It also enforces the two rules a fixture file is most likely to break silently:
-- money is integer paise (non-negotiable #3) and no fixture carries anything that
-- could be mistaken for a real child's data (non-negotiable #4).
--
-- -----------------------------------------------------------------------------
-- HOW TO RUN
--
--   supabase start && supabase db reset && supabase test db
--
-- `db reset` is what applies seed.sql; without it this suite fails at the first
-- assertion, correctly.
-- =============================================================================
begin;

-- pgTAP goes in `extensions` where Supabase already keeps it, but a bare database may
-- not have that schema. Same conditional the authorization suite uses.
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

set local search_path = public, extensions, pg_catalog;

select plan(28);

-- -----------------------------------------------------------------------------
-- 1. The shape E01-13 asks for: 3 schools, 1 kitchen, 3 menus, several users
--    and dependents.
-- -----------------------------------------------------------------------------
select is((select count(*) from city)::int,    1, 'one city — v1 is Mohali only');
select is((select count(*) from kitchen)::int, 1, 'one kitchen');
select is((select count(*) from school)::int,  3, 'three schools');
select is((select count(*) from menu)::int,    3, 'three menus');
select cmp_ok((select count(*) from app_user)::int,  '>=', 4, 'several users');
select cmp_ok((select count(*) from recipient)::int, '>=', 4, 'several dependents');

-- -----------------------------------------------------------------------------
-- 2. Mohali only. A second state code would mean IGST and place-of-supply
--    derivation, which v1 explicitly does not build (docs/mvp-scope.md).
-- -----------------------------------------------------------------------------
select is(
  (select array_agg(distinct gst_state_code) from city),
  array['03']::bpchar[],
  'every city is Punjab (GST state code 03) — no IGST path is reachable'
);

-- -----------------------------------------------------------------------------
-- 3. Money is integer paise. Non-negotiable #3.
--
-- Asserted against the catalogue rather than the values: a price column that became
-- numeric or double precision would still hold 12000 and every value-based test
-- would keep passing.
-- -----------------------------------------------------------------------------
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and column_name like '%\_paise'
      and data_type not in ('bigint', 'integer')),
  0,
  'every *_paise column is an integer type, never numeric or float'
);
select ok(
  (select bool_and(price_paise >= 0) from menu_item),
  'no negative price in the fixture menu'
);

-- -----------------------------------------------------------------------------
-- 4. The three schools are genuinely different, which is the point of having three.
-- -----------------------------------------------------------------------------
select is(
  (select institution_type::text from school where code = 'chandra_college'),
  'college',
  'one institution is a college, so institution_type is exercised'
);
select ok(
  (select onboarded_at is null from school where code = 'chandra_college'),
  'one school is not yet onboarded — it must never appear in a customer-facing list'
);
select is(
  (select count(*)::int from school where onboarded_at is not null),
  2,
  'two schools are onboarded'
);

-- -----------------------------------------------------------------------------
-- 5. The config resolution chain has something to resolve at all three levels
--    ([DM-07]): platform default, kitchen override, school override.
-- -----------------------------------------------------------------------------
select is(
  (select order_cutoff_time from platform_config where id = 1),
  '00:00'::time,
  'platform cutoff is midnight (D5)'
);
select is(
  (select order_cutoff_time from kitchen_config limit 1),
  '23:00'::time,
  'the kitchen overrides the platform cutoff'
);
select is(
  (select default_delivery_mode::text from school_config
    where school_id = (select id from school where code = 'bravo_intl')),
  'counter',
  'one school overrides delivery mode, so all three levels differ'
);
select is(
  (select revenue_share_bps from school_config
    where school_id = (select id from school where code = 'bravo_intl')),
  1500,
  'and overrides the revenue share, in basis points'
);

-- `price_is_tax_inclusive` is [DM-20] and is NOT DECIDED. A fixture that picks a value
-- is a guess about money that propagates into every invoice a test asserts, so the
-- seed must leave it unset and this assertion is what keeps it that way.
select ok(
  (select price_is_tax_inclusive is null from platform_config where id = 1),
  'price_is_tax_inclusive is still unset — [DM-20] is open and the fixture must not guess'
);

-- -----------------------------------------------------------------------------
-- 6. Menus: a draft menu must be assigned to nothing.
-- -----------------------------------------------------------------------------
select is(
  (select count(*)::int from menu where status = 'draft'),
  1,
  'one menu is a draft'
);
select is(
  (select count(*)::int from menu_assignment ma
     join menu m on m.id = ma.menu_id
    where m.status = 'draft' and ma.revoked_at is null),
  0,
  'no live assignment points at a draft menu'
);
select ok(
  (select bool_and(cnt = 1) from (
     select school_id, count(*) cnt from menu_assignment
      where revoked_at is null and valid_to is null
      group by school_id) s),
  'each school has exactly one open-ended assignment — the exclusion constraint holds'
);

-- -----------------------------------------------------------------------------
-- 7. Guardianship states that are otherwise only prose.
-- -----------------------------------------------------------------------------
select is(
  (select count(*)::int from guardian_link
    where recipient_id = '40000000-0000-0000-0000-000000000001' and revoked_at is null),
  2,
  'one child has two guardians ([AZ-05] needs a second guardian to exist)'
);
select is(
  (select count(*)::int from guardian_link where can_order = false and revoked_at is null),
  1,
  'one guardian may view but not order — otherwise can_order is never false in any test'
);
select is(
  (select count(*)::int from recipient where is_self),
  1,
  'one recipient is an adult ordering for themselves, so is_self is exercised'
);
select ok(
  (select not is_minor from recipient where is_self),
  'and that recipient is not a minor'
);
select is(
  (select count(*)::int from app_user
    where migration_source = 'bubble_migrated' and claimed_at is null),
  1,
  'one migrated, unclaimed account exists — the [DM-11] state E03-11 must handle'
);

-- -----------------------------------------------------------------------------
-- 8. The allergy warning path has a real collision to warn about: a recipient whose
--    declared allergen appears on a dish in a menu assigned to that recipient's school.
--    Without this, an allergen test can pass by warning about nothing.
-- -----------------------------------------------------------------------------
select cmp_ok(
  (select count(*)::int
     from recipient_allergen ra
     join recipient r        on r.id = ra.recipient_id
     join menu_assignment ma on ma.school_id = r.school_id and ma.revoked_at is null
     join menu_item mi       on mi.menu_id = ma.menu_id
     join dish_allergen da   on da.dish_id = mi.dish_id and da.allergen_id = ra.allergen_id),
  '>=', 1,
  'a declared allergy actually collides with a dish on that school''s menu'
);

-- -----------------------------------------------------------------------------
-- 9. DPDP. Non-negotiable #4: children's data is regulated, and that binds the
--    fixtures too (docs/testing-strategy.md §4). Every seeded recipient surname is
--    obviously synthetic, and every contact address is unroutable.
-- -----------------------------------------------------------------------------
select ok(
  (select bool_and(last_name in ('Testchild', 'Student')) from recipient),
  'every seeded recipient carries an obviously synthetic surname'
);
select ok(
  (select bool_and(email::text like '%@example.invalid') from app_user where email is not null),
  'every seeded email is on example.invalid — unroutable, so a fixture cannot be mailed'
);

select * from finish();
rollback;
