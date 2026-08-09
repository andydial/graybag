-- =============================================================================
-- 0008_cutoff_functions.sql
--
-- The cutoff arithmetic and its guard, as SQL functions (E05-07, risk critical).
-- Specified by docs/order-lifecycle.md §9.
-- =============================================================================
--
-- `L6`, the single rule: **enforcement always compares `now()` (from Postgres) against
-- `order.cutoff_at`, the value snapshotted when the order was written** — never against a
-- re-resolution of the config, and never against a client clock. An admin changing the
-- cutoff at 9pm must not retroactively invalidate an order placed at 8pm.
--
-- `0001` gave `"order"` a `cutoff_at` column and left it at that: nothing computed the value
-- and nothing enforced it. Both live here, in SQL, so there is exactly one implementation of
-- each. The Edge Function that runs checkout calls them; so does the calendar endpoint that
-- `E05-08` will build. A second copy in TypeScript that drifted by an hour would be a
-- whole-day error at the default cutoff (see C5 below).
--
-- WHY THERE IS NO BEFORE-INSERT TRIGGER
--
-- The obvious shape is a trigger on `"order"` refusing any insert past cutoff, and it is
-- wrong here: `E16` backfills fourteen months of historical orders, every one of them long
-- past its cutoff, and `"order"` carries no actor column a trigger could use to tell a
-- migration insert from a customer one. A trigger would either reject the entire migration
-- or need an escape hatch, and an escape hatch on the guard protecting the kitchen's lead
-- time is worse than no trigger. So enforcement is `assert_cutoff_open`, called explicitly
-- inside the checkout transaction (§9.2 E3) and by cancellation (E5) — both of which are
-- `service_role` paths that already exist for exactly this kind of invariant.
-- =============================================================================

-- §9.1 — cutoff_at = (service_date − days_before) at cutoff_time, in the resolved timezone.
create function compute_cutoff_at(p_school_id uuid, p_service_date date)
returns timestamptz
language plpgsql stable
as $$
declare
  cfg effective_config;
begin
  select * into cfg from resolve_effective_config(p_school_id);

  -- `resolve_effective_config` returns a NULL composite for an unknown school, and a
  -- composite-returning function in FROM position yields one row regardless — so "no
  -- config" and "config full of nulls" look identical to a careless caller. That is the
  -- same trap `config-cache.ts` documents. Refuse rather than return a cutoff computed
  -- from nulls, which would be `now()`-ish and would quietly let anything through.
  if cfg.timezone is null then
    raise exception 'no effective config for school %', p_school_id
      using errcode = 'no_data_found';
  end if;

  -- `timestamp AT TIME ZONE <named zone>` reads the naive timestamp AS a wall-clock time in
  -- that zone and returns the instant. The zone is a name, never a fixed offset (C3): India
  -- has no DST and has been +05:30 since 1945, so nothing here would break today — but a
  -- hard-coded offset is a bug waiting for the first kitchen outside IST, and it costs
  -- nothing to be right now.
  return (
    ((p_service_date - make_interval(days => cfg.order_cutoff_days_before))
      + cfg.order_cutoff_time) at time zone cfg.timezone
  );
end;
$$;

comment on function compute_cutoff_at(uuid, date) is
  'E05-07 / order-lifecycle §9.1. THE DEFAULTS MEAN: order_cutoff_time 00:00 and '
  'order_cutoff_days_before 0, so the cutoff for MONDAY''s lunch is 00:00 ON MONDAY — you '
  'must order by Sunday night. Easy to misread as 23:59 on the service day, which is a '
  'whole day wrong (C5).';

-- §9.2 E3/E5 — the guard. Raises rather than returning a boolean, for the same reason the
-- app-side production guard does: a boolean invites `if (open) { ... }` and a caller who
-- forgets the `if` gets no guard at all, silently.
create function assert_cutoff_open(p_cutoff_at timestamptz, p_grace_minutes integer default 0)
returns void
language plpgsql stable
as $$
declare
  v_deadline timestamptz := p_cutoff_at - make_interval(mins => coalesce(p_grace_minutes, 0));
begin
  -- STRICT less-than (C1): exactly at the cutoff, ordering is CLOSED. The boundary is
  -- stated here and asserted in the test rather than left to whoever writes the next caller.
  if now() >= v_deadline then
    raise exception 'cutoff passed: deadline %, now %', v_deadline, now()
      using errcode = 'check_violation';
  end if;
end;
$$;

comment on function assert_cutoff_open(timestamptz, integer) is
  'E05-07. Compares Postgres now() against a SNAPSHOTTED cutoff_at (L6) — never against a '
  're-resolved config and never against a client clock. p_grace_minutes carries '
  'customer_cancellation_cutoff_minutes for the T10 cancellation check (§9.2 E5); it is 0 '
  'for order creation. Raises; does not return a boolean.';

-- A convenience for the calendar endpoint (`E05-08`), which asks the same question for a
-- range of dates and must not run the config resolution once per day.
create function is_service_date_orderable(p_school_id uuid, p_service_date date)
returns boolean
language sql stable
as $$
  select now() < compute_cutoff_at(p_school_id, p_service_date);
$$;

comment on function is_service_date_orderable(uuid, date) is
  'E05-08''s calendar. ADVISORY ONLY (§9.2 E1) — the app greys out closed days with it, and '
  'the authoritative check is assert_cutoff_open inside the checkout transaction. A client '
  'clock is not evidence.';
