-- No pack sells on production until Andy confirms the tax point. `E21-52`.
--
-- Andy, 2026-08-27: *"Everything else merges and ships dark: `is_active` false on production, no
-- offer live, no parent sees a thing."*
--
-- `is_active` already defaults false, which stops an offer selling **by existing**. It does not
-- stop somebody activating one — and the person most likely to is whoever is testing the admin
-- screens the web thread is building, on the day they first point them at production.
--
-- So the rule is enforced rather than remembered. `platform_config.environment` already knows
-- which database this is, and `meal_packs_confirmed` is the switch only Andy flips.
--
-- ## Why a trigger and not a check constraint
--
-- The condition spans two tables: the offer being activated and the config row saying where we
-- are. A check constraint cannot read another table. A trigger also refuses a hand-written
-- `psql` statement, which is how the three cancelled orders reached production.

begin;

alter table platform_config
  add column meal_packs_confirmed boolean not null default false;

comment on column platform_config.meal_packs_confirmed is
  'Andy has confirmed the GST tax point for prepaid packs (E21-22), so offers may go live here. '
  'FALSE everywhere until then; `refuse_live_pack_offer_before_confirmation` enforces it on '
  'production, where the cost of guessing is reissuing tax documents.';

create or replace function refuse_live_pack_offer_before_confirmation()
returns trigger
language plpgsql
as $$
declare
  v_environment text;
  v_confirmed   boolean;
begin
  -- Only ever blocks going live. Editing a draft offer, renaming one, or switching it OFF are all
  -- unaffected — the guard is on the transition into being sellable.
  if new.is_active is not true then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.is_active is true then
    return new;
  end if;

  select environment, meal_packs_confirmed into v_environment, v_confirmed from platform_config;

  if v_environment = 'production' and v_confirmed is not true then
    raise exception
      'Meal pack offers cannot go live on production until the GST tax point is confirmed (E21-22)'
      using errcode = 'P0001', hint = 'meal_packs_not_confirmed';
  end if;

  return new;
end;
$$;

create trigger trg_refuse_live_pack_offer_before_confirmation
  before insert or update on meal_pack_offer
  for each row execute function refuse_live_pack_offer_before_confirmation();

comment on function refuse_live_pack_offer_before_confirmation is
  'Packs ship dark on production until E21-22 is answered. A trigger rather than a constraint '
  'because the condition spans two tables — and because a trigger also refuses psql.';

commit;
