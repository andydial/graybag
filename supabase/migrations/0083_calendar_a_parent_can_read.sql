-- =============================================================================
-- `E05-52`. The order calendar, readable by the audience it was built for.
--
-- `orderable_calendar` was SECURITY INVOKER, and `resolve_effective_config` reads
-- `platform_config`, `kitchen_config` and `school_config` — all admin-only. So for every parent
-- it resolved a NULL composite and raised `no_data_found`, which `order-calendar` returned as
-- **404 no configuration for that school**. Verified on production; true for a parent with a
-- child at that very school.
--
-- The cost was not the 404. It is that **no screen could tell a parent which days are orderable**,
-- so the only signal they got was a refusal at the end of checkout — and `E05-55` made that
-- refusal say the wrong thing. A real parent hit exactly this on Sunday 2026-08-30: she opened
-- the app on a non-service day, with a two-day effective lead time, and could not order.
--
-- ## The decision `E05-52` asked for
--
-- Two options were on the table: make the config **resolver** definer, or expose a narrow read.
-- This takes the narrow one. `resolve_effective_config` stays INVOKER, because it returns
-- `revenue_share_bps`, the payment TTLs and the refund destination — commercial terms that have
-- no business reaching a parent's device. Only the calendar becomes definer, and it returns four
-- columns that are the shop's opening hours: which dates are orderable, by when, and why not.
--
-- ## The price of definer, paid here as it was for `order_money`
--
-- A definer function bypasses the RLS that was doing the authorising, so the authorisation has to
-- be restated inside it. A parent may read the calendar **for a school they actually have a child
-- at** — a live `guardian_link` to an undeleted recipient — and back office may read any. Anyone
-- else, including a signed-out caller, is refused with `insufficient_privilege` rather than an
-- empty result: "we could not check" and "there are no days" must not arrive as the same answer,
-- which is §5.21 and the reason this whole ticket exists.
--
-- The body below is `0058`'s, unchanged. Only the security context and the guard are new.
-- =============================================================================

begin;

create or replace function orderable_calendar(
  p_school_id uuid,
  p_from date,
  p_to date
)
returns table (
  service_date date,
  cutoff_at timestamptz,
  is_orderable boolean,
  reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cfg effective_config;
begin
  /**
   * Restated because definer bypasses the policies that used to do this.
   *
   * Deliberately NOT "any authenticated user": a calendar names the days a specific school
   * serves, and while that is closer to opening hours than to personal data, there is no reason
   * for an account with no connection to a school to enumerate it. The link is the one a parent
   * actually made, exactly as `auth_can_reach_recipient` requires elsewhere (`E02-41`'s
   * boundary): a relationship, not a permission.
   */
  /**
   * An internal caller is not an app caller, and refusing it is theatre rather than security.
   *
   * `session_user` is the role that CONNECTED and survives the definer switch — it is `postgres`
   * for a direct database session (psql, a migration, the pgTAP suite) and `authenticator` for
   * everything arriving through PostgREST, so this can never admit a parent or an anonymous
   * request. `auth.role()` covers an Edge Function calling with the service key, which reaches
   * the database through PostgREST and therefore is not `postgres`.
   *
   * `current_user` would be WRONG here and is the trap `auth_is_back_office` documents: inside a
   * SECURITY DEFINER function it is the function's OWNER, which would make this always true.
   *
   * Found by the existing suite — `calendar.test.sql`, `service_days.test.sql` and
   * `checkout.test.sql` all read the calendar directly and went red on the first run.
   *
   * ## And it requires NO impersonation, which is what keeps the rule testable
   *
   * A first version admitted any `session_user = 'postgres'`. That is too broad in the one place
   * it matters: pgTAP always runs as `postgres`, so the parent rule below could never have been
   * asserted — a security rule with no reachable test is not a rule. Requiring that no JWT claim
   * is set as well means a test that impersonates (`set_config('request.jwt.claims', …)`) gets
   * the real rule, and one that does not is treated as the internal caller it is.
   */
  if (session_user = 'postgres'
      and coalesce(current_setting('request.jwt.claims', true), '') = '')
     or coalesce(auth.role(), '') = 'service_role' then
    null;  -- an internal caller; fall through to the query
  elsif not (
    auth_is_live_user()
    and (
      auth_is_back_office()
      or exists (
        select 1
          from guardian_link gl
          join recipient r on r.id = gl.recipient_id
         where gl.user_id = (select auth.uid())
           and gl.revoked_at is null
           and r.deleted_at is null
           and r.school_id = p_school_id
      )
    )
  ) then
    raise exception 'not permitted to read the calendar for school %', p_school_id
      using errcode = 'insufficient_privilege';
  end if;

  select * into cfg from resolve_effective_config(p_school_id);

  if cfg.timezone is null then
    raise exception 'no effective config for school %', p_school_id
      using errcode = 'no_data_found';
  end if;

  return query
  with days as (
    select d::date as service_date
      from generate_series(p_from, p_to, interval '1 day') as d
  )
  select
    days.service_date,
    compute_cutoff_at(p_school_id, days.service_date) as cutoff_at,
    (
      extract(isodow from days.service_date)::smallint = any (cfg.service_days)
      and now() < compute_cutoff_at(p_school_id, days.service_date)
      and days.service_date >= current_date + cfg.min_advance_order_days
      and days.service_date <= current_date + cfg.max_advance_order_days
    ) as is_orderable,
    case
      when not (extract(isodow from days.service_date)::smallint = any (cfg.service_days))
        then 'not_a_service_day'
      when now() >= compute_cutoff_at(p_school_id, days.service_date) then 'cutoff_passed'
      when days.service_date < current_date + cfg.min_advance_order_days then 'too_soon'
      when days.service_date > current_date + cfg.max_advance_order_days then 'too_far_ahead'
      else null
    end as reason
  from days
  order by days.service_date;
end;
$$;

comment on function orderable_calendar(uuid, date, date) is
  'E05-08''s calendar, made readable by a parent for their own school (E05-52). SECURITY DEFINER '
  'so it can resolve config a parent cannot read, with the authorisation restated inside: a live '
  'guardian_link to a recipient at that school, or back office. resolve_effective_config stays '
  'INVOKER — it carries revenue share and payment TTLs. ADVISORY ONLY (§9.2 E1): the authoritative '
  'refusal is assert_cutoff_open inside the checkout transaction.';

grant execute on function orderable_calendar(uuid, date, date) to authenticated;

commit;
