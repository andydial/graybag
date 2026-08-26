-- Meal packs. `E21-23`.
--
-- Andy, 2026-08-26: "This is the highest-consequence feature we've built, because it takes money
-- up front for food not yet served."
--
-- Plan and reasoning: docs/meal-packs-plan.md, approved with three amendments, all of which are
-- implemented here:
--
--   1. Idempotency belongs on the PLAN SUBMISSION, not the redemption. `unique (order_id)` stops
--      one order spending two meals; it does nothing about a retried confirmation creating four
--      NEW orders that each spend a meal. See `meal_pack_plan`.
--   2. Tax legs follow the STAMPED tax point, not the live config, and the invariant holds in
--      both modes. See `meal_pack_deferred_tax_paise`.
--   3. Rounding: the liability is COMPUTED, never stamped per meal. See `pack_liability_paise`.
--
-- No pack sells on production until Andy confirms the tax point (`E21-22`): offers are created
-- inactive and `check:config` asserts production holds no active offer until then.

begin;

-- ---------------------------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------------------------

create type meal_pack_status as enum ('active', 'exhausted', 'expired', 'void');

-- WHEN the tax on a prepaid pack arises. Open with Andy's accountant (`E21-22`), so both are
-- built. The value is stamped onto each pack at sale and never read from config afterwards.
create type pack_tax_point as enum ('sale', 'redemption');

-- A pack sale is NOT revenue: it is cash against an obligation to serve food. Counting it at
-- sale and again at redemption is precisely the double-count Andy asked to be made impossible.
alter type ledger_account_type add value if not exists 'deferred_revenue';
-- Tax collected from the parent at sale but not yet due to the government, which is the shape
-- `tax_point = 'redemption'` needs. Under `'sale'` this account stays at zero.
alter type ledger_account_type add value if not exists 'deferred_tax';

commit;

-- `alter type ... add value` cannot be used in the same transaction that uses the new value,
-- so the seed below runs in its own.
begin;

-- ---------------------------------------------------------------------------------------------
-- The offer: what the admin configures and sells. The web thread's screens write this.
-- ---------------------------------------------------------------------------------------------

create table meal_pack_offer (
  id                        uuid primary key default gen_random_uuid(),
  name                      text        not null,
  meals_count               int         not null,
  items_per_meal            int         not null,
  -- "one of them a drink" — CONFIGURED, never hardcoded to Drinks. The rule is enforced
  -- server-side against this category when the meal is spent.
  required_category_id      uuid        not null references dish_category(id) on delete restrict,
  -- GST-EXCLUSIVE, like every menu price (non-negotiable #7).
  net_price_paise           bigint      not null,
  -- What the same meals cost singly, for the prototype's "save ₹375". Display only; never
  -- used in a money calculation.
  alacarte_reference_paise  bigint      not null,
  validity_days             int         not null,
  -- Default FALSE, and that is the production guard: an offer nobody activated cannot be sold.
  is_active                 boolean     not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint meal_pack_offer_meals_positive     check (meals_count > 0),
  constraint meal_pack_offer_items_positive     check (items_per_meal > 0),
  constraint meal_pack_offer_price_positive     check (net_price_paise > 0),
  constraint meal_pack_offer_validity_positive  check (validity_days > 0),
  -- A pack must be cheaper than buying the meals singly, or it is not an offer. Caught here
  -- rather than in an admin form, because the form is not the only way rows arrive.
  constraint meal_pack_offer_is_a_discount      check (net_price_paise < alacarte_reference_paise)
);

comment on table meal_pack_offer is
  'A sellable meal pack (E21). `is_active` defaults FALSE so an offer cannot be sold by existing; '
  'production keeps every offer inactive until Andy confirms the GST tax point (E21-22).';

-- ---------------------------------------------------------------------------------------------
-- The school switch. ABSENCE means off — a school is not offered packs unless a row says so.
-- ---------------------------------------------------------------------------------------------

create table meal_pack_offer_school (
  offer_id   uuid    not null references meal_pack_offer(id) on delete cascade,
  school_id  uuid    not null references school(id)          on delete restrict,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (offer_id, school_id)
);

comment on table meal_pack_offer_school is
  'Which schools are offered which packs (E21). No row means NOT OFFERED — the default is off, so '
  'a school added tomorrow is not silently selling packs. The app renders a designed state for '
  'this ("Meal packs aren''t offered at this school"), not an empty list.';

-- ---------------------------------------------------------------------------------------------
-- A pack a parent OWNS.
-- ---------------------------------------------------------------------------------------------

create table meal_pack (
  id                  uuid primary key default gen_random_uuid(),
  -- THE owner, and the only one. A pack is the parent's, usable for anyone they order for at any
  -- participating school — never bound to a child. The child is on the REDEMPTION.
  customer_user_id    uuid        not null references app_user(id)        on delete restrict,
  offer_id            uuid        not null references meal_pack_offer(id) on delete restrict,
  -- The purchase. `unique` because one order group buys at most one pack.
  order_group_id      uuid        not null unique references order_group(id) on delete restrict,

  meals_total         int         not null,
  -- THE balance. Decremented atomically; see `spend_meal_pack_meals`.
  meals_remaining     int         not null,

  -- ── Stamped at sale, and never re-read from config or the offer ────────────────────────────
  -- The offer's price can change and the config can be flipped; neither may retroactively alter
  -- a pack already sold. Andy, approving the plan: "packs sold before the accountant answers keep
  -- their original treatment."
  net_price_paise     bigint      not null,   -- ex-GST, the deferred-revenue base
  tax_total_paise     bigint      not null,   -- CGST + SGST collected at sale
  cgst_paise          bigint      not null,
  sgst_paise          bigint      not null,
  tax_point           pack_tax_point not null,

  purchased_at        timestamptz not null default now(),
  expires_at          timestamptz not null,
  status              meal_pack_status not null default 'active',
  correlation_id      uuid        not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- The BACKSTOP, not the mechanism. The mechanism is the guarded UPDATE in
  -- `spend_meal_pack_meals`. If this constraint ever fires, the mechanism has a bug and the write
  -- must abort loudly rather than proceed.
  constraint meal_pack_remaining_not_negative check (meals_remaining >= 0),
  constraint meal_pack_remaining_within_total check (meals_remaining <= meals_total),
  constraint meal_pack_total_positive         check (meals_total > 0),
  constraint meal_pack_price_positive         check (net_price_paise > 0),
  constraint meal_pack_tax_split_adds_up      check (cgst_paise + sgst_paise = tax_total_paise)
);

create index ix_meal_pack_owner_live on meal_pack (customer_user_id, status, expires_at);

comment on column meal_pack.tax_point is
  'STAMPED AT SALE. Every downstream decision reads this, never platform_config — so flipping the '
  'config changes the future without rewriting packs already sold and invoiced (E21-22).';
comment on column meal_pack.meals_remaining is
  'The balance. Only ever changed by spend_meal_pack_meals / return_meal_pack_meal, both of which '
  'move the ledger in the same transaction.';

-- ---------------------------------------------------------------------------------------------
-- Redemptions. Append-only: a reversal is a column, never a delete.
-- ---------------------------------------------------------------------------------------------

create table meal_pack_redemption (
  id              uuid primary key default gen_random_uuid(),
  meal_pack_id    uuid        not null references meal_pack(id) on delete restrict,
  -- UNIQUE. This is what makes "this order spent two meals" UNREPRESENTABLE rather than merely
  -- checked somewhere. Andy: the right instinct, so it is a constraint and not a code path.
  order_id        uuid        not null unique references "order"(id) on delete restrict,
  -- WHICH child ate, which is not who owns the pack. One pack covers several children and a
  -- single plan may mix them across days.
  recipient_id    uuid        not null references recipient(id) on delete restrict,
  service_date    date        not null,
  -- What was recognised as revenue for THIS meal. Computed by difference (see
  -- `pack_liability_paise`), so the amounts across a pack sum to its price exactly.
  revenue_paise   bigint      not null,
  tax_paise       bigint      not null default 0,  -- non-zero only when tax_point = 'redemption'
  redeemed_at     timestamptz not null default now(),
  reversed_at     timestamptz,
  reversal_reason text,
  correlation_id  uuid        not null,
  constraint meal_pack_redemption_revenue_non_negative check (revenue_paise >= 0),
  constraint meal_pack_redemption_reason_with_reversal check (
    (reversed_at is null and reversal_reason is null) or
    (reversed_at is not null and reversal_reason is not null))
);

create index ix_meal_pack_redemption_pack on meal_pack_redemption (meal_pack_id, reversed_at);

comment on table meal_pack_redemption is
  'One meal spent (E21). Append-only. `unique (order_id)` makes double-spending a single order '
  'unrepresentable; a cancellation sets `reversed_at` and returns the meal rather than deleting.';

-- ---------------------------------------------------------------------------------------------
-- Plan-level idempotency. AMENDMENT 1.
-- ---------------------------------------------------------------------------------------------
--
-- `unique (order_id)` guarantees one order spends one meal. It says nothing about a RETRIED plan
-- confirmation creating four brand-new orders that each spend one — which is the actual failure:
-- a parent at the school gate taps Confirm, the response is lost, they tap again, and eight meals
-- are gone.
--
-- So the key is on the SUBMISSION. The whole plan — orders, redemptions, decrement, ledger — is
-- one transaction keyed by it, and a retry returns the first result verbatim rather than doing
-- anything.

create table meal_pack_plan (
  -- Client-supplied, one per confirmation — NOT one per day.
  idempotency_key   text        primary key,
  customer_user_id  uuid        not null references app_user(id) on delete restrict,
  -- A repeat with the same key and a DIFFERENT plan is a bug in the caller, not a replay, and is
  -- refused rather than silently returning someone else's orders.
  request_hash      text        not null,
  meals_requested   int         not null,
  order_ids         uuid[]      not null default '{}',
  redemption_ids    uuid[]      not null default '{}',
  created_at        timestamptz not null default now(),
  correlation_id    uuid        not null,
  constraint meal_pack_plan_meals_positive check (meals_requested > 0)
);

comment on table meal_pack_plan is
  'Plan-level idempotency (E21, amendment 1). The unit of retry is the whole confirmation: four '
  'days retried on a flaky connection must produce four orders, not eight. `order_ids` is replayed '
  'verbatim to the second caller.';

-- ---------------------------------------------------------------------------------------------
-- The tax-point switch, and the money maths
-- ---------------------------------------------------------------------------------------------

alter table platform_config
  add column pack_tax_point pack_tax_point not null default 'sale';

comment on column platform_config.pack_tax_point is
  'WHEN GST on a prepaid pack arises — at sale or at redemption (E21-22, open with the '
  'accountant). Read ONLY when a pack is sold, then stamped onto meal_pack.tax_point. Flipping '
  'this changes future sales and never rewrites past ones.';

/**
 * The liability still owed on a pack, in paise.
 *
 * ## AMENDMENT 3, and why the liability is COMPUTED rather than stamped per meal
 *
 * The obvious design stamps a per-meal value at sale. It cannot work, and the reason is small and
 * fatal: `meals_remaining` is a COUNT. It does not say WHICH meals remain. So if ₹1,000 over 3
 * meals is stamped as 33334 + 33333 + 33333, there is no way to know which of the three are left,
 * and therefore no well-defined sum. The invariant would be off by a paise — and Andy is right
 * that an invariant off by a paise is one that gets switched off.
 *
 * Computing it by proportion is exact instead. With
 *
 *     L(r) = floor(net_price * r / total)
 *
 * the revenue recognised for one meal is `L(before) - L(after)`, every step is an integer, and
 * because `L(total) = net_price` and `L(0) = 0` the amounts TELESCOPE: they sum to the price
 * exactly, with no remainder to lose. ₹1,000 over 3 gives 33334, 33333, 33333.
 *
 * Integer arithmetic throughout — `bigint`, never numeric, never a float (non-negotiable #3).
 */
create or replace function pack_liability_paise(p_amount_paise bigint, p_remaining int, p_total int)
returns bigint
language sql
immutable
as $$
  select case
    when p_total <= 0 or p_remaining <= 0 then 0::bigint
    when p_remaining >= p_total           then p_amount_paise
    else (p_amount_paise * p_remaining) / p_total   -- integer division: floor, and that is intended
  end;
$$;

comment on function pack_liability_paise is
  'Liability still owed on a pack (E21, amendment 3). Computed by proportion so per-meal amounts '
  'telescope to the price exactly; a stamped per-meal value cannot work because meals_remaining is '
  'a count and does not say which meals remain.';

/** Total deferred REVENUE across every live pack — one half of the invariant. */
create or replace function meal_pack_deferred_revenue_paise()
returns bigint
language sql
stable
as $$
  select coalesce(sum(pack_liability_paise(net_price_paise, meals_remaining, meals_total)), 0)
    from meal_pack
   where status in ('active', 'exhausted');
$$;

/**
 * Total deferred TAX across every live pack. AMENDMENT 2.
 *
 * Only packs stamped `redemption` carry deferred tax: under `sale` the tax was handed to the
 * government at purchase and this contributes nothing. Both modes therefore have an invariant,
 * and it is the same shape — which is what Andy asked for, rather than one mode being the tested
 * path and the other a branch nobody exercises.
 */
create or replace function meal_pack_deferred_tax_paise()
returns bigint
language sql
stable
as $$
  select coalesce(sum(pack_liability_paise(tax_total_paise, meals_remaining, meals_total)), 0)
    from meal_pack
   where status in ('active', 'exhausted')
     and tax_point = 'redemption';
$$;

comment on function meal_pack_deferred_tax_paise is
  'The tax half of the invariant (E21, amendment 2). Non-zero only for packs stamped '
  '`redemption`; under `sale` the tax left at purchase, so this is zero and the invariant still '
  'holds rather than being skipped.';

-- ---------------------------------------------------------------------------------------------
-- Ledger accounts and reason codes
-- ---------------------------------------------------------------------------------------------

-- `0013` pins `normal_balance` per `account_type` so a caller cannot get one account right and
-- another wrong (`E06-31`). Both new types are LIABILITIES — money held against something still
-- owed — so both run credit, and the constraint has to learn them before the accounts can exist.
alter table ledger_account
  drop constraint if exists ledger_account_normal_balance_matches_type;
alter table ledger_account
  add constraint ledger_account_normal_balance_matches_type check (
    (account_type in ('wallet', 'payable', 'tax_payable', 'revenue',
                      'deferred_revenue', 'deferred_tax') and normal_balance = 'credit')
    or
    (account_type in ('receivable', 'provider_clearing', 'provider_fees', 'suspense', 'bank')
       and normal_balance = 'debit')
  );

insert into ledger_account (code, owner_type, owner_id, account_type, normal_balance) values
  ('platform:deferred_revenue:meal_packs', 'platform', null, 'deferred_revenue', 'credit'),
  ('platform:deferred_tax:meal_packs',     'platform', null, 'deferred_tax',     'credit'),
  ('platform:revenue:breakage',            'platform', null, 'revenue',          'credit')
on conflict (code) do nothing;

insert into reason_code (code, category, display_name, requires_note, is_customer_visible) values
  ('meal_pack_sale',        'ledger', 'Meal pack sold',            false, false),
  ('meal_pack_redemption',  'ledger', 'Meal pack meal redeemed',   false, false),
  ('meal_pack_return',      'ledger', 'Meal pack meal returned',   false, false),
  ('meal_pack_expiry',      'ledger', 'Meal pack expired',         false, false)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------------------------
-- No refunds on packs — ENFORCED, not stated. Andy: "enforced not just stated."
-- ---------------------------------------------------------------------------------------------
--
-- The prototype promises this before the parent pays, so the enforcement has to be at least as
-- strong as the promise. A trigger rather than a check in an Edge Function, because a trigger
-- also refuses a hand-written `psql` statement — and the three cancelled orders on production
-- exist because a terminal can do what code refuses to.

create or replace function refuse_refund_of_meal_pack_purchase()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from meal_pack mp where mp.order_group_id = new.order_group_id) then
    raise exception 'A meal pack purchase cannot be refunded (E21). Pack %, order group %',
      (select id from meal_pack where order_group_id = new.order_group_id), new.order_group_id
      using errcode = 'P0001', hint = 'packs_are_not_refundable';
  end if;
  return new;
end;
$$;

create trigger trg_refuse_refund_of_meal_pack_purchase
  before insert on refund
  for each row execute function refuse_refund_of_meal_pack_purchase();

comment on function refuse_refund_of_meal_pack_purchase is
  'Packs are not refundable (E21) and the parent is told so before paying. A trigger rather than '
  'application code, so no path reaches it — including psql.';

-- ---------------------------------------------------------------------------------------------
-- RLS. Default-deny, like everything else (non-negotiable #2).
-- ---------------------------------------------------------------------------------------------

alter table meal_pack_offer         enable row level security;
alter table meal_pack_offer_school  enable row level security;
alter table meal_pack               enable row level security;
alter table meal_pack_redemption    enable row level security;
alter table meal_pack_plan          enable row level security;

-- Offers are browsable by anyone, signed in or not, exactly like the menu — a parent deciding
-- whether to sign up should be able to see what a pack costs. `E02-33`: both roles, or a signed-in
-- parent sees nothing.
create policy anon_meal_pack_offer_active on meal_pack_offer
  for select to anon, authenticated
  using (is_active);

create policy anon_meal_pack_offer_school_enabled on meal_pack_offer_school
  for select to anon, authenticated
  using (is_enabled);

-- A parent reads their own packs and nobody else's.
create policy meal_pack_read_own on meal_pack
  for select to authenticated
  using (customer_user_id = auth.uid());

create policy meal_pack_redemption_read_own on meal_pack_redemption
  for select to authenticated
  using (exists (select 1 from meal_pack mp
                  where mp.id = meal_pack_redemption.meal_pack_id
                    and mp.customer_user_id = auth.uid()));

create policy meal_pack_plan_read_own on meal_pack_plan
  for select to authenticated
  using (customer_user_id = auth.uid());

-- Writes go through Edge Functions on the service role (non-negotiable #1), so there is
-- deliberately NO insert/update/delete policy for `authenticated` on any of these tables. A
-- parent cannot mint a pack or a redemption by talking to PostgREST.

-- Dead accounts lose access to everything, consistent with the browse tables.
create policy deny_dead_accounts on meal_pack
  as restrictive for all to authenticated using (auth_is_live_user());
create policy deny_dead_accounts on meal_pack_redemption
  as restrictive for all to authenticated using (auth_is_live_user());
create policy deny_dead_accounts on meal_pack_plan
  as restrictive for all to authenticated using (auth_is_live_user());

commit;
