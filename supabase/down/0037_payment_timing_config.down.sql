-- Rollback for 0037 — the three payment timings, the two reason codes and the refund guard.
--
-- **Order matters here.** The composite type's attributes cannot be dropped while the resolver
-- selects into them, so the function is restored to its pre-0037 body first, then the attributes
-- go, then the columns.
--
-- The reason codes are deleted only if nothing references them: `order.cancel_reason_code` is
-- `references reason_code(code)`, so a cancellation that already cited `checkout_expired` keeps
-- it and this fails rather than orphaning the reason a customer was given. That is the right
-- failure — a cancelled order whose reason has been deleted is an order nobody can explain.
create or replace function resolve_effective_config(p_school_id uuid)
returns effective_config
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select row(
    coalesce(sc.timezone,                             kc.timezone,                             pc.timezone),
    coalesce(sc.order_cutoff_time,                    kc.order_cutoff_time,                    pc.order_cutoff_time),
    coalesce(sc.order_cutoff_days_before,             kc.order_cutoff_days_before,             pc.order_cutoff_days_before),
    coalesce(sc.max_advance_order_days,               kc.max_advance_order_days,               pc.max_advance_order_days),
    coalesce(sc.min_advance_order_days,               kc.min_advance_order_days,               pc.min_advance_order_days),
    coalesce(sc.default_delivery_mode,                kc.default_delivery_mode,                pc.default_delivery_mode),
    coalesce(sc.allow_classroom_delivery,             kc.allow_classroom_delivery,             pc.allow_classroom_delivery),
    coalesce(sc.allow_counter_pickup,                 kc.allow_counter_pickup,                 pc.allow_counter_pickup),
    coalesce(sc.pickup_code_enabled,                  kc.pickup_code_enabled,                  pc.pickup_code_enabled),
    coalesce(sc.revenue_share_bps,                    kc.revenue_share_bps,                    pc.revenue_share_bps),
    coalesce(sc.price_is_tax_inclusive,               kc.price_is_tax_inclusive,               pc.price_is_tax_inclusive),
    pc.cgst_rate_bps,
    pc.sgst_rate_bps,
    pc.igst_rate_bps,
    pc.sac_code,
    coalesce(sc.refund_default_destination,           kc.refund_default_destination,           pc.refund_default_destination),
    coalesce(sc.wallet_at_checkout_enabled,           kc.wallet_at_checkout_enabled,           pc.wallet_at_checkout_enabled),
    coalesce(sc.allergen_warning_enabled,             kc.allergen_warning_enabled,             pc.allergen_warning_enabled),
    coalesce(sc.customer_cancellation_allowed,        kc.customer_cancellation_allowed,        pc.customer_cancellation_allowed),
    coalesce(sc.customer_cancellation_cutoff_minutes, kc.customer_cancellation_cutoff_minutes, pc.customer_cancellation_cutoff_minutes)
  )::effective_config
  from school s
  join platform_config pc on pc.id = 1
  left join kitchen_config kc on kc.kitchen_id = s.kitchen_id
  left join school_config  sc on sc.school_id  = s.id
  where s.id = p_school_id;
$function$;

alter type effective_config drop attribute if exists payment_retry_window_minutes cascade;
alter type effective_config drop attribute if exists payment_in_flight_grace_minutes cascade;
alter type effective_config drop attribute if exists pending_payment_ttl_minutes cascade;

alter table refund drop constraint if exists refund_source_requires_payment;

delete from reason_code where code in ('checkout_expired', 'cutoff_missed');

alter table school_config   drop constraint if exists school_config_payment_minutes_non_negative;
alter table kitchen_config  drop constraint if exists kitchen_config_payment_minutes_non_negative;
alter table platform_config drop constraint if exists platform_config_payment_minutes_non_negative;

alter table school_config
  drop column if exists pending_payment_ttl_minutes,
  drop column if exists payment_in_flight_grace_minutes,
  drop column if exists payment_retry_window_minutes;

alter table kitchen_config
  drop column if exists pending_payment_ttl_minutes,
  drop column if exists payment_in_flight_grace_minutes,
  drop column if exists payment_retry_window_minutes;

alter table platform_config
  drop column if exists pending_payment_ttl_minutes,
  drop column if exists payment_in_flight_grace_minutes,
  drop column if exists payment_retry_window_minutes;
