-- =============================================================================
-- 0011_public_school_list.sql
--
-- The school picker's data source. `E03` / `E14-14`, and the thing that makes 0010
-- reachable — a menu read needs a school id, and until now nothing could supply one to
-- a signed-out user.
-- =============================================================================
--
-- WHY THIS IS A THIRD ANON-EXECUTABLE FUNCTION
--
-- The authorization suite pins the anon-executable set exactly, so adding this is a
-- deliberate act that fails the build until the pin is updated. That is the intended
-- workflow, not an obstacle: [AZ-03]'s objection to relaxing `anon` was that a list of
-- approved exceptions grows quietly, and the pin is what makes each addition loud.
--
-- The case for this one: `AR7` requires the app be browsable before anyone identifies
-- themselves, and browsing a menu requires choosing a school. Without it the Menu tab
-- is permanently empty for a signed-out user and the whole of 0010 is unreachable —
-- which is the state the staging build is in today.
--
-- -----------------------------------------------------------------------------
-- WHAT IS EXPOSED, AND WHAT IS DELIBERATELY WITHHELD
--
-- Exposed: id, name, and the city name. That is what a parent needs to recognise their
-- child's school in a list.
--
-- **Withheld, and this is the point:** `school` also carries `contact_name`,
-- `contact_email` and `contact_phone` — a named member of staff at that school. Those
-- are a person's contact details and they are not in the projection. `address_line1`,
-- `address_line2`, `postcode`, `kitchen_id` and `legacy_bubble_id` are also out: none of
-- them helps a parent pick a school, and the kitchen graph is not public information.
--
-- The authorization suite asserts the returned key set, so a later `select s.*` fails
-- rather than quietly publishing a staff member's mobile number.
--
-- -----------------------------------------------------------------------------
-- ONLY ONBOARDED, ACTIVE, NOT-OFFBOARDED SCHOOLS
--
-- `P1` says only onboarded schools appear in the app's picker, and the column comment on
-- `school.onboarded_at` says so too. A school in the table but not yet onboarded is a
-- sales conversation, not a place you can order lunch to — listing it would let a parent
-- pick a school, browse an empty menu, and conclude the app is broken.
-- =============================================================================

create function public.get_schools()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', s.id, 'name', s.name, 'city', c.name)
      order by c.name, s.name
    ),
    '[]'::jsonb
  )
  from school s
  join city c on c.id = s.city_id
  where s.is_active
    and s.onboarded_at is not null
    and s.offboarded_at is null;
$$;

comment on function public.get_schools() is
  '[AUTH-01] Public (anon-executable). Onboarded, active schools for the picker: id, name, city and nothing else. Deliberately excludes contact_name / contact_email / contact_phone, which are a staff member''s details.';

revoke all on function public.get_schools() from public;
grant execute on function public.get_schools() to anon, authenticated;
