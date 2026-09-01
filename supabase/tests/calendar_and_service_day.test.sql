-- =============================================================================
-- calendar_and_service_day.test.sql — `E05-52` and `E05-55`.
--
-- These two shipped together because they are one failure seen from two ends. A parent could not
-- find out which days were orderable (`E05-52`, the calendar 404s for them), so the only signal
-- was a refusal at checkout — and that refusal blamed the dish (`E05-55`). A real parent met both
-- on Sunday 2026-08-30 and did not come back.
--
-- The assertions that matter are the ones about **which** answer arrives, not whether an answer
-- arrives. A calendar that returns nothing and a calendar that refuses look identical to a
-- careless client; so do "this school is closed on Sundays" and "this dish came off the menu".
-- Both are §5.21 collapsed states, and both are what this file pins.
-- =============================================================================

begin;
set local search_path = public, tests_tmp, extensions, pg_catalog;
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgtap') then
    begin execute 'create extension pgtap with schema extensions';
    exception when others then execute 'create extension pgtap'; end;
  end if;
end;
$$;
create schema if not exists tests_tmp;
select * from no_plan();
set local app.actor_type = 'system';

-- -----------------------------------------------------------------------------------------------
-- Fixtures: a parent with a child at school A, and a second parent with a child somewhere else.
-- -----------------------------------------------------------------------------------------------

insert into auth.users (id) values
  ('a0000000-7e57-0000-0000-0000000000d1'),
  ('a0000000-7e57-0000-0000-0000000000d2');
insert into app_user (id, email, first_name) values
  ('a0000000-7e57-0000-0000-0000000000d1', 'cal-parent@example.test', 'CalParent'),
  ('a0000000-7e57-0000-0000-0000000000d2', 'other-parent2@example.test', 'Other')
on conflict (id) do update set email = excluded.email;

create temporary table cal as
select (select id from school where is_active and onboarded_at is not null order by name limit 1) as school_id;

create temporary table cal_kid as
select (create_recipient(
          p_guardian_user_id => 'a0000000-7e57-0000-0000-0000000000d1',
          p_first_name => 'CalKid', p_last_name => null,
          p_school_id => (select school_id from cal),
          p_class_label => '6', p_section_label => 'A',
          p_allergen_ids => '{}', p_allergy_note => null,
          p_allergen_consent => false, p_is_self => false,
          p_capture_context => '{"screen":"test"}'::jsonb
        ) ->> 'recipient_id')::uuid as id;

grant select on cal, cal_kid to authenticated;

-- Make the school's service days explicit for this test: Mon-Sat, no Sunday.
--
-- INSERT ... ON CONFLICT, not UPDATE. The seed leaves `school_config` empty and the effective
-- value resolves up the chain to the platform default of all seven days — so a bare UPDATE
-- matched zero rows and the Sunday assertions below failed while appearing to be about the
-- guard. A fixture that silently sets nothing is the same class of problem as the bug it is
-- testing for.
insert into school_config (school_id, service_days)
values ((select school_id from cal), '{1,2,3,4,5,6}')
on conflict (school_id) do update set service_days = excluded.service_days;

select is(
  (select service_days::text from resolve_effective_config((select school_id from cal))),
  '{1,2,3,4,5,6}',
  'fixture: the school really does serve Mon-Sat and not Sunday — asserted, because a fixture '
  'that quietly failed is what made the first run of this file green in the wrong places'
);

-- =============================================================================
-- Part 1 — `E05-52`. The calendar answers the audience it was built for.
-- =============================================================================

select set_config('request.jwt.claims',
  '{"sub":"a0000000-7e57-0000-0000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;

select isnt_empty(
  format($$select 1 from orderable_calendar(%L::uuid, current_date, current_date + 7)$$,
         (select school_id from cal)),
  'A PARENT CAN READ THE CALENDAR FOR THEIR OWN SCHOOL — it returned 404 to every parent before '
  'E05-52, so no screen could ever say which days were orderable'
);

select is(
  (select count(*)::int from orderable_calendar((select school_id from cal),
                                                current_date, current_date + 7)),
  8,
  'and gets one row per day in the range, inclusive'
);

/**
 * The distinction the whole ticket turns on. A parent with no child at this school is REFUSED,
 * not handed an empty list — because an empty list is indistinguishable from "this school serves
 * on no days", which is the collapsed state that made the original bug invisible.
 */
reset role;

select set_config('request.jwt.claims',
  '{"sub":"a0000000-7e57-0000-0000-0000000000d2","role":"authenticated"}', true);
set local role authenticated;

select throws_ok(
  format($$select 1 from orderable_calendar(%L::uuid, current_date, current_date + 1)$$,
         (select school_id from cal)),
  '42501',
  null,
  'A PARENT WITH NO CHILD AT THAT SCHOOL IS REFUSED, not given an empty list — "we could not '
  'check" and "there are no days" must not arrive as the same answer'
);

reset role;

-- Signed out, as PostgREST actually presents it: a claims blob with role `anon` and no `sub`.
-- NOT an empty string — an empty string is how a direct database session looks, which `0083`
-- deliberately treats as an internal caller, so using it here tested the escape hatch rather
-- than the rule.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role authenticated;

select throws_ok(
  format($$select 1 from orderable_calendar(%L::uuid, current_date, current_date + 1)$$,
         (select school_id from cal)),
  '42501',
  null,
  'and a signed-out caller is refused too — the calendar is not anonymous'
);

reset role;

-- =============================================================================
-- Part 2 — the calendar tells the truth about Sunday, and about tomorrow
-- =============================================================================

select set_config('request.jwt.claims',
  '{"sub":"a0000000-7e57-0000-0000-0000000000d1","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select reason from orderable_calendar((select school_id from cal),
                                         current_date, current_date + 13)
    where extract(isodow from service_date) = 7 limit 1),
  'not_a_service_day',
  'a Sunday is reported as not_a_service_day — the reason a picker needs in order not to offer it'
);

select is(
  (select count(*)::int from orderable_calendar((select school_id from cal),
                                                current_date, current_date + 13)
    where is_orderable and extract(isodow from service_date) = 7),
  0,
  'and no Sunday is ever orderable, whatever the cutoff says'
);

reset role;

-- =============================================================================
-- Part 3 — `E05-55`. A non-service day says so, instead of blaming a dish.
-- =============================================================================

create temporary table cal_item as
select mi.id as menu_item_id
  from menu_item mi
  join menu m on m.id = mi.menu_id and m.status = 'active'
  join menu_assignment ma on ma.menu_id = m.id and ma.revoked_at is null
 where ma.school_id = (select school_id from cal)
   and mi.is_active
 limit 1;

/**
 * The next Sunday, which the school does not serve. `create_checkout` runs as service_role, so
 * this is called with the role reset — the same way the `checkout` Edge Function calls it.
 */
create temporary table cal_sunday as
select (current_date + ((7 - extract(isodow from current_date)::int) % 7 + 7))::date as d;

select throws_ok(
  format($$select create_checkout(
             %L::uuid, 'e0555-' || gen_random_uuid(), 'hash', null,
             jsonb_build_array(jsonb_build_object(
               'recipient_id', %L::uuid,
               'service_date', %L::text,
               'menu_item_id', %L::uuid,
               'quantity', 1)))$$,
         'a0000000-7e57-0000-0000-0000000000d1',
         (select id from cal_kid),
         (select d from cal_sunday),
         (select menu_item_id from cal_item)),
  'P0001',
  null,
  'a checkout for a Sunday is still refused — the guard does not open a door'
);

/**
 * And it is refused for the RIGHT REASON. This is the assertion `E05-55` is about: before it,
 * the hint was `unavailable`, the app said "one of the dishes is no longer on the menu for that
 * day", and a parent changed the dish and failed identically.
 */
create temporary table cal_hint as
select h from (
  select null::text as h
) z where false;

do $$
declare v_hint text;
begin
  begin
    perform create_checkout(
      'a0000000-7e57-0000-0000-0000000000d1',
      'e0555b-' || gen_random_uuid(), 'hash', null,
      jsonb_build_array(jsonb_build_object(
        'recipient_id', (select id from cal_kid),
        'service_date', (select d from cal_sunday)::text,
        'menu_item_id', (select menu_item_id from cal_item),
        'quantity', 1)));
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  insert into cal_hint (h) values (v_hint);
end;
$$;

select is(
  (select h from cal_hint),
  'not_a_service_day',
  'THE HINT IS not_a_service_day, NOT unavailable — the parent is told the school does not serve '
  'that day, rather than being sent back to change a dish that was never the problem'
);

select isnt(
  (select h from cal_hint),
  'unavailable',
  'and specifically not the old hint, which is the one that cost a real order on 2026-08-30'
);

/**
 * The other half of the property, and without it the guard could refuse EVERY day and this file
 * would still be green. A day the school does serve must not be refused as a non-service day —
 * it may still fail for a real reason (a cutoff, a price), and that is fine; what it must never
 * report is `not_a_service_day`.
 */
create temporary table cal_weekday as
select h from (select null::text as h) z where false;

do $$
declare v_hint text;
begin
  begin
    perform create_checkout(
      'a0000000-7e57-0000-0000-0000000000d1',
      'e0555c-' || gen_random_uuid(), 'hash', null,
      jsonb_build_array(jsonb_build_object(
        'recipient_id', (select id from cal_kid),
        -- The next Wednesday: a day this school serves, comfortably inside the advance window.
        'service_date', (current_date + ((3 - extract(isodow from current_date)::int + 7) % 7 + 7))::text,
        'menu_item_id', (select menu_item_id from cal_item),
        'quantity', 1)));
    v_hint := '(succeeded)';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
  end;
  insert into cal_weekday (h) values (coalesce(v_hint, '(no hint)'));
end;
$$;

select isnt(
  (select h from cal_weekday),
  'not_a_service_day',
  'A DAY THE SCHOOL DOES SERVE IS NOT REFUSED AS A NON-SERVICE DAY — the guard rejects Sunday, '
  'not Wednesday, and a guard that refused everything would pass every other assertion here'
);

select * from finish();
rollback;
