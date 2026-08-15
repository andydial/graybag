-- =============================================================================
-- 0058_service_days.sql — which weekdays a school is served. `E10-06`.
-- =============================================================================
--
-- `E10-06` asks for a config UI covering cutoffs, break times and **service days**. The first
-- two already exist — `order_cutoff_time` on all three config tables, `break_time` per school.
-- The third did not exist anywhere, which is why this migration is here rather than a screen
-- being written against a column somebody assumed was there.
--
-- ## What was nearly reused instead, and why it is not the same thing
--
-- `menu_item.available_days` looks like the answer and is not. It says *which weekdays this dish
-- is on the menu*, and it is per-item on a menu that `menu_assignment` may point several schools
-- at (`D4`). Two schools sharing one menu therefore cannot have different service days if the
-- fact lives on the item — and that is exactly the case the first schools are in: Amity, Gem and
-- Paragon share a kitchen and, as of `0029`, the same break windows.
--
-- A school not being served on a Saturday is a property of **the school**, not of the food.
--
-- ## Why this is inert on the day it applies
--
-- The platform default is all seven days, so `resolve_effective_config` returns every day for
-- every school and `orderable_calendar` refuses nothing it did not already refuse. The setting
-- does nothing at all until somebody narrows it in the admin UI. That is deliberate: a migration
-- that silently closes Sunday ordering for three live schools is a migration that gets blamed for
-- an outage, and "additive and inert" is the only version of this that can ship mid-week.
--
-- ## ISO weekday numbers, 1 = Monday
--
-- The same encoding as `menu_item.available_days`, which is the only other weekday set in the
-- schema. A second convention — 0 = Sunday, say — would be one `extract(dow)` away from a
-- Saturday menu appearing on Sunday, and nothing about that failure looks like an off-by-one
-- until somebody reads both columns side by side.
--
-- `extract(isodow)` is the matching Postgres function and returns 1..7 Monday..Sunday.
--
-- ## Empty is refused, on all three levels
--
-- A school served on no days cannot be ordered from at all, which is what `school.is_active` and
-- `offboarded_at` are for. An empty array would express the same thing invisibly — the school
-- stays "active", the picker still lists it, and every day comes back closed with a reason nobody
-- is looking for. One way to close a school, not two.
-- =============================================================================

alter table platform_config
  add column service_days smallint[] not null default '{1,2,3,4,5,6,7}'::smallint[];

alter table kitchen_config add column service_days smallint[];
alter table school_config  add column service_days smallint[];

-- `<@` is "is contained by". `cardinality(...) > 0` is the empty refusal above. Duplicates are
-- not policed: `{1,1,2}` resolves identically to `{1,2}` under `= any(...)`, and a check
-- constraint that has to sort and deduplicate an array to reject a harmless input is a
-- constraint that will one day reject a legitimate one.
alter table platform_config add constraint platform_config_service_days_valid
  check (service_days <@ array[1,2,3,4,5,6,7]::smallint[] and cardinality(service_days) > 0);

alter table kitchen_config add constraint kitchen_config_service_days_valid
  check (service_days is null
     or (service_days <@ array[1,2,3,4,5,6,7]::smallint[] and cardinality(service_days) > 0));

alter table school_config add constraint school_config_service_days_valid
  check (service_days is null
     or (service_days <@ array[1,2,3,4,5,6,7]::smallint[] and cardinality(service_days) > 0));

comment on column platform_config.service_days is
  'E10-06. ISO weekday numbers, 1 = Monday, matching menu_item.available_days. The platform '
  'default is all seven days so this migration changes no behaviour; narrowing happens per '
  'school in the admin UI.';
comment on column kitchen_config.service_days is 'NULL = inherit from platform_config (§9.3).';
comment on column school_config.service_days  is 'NULL = inherit from kitchen_config, then platform_config (§9.3).';

-- -----------------------------------------------------------------------------
-- The resolver.
--
-- `alter type ... add attribute` rather than drop-and-recreate: `compute_cutoff_at`,
-- `orderable_calendar` and `create_checkout` all declare locals of this type, and a `drop type
-- ... cascade` would take all three with it. Adding an attribute leaves every dependent
-- untouched — they simply do not read the new field.
--
-- The attribute goes on the END of the composite. `resolve_effective_config` builds its result
-- with a positional `row(...)`, so inserting a field in the middle would silently shift every
-- value after it into the wrong slot — the tax rates into the cancellation flags. Appending is
-- the only safe position, and this comment is here because the next person to add a setting will
-- reasonably want to put it next to the ones it belongs with.
--
-- **The body below was taken from `pg_get_functiondef` against a migrated database, NOT from
-- `0001`.** The first draft of this migration copied the body out of `0001_initial_schema.sql`,
-- which is where the function is created and is three replacements out of date: `0037` appended
-- `pending_payment_ttl_minutes`, `payment_in_flight_grace_minutes` and
-- `payment_retry_window_minutes`. A `create or replace` built from `0001` would have **silently
-- deleted all three from the resolver** while leaving them on the tables and in the type, and
-- every payment timeout in the system would have started resolving to null.
--
-- It was caught only because appending a 24th field to a 20-field `row(...)` failed the cast.
-- Had `service_days` been an integer it would have type-checked and shipped. So: when you
-- `create or replace` a function in this schema, read the live definition first — `grep` for the
-- function name across `supabase/migrations/` returns eleven files here and only one of them is
-- current.
-- -----------------------------------------------------------------------------
alter type effective_config add attribute service_days smallint[] cascade;

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
    pc.price_is_tax_inclusive,   -- platform only
    pc.cgst_rate_bps,            -- platform only, statutory
    pc.sgst_rate_bps,            -- platform only, statutory
    pc.igst_rate_bps,            -- platform only, statutory
    pc.sac_code,                 -- platform only
    coalesce(sc.refund_default_destination,           kc.refund_default_destination,           pc.refund_default_destination),
    coalesce(sc.wallet_at_checkout_enabled,           kc.wallet_at_checkout_enabled,           pc.wallet_at_checkout_enabled),
    coalesce(sc.allergen_warning_enabled,             kc.allergen_warning_enabled,             pc.allergen_warning_enabled),
    coalesce(sc.customer_cancellation_allowed,        kc.customer_cancellation_allowed,        pc.customer_cancellation_allowed),
    coalesce(sc.customer_cancellation_cutoff_minutes, kc.customer_cancellation_cutoff_minutes, pc.customer_cancellation_cutoff_minutes),
    -- Added by 0037. Same three-level chain as every setting above it.
    coalesce(sc.pending_payment_ttl_minutes,          kc.pending_payment_ttl_minutes,          pc.pending_payment_ttl_minutes),
    coalesce(sc.payment_in_flight_grace_minutes,      kc.payment_in_flight_grace_minutes,      pc.payment_in_flight_grace_minutes),
    coalesce(sc.payment_retry_window_minutes,         kc.payment_retry_window_minutes,         pc.payment_retry_window_minutes),
    coalesce(sc.service_days,                         kc.service_days,                         pc.service_days)
  )::effective_config
  from school s
  join platform_config pc on pc.id = 1
  left join kitchen_config kc on kc.kitchen_id = s.kitchen_id
  left join school_config  sc on sc.school_id  = s.id
  where s.id = p_school_id;
$$;

comment on function resolve_effective_config(uuid) is
  'D5 config chain: COALESCE(school, kitchen, platform) per column. E02-10 unit tests must cover '
  'nothing overridden, kitchen only, school only, both, and a school whose kitchen changed. '
  'service_days added by E10-06 and resolves on the same chain.';

-- -----------------------------------------------------------------------------
-- The calendar honours it.
--
-- A setting nothing enforces is worse than no setting: an operator narrows a school to Monday
-- to Friday, the screen says Saturday is closed, and Saturday orders keep arriving. So this is
-- in the same migration as the column rather than a follow-up ticket.
--
-- **`not_a_service_day` is checked FIRST**, ahead of `cutoff_passed`. Every other reason on this
-- function is temporal — wait, or you were too late — and a caller can reasonably suggest another
-- date. This one is permanent for that weekday, so it is the more useful thing to say when a day
-- is both. It is also the only reason here that is not about *when* you asked.
--
-- Advisory, exactly as the rest of this function is (§9.2 E1). The authoritative refusal is
-- `assert_cutoff_open` inside the checkout transaction, and that is unchanged: service days are
-- not a payment-correctness rule, they are a "do not offer the day" rule. A determined client
-- posting a Saturday order to a Monday-to-Friday school is caught by the menu having nothing on
-- it, which is `E04`'s job and was already true.
-- -----------------------------------------------------------------------------
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
  'E05-08. One config resolution for the whole range; the cutoff itself comes from '
  'compute_cutoff_at so there is one implementation of §9.1. ADVISORY ONLY (§9.2 E1) — the '
  'authoritative refusal is assert_cutoff_open inside the checkout transaction. Menu '
  'availability is not considered: that is E04''s rule, and the app intersects the two. '
  'E10-06 added not_a_service_day, which is checked before cutoff_passed because it is the only '
  'reason here that is permanent for that weekday rather than a matter of timing.';
