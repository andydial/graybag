-- Rollback for `0058_service_days.sql`.
--
-- Order matters, and it is not simply the reverse of the up migration.
--
-- `orderable_calendar` is plpgsql and binds `cfg.service_days` at call time, so it must be
-- replaced first — but `resolve_effective_config` is a SQL function whose `row(...)` is
-- cast to the composite at *creation* time. Replacing it with a 23-field body while the type
-- still has 24 attributes fails with "Input has too few columns", so the attribute has to go
-- first and the function is momentarily invalid in between. That is safe here and only here:
-- this whole file runs inside one transaction, so nothing outside it ever observes the gap.
--
-- The first draft had these two the other way round and failed exactly as described. Run a
-- rollback before you trust it.
--
-- **This destroys any narrowing an operator has done.** Every school goes back to seven service
-- days, which is the pre-migration behaviour and is the safe direction to fail in — a school that
-- was closed on Saturdays becomes open on Saturdays, and an unwanted open day shows up as an
-- order somebody has to cancel rather than as a parent unable to feed their child.

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
language plpgsql stable
as $$
declare
  cfg effective_config;
begin
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
      now() < compute_cutoff_at(p_school_id, days.service_date)
      and days.service_date >= current_date + cfg.min_advance_order_days
      and days.service_date <= current_date + cfg.max_advance_order_days
    ) as is_orderable,
    case
      when now() >= compute_cutoff_at(p_school_id, days.service_date) then 'cutoff_passed'
      when days.service_date < current_date + cfg.min_advance_order_days then 'too_soon'
      when days.service_date > current_date + cfg.max_advance_order_days then 'too_far_ahead'
      else null
    end as reason
  from days
  order by days.service_date;
end;
$$;

alter type effective_config drop attribute service_days cascade;

create or replace function resolve_effective_config(p_school_id uuid)
returns effective_config
language sql stable
as $$
  select row(
    coalesce(kc.timezone, pc.timezone),
    coalesce(sc.order_cutoff_time,                    kc.order_cutoff_time,                    pc.order_cutoff_time),
    coalesce(sc.order_cutoff_days_before,             kc.order_cutoff_days_before,             pc.order_cutoff_days_before),
    coalesce(sc.max_advance_order_days,               kc.max_advance_order_days,               pc.max_advance_order_days),
    coalesce(sc.min_advance_order_days,               kc.min_advance_order_days,               pc.min_advance_order_days),
    coalesce(sc.default_delivery_mode,                kc.default_delivery_mode,                pc.default_delivery_mode),
    coalesce(sc.allow_classroom_delivery,             kc.allow_classroom_delivery,             pc.allow_classroom_delivery),
    coalesce(sc.allow_counter_pickup,                 kc.allow_counter_pickup,                 pc.allow_counter_pickup),
    coalesce(sc.pickup_code_enabled,                  kc.pickup_code_enabled,                  pc.pickup_code_enabled),
    coalesce(sc.revenue_share_bps,                    kc.revenue_share_bps,                    pc.revenue_share_bps),
    pc.price_is_tax_inclusive,
    pc.cgst_rate_bps,
    pc.sgst_rate_bps,
    pc.igst_rate_bps,
    pc.sac_code,
    coalesce(sc.refund_default_destination,           kc.refund_default_destination,           pc.refund_default_destination),
    coalesce(sc.wallet_at_checkout_enabled,           kc.wallet_at_checkout_enabled,           pc.wallet_at_checkout_enabled),
    coalesce(sc.allergen_warning_enabled,             kc.allergen_warning_enabled,             pc.allergen_warning_enabled),
    coalesce(sc.customer_cancellation_allowed,        kc.customer_cancellation_allowed,        pc.customer_cancellation_allowed),
    coalesce(sc.customer_cancellation_cutoff_minutes, kc.customer_cancellation_cutoff_minutes, pc.customer_cancellation_cutoff_minutes),
    -- Added by 0037, and it must survive this rollback. See the note in the up migration: a
    -- resolver body copied from 0001 drops these three silently.
    coalesce(sc.pending_payment_ttl_minutes,          kc.pending_payment_ttl_minutes,          pc.pending_payment_ttl_minutes),
    coalesce(sc.payment_in_flight_grace_minutes,      kc.payment_in_flight_grace_minutes,      pc.payment_in_flight_grace_minutes),
    coalesce(sc.payment_retry_window_minutes,         kc.payment_retry_window_minutes,         pc.payment_retry_window_minutes)
  )::effective_config
  from school s
  join platform_config pc on pc.id = 1
  left join kitchen_config kc on kc.kitchen_id = s.kitchen_id
  left join school_config  sc on sc.school_id  = s.id
  where s.id = p_school_id;
$$;


alter table platform_config drop constraint platform_config_service_days_valid;
alter table kitchen_config  drop constraint kitchen_config_service_days_valid;
alter table school_config   drop constraint school_config_service_days_valid;

alter table platform_config drop column service_days;
alter table kitchen_config  drop column service_days;
alter table school_config   drop column service_days;
