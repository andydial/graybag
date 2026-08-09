-- =============================================================================
-- 0009_orderable_calendar.sql
--
-- The calendar behind `E05-08` — "order for a future date; the calendar shows which days are
-- orderable" — as one set-returning function.
-- =============================================================================
--
-- WHY A RANGE FUNCTION AND NOT A LOOP OVER `is_service_date_orderable`
--
-- `0008` left that note against `is_service_date_orderable`: the calendar "asks the same
-- question for a range of dates and must not run the config resolution once per day". Calling
-- it per day walks the platform → kitchen → school chain once per day — fourteen chain walks
-- to draw a fortnight, on the network-bound connections this product targets. Here the config
-- is resolved **once**, into a local, and every date is computed against it.
--
-- WHY THE ARITHMETIC IS NOT REPEATED HERE
--
-- `compute_cutoff_at` is called per date rather than having its formula inlined against the
-- already-resolved config. That costs one extra chain walk per day and buys the only thing
-- that matters: there is exactly one implementation of §9.1. A copy inlined here that drifted
-- would be a whole-day error at the default midnight cutoff (`C5`), and it would disagree with
-- the guard that actually refuses the order — so the app would grey out a day the server would
-- have accepted, or worse, offer one it will refuse at the end of checkout.
--
-- The resolved config is still read once, for the advance window, which is the part that is
-- genuinely per-school rather than per-date.
--
-- ADVISORY ONLY (§9.2 E1). The app greys out closed days with this. The authoritative refusal
-- is `assert_cutoff_open` inside the checkout transaction, against a snapshotted `cutoff_at`
-- (`L6`). A client clock is not evidence, and neither is this — it is a drawing aid.
--
-- MENU AVAILABILITY IS DELIBERATELY NOT HERE. Whether a dish exists on a given weekday is
-- `E04`'s rule and already lives in `menu/resolve.ts`, which the app holds a cached copy of.
-- Restating it in SQL would be the second implementation this function exists to avoid. The
-- app intersects the two: a day is offerable when the calendar says it is open **and** the
-- menu has something on it.
-- =============================================================================

create function orderable_calendar(
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
language plpgsql stable
as $$
declare
  cfg effective_config;
begin
  -- Resolved ONCE for the whole range. This is the reason the function exists.
  select * into cfg from resolve_effective_config(p_school_id);

  -- Same refusal as `compute_cutoff_at`: an unknown school raises rather than returning a
  -- calendar computed from nulls, which would be a fortnight of days with null cutoffs and
  -- `null` orderability that the app would render as "closed" without anyone knowing why.
  if cfg.timezone is null then
    raise exception 'no effective config for school %', p_school_id
      using errcode = 'no_data_found';
  end if;

  -- A backwards range yields nothing. `generate_series` already does this; it is stated here
  -- because "no rows" is the correct answer and a caller that passed its arguments the wrong
  -- way round should get an empty calendar rather than an error or a fortnight of the past.
  return query
  with days as (
    select d::date as service_date
      from generate_series(p_from, p_to, interval '1 day') as d
  )
  select
    days.service_date,
    compute_cutoff_at(p_school_id, days.service_date) as cutoff_at,
    (
      now() < compute_cutoff_at(p_school_id, days.service_date)
      and days.service_date >= current_date + cfg.min_advance_order_days
      and days.service_date <= current_date + cfg.max_advance_order_days
    ) as is_orderable,
    case
      -- Cutoff first, deliberately. A day that is both past its cutoff and inside the lead
      -- time gets `cutoff_passed`, because "you have missed it" is the more specific and more
      -- actionable of the two — `too_soon` invites the user to wait, which never helps.
      when now() >= compute_cutoff_at(p_school_id, days.service_date) then 'cutoff_passed'
      when days.service_date < current_date + cfg.min_advance_order_days then 'too_soon'
      when days.service_date > current_date + cfg.max_advance_order_days then 'too_far_ahead'
      -- An open day carries no reason. A reason is why something was refused, and filling it
      -- in with 'ok' would make every caller test the string rather than the boolean.
      else null
    end as reason
  from days
  order by days.service_date;
end;
$$;

comment on function orderable_calendar(uuid, date, date) is
  'E05-08. One config resolution for the whole range; the cutoff itself comes from '
  'compute_cutoff_at so there is one implementation of §9.1. ADVISORY ONLY (§9.2 E1) — the '
  'authoritative refusal is assert_cutoff_open inside the checkout transaction. Menu '
  'availability is not considered: that is E04''s rule, and the app intersects the two.';
