-- Down for 0083. Returns `orderable_calendar` to SECURITY INVOKER — that is, to being
-- unreadable by any parent (`E05-52`). Only do this if the definer grant is the problem;
-- the consequence is that the app goes back to having no way to show which days are orderable,
-- and a refusal at checkout becomes the only signal a parent gets.
begin;

create or replace function orderable_calendar(
  p_school_id uuid, p_from date, p_to date
)
returns table (service_date date, cutoff_at timestamptz, is_orderable boolean, reason text)
language plpgsql stable
as $$
declare cfg effective_config;
begin
  select * into cfg from resolve_effective_config(p_school_id);
  if cfg.timezone is null then
    raise exception 'no effective config for school %', p_school_id using errcode = 'no_data_found';
  end if;
  return query
  with days as (select d::date as service_date from generate_series(p_from, p_to, interval '1 day') as d)
  select days.service_date,
         compute_cutoff_at(p_school_id, days.service_date),
         (extract(isodow from days.service_date)::smallint = any (cfg.service_days)
          and now() < compute_cutoff_at(p_school_id, days.service_date)
          and days.service_date >= current_date + cfg.min_advance_order_days
          and days.service_date <= current_date + cfg.max_advance_order_days),
         case
           when not (extract(isodow from days.service_date)::smallint = any (cfg.service_days)) then 'not_a_service_day'
           when now() >= compute_cutoff_at(p_school_id, days.service_date) then 'cutoff_passed'
           when days.service_date < current_date + cfg.min_advance_order_days then 'too_soon'
           when days.service_date > current_date + cfg.max_advance_order_days then 'too_far_ahead'
           else null
         end
  from days order by days.service_date;
end;
$$;

commit;
