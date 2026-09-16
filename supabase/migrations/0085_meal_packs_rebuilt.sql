-- Meal packs, rebuilt. `E21-69`.
--
-- Andy, 2026-09-16: *"The current design is wrong and should be removed or migrated, not
-- extended."* It is a different product, not a subset of the old one:
--
--   old: a MEAL is N items including one from a required category; a PLANNER picks days ahead and
--        spends the balance when the plan is confirmed; `unique (order_id)` makes one order spend
--        exactly one meal; a `pack_tax_point` flag chooses sale or redemption.
--   new: ONE ITEM IS ONE ITEM, no cap and no category; the CART spends the balance at checkout
--        like any other order; an order may draw many items, across several packs; tax is charged
--        at sale, always; and a bonus is earned by finishing the pack inside a window.
--
-- `unique (order_id)` is why this is a replacement rather than an edit — it makes partial
-- redemption *unrepresentable*, and partial redemption is the central requirement.
--
-- ## Nothing is being destroyed
--
-- Checked against production (`bdamkuugbqjajbndjoxn`) on 2026-09-16 before writing a line of
-- this, because CLAUDE.md's rule is to check the premise before deleting: **0 offers, 0
-- offer-school rows, 0 packs, 0 redemptions, 0 plans, 0 `meal_pack_purchase` order groups, and 0
-- ledger entries against any `deferred_revenue` account.** Packs have never sold anywhere. The
-- drops below move no data because there is none.
--
-- Andy's brief said the feature was held dark by `meal_packs_confirmed = false`. **That flag is
-- `true` on production** and has been since `0077`, when the accountant settled the tax point —
-- it records a settled decision, not a release gate. What has actually kept packs dark is the two
-- things that are still true and are still the gate: every offer is `is_active = false`, and no
-- `meal_pack_offer_school` row exists. Both are preserved here.
--
-- ## What is deliberately NOT dropped
--
--   * `order_group_kind` value `meal_pack_purchase` and `ledger_account_type` value
--     `deferred_revenue` — both correct, and both enum values Postgres cannot remove without
--     rewriting the type.
--   * `order_group.pack_applied_paise` and the `order_group_payable_arithmetic` constraint. This
--     migration writes NO new money mechanism: the schema already expresses "the order is worth X
--     and the pack paid Y of it" as `payable = subtotal + tax - discount - wallet - pack_applied`.
--     Partial redemption is that column doing the job it was added for.
--   * The permission `meal_packs.manage`, already granted on production.
--
-- ## The money model, stated here because the columns only make sense with it
--
-- A pack sale is **deferred revenue**, not revenue: cash received against an obligation to serve
-- food. Revenue is recognised as items are spent, and the balance owed is a FUNCTION of the pack
-- rather than an accumulated column:
--
--     deferred(pack) = round(price_paid_paise * valued_remaining / items_original)
--
-- Every posting is the difference of that function before and after, so the balance cannot drift
-- and the last valued item always lands on exactly zero. See `M13`.
--
-- **Bonus items carry no value** (`M12`, Andy's ruling). `items_original` is the denominator for
-- the life of the pack and never changes; bonus items live in their own column, are granted with
-- no ledger posting, spent with no ledger posting, and forfeited with no ledger posting. They are
-- separate columns rather than a larger total precisely so that no arithmetic can mix them.
--
-- irreversible: this DROPS the old pack design — five tables, eighteen functions, two enums and
-- two `platform_config` columns — and the code that used them is deleted in the same PR. A down
-- migration would have to recreate a schema nothing can drive, so it would restore the shape and
-- not the feature. It moves no data: production had 0 offers, 0 packs, 0 redemptions and 0 plans,
-- checked before this was written. The way back is `git revert`, not SQL.

begin;

-- =============================================================================
-- 1. Out with the old.
--
-- Order matters: the view first, then the functions that reference the tables, then the tables
-- youngest-first so no foreign key blocks a drop.
-- =============================================================================

drop view if exists meal_pack_redemption_money;

-- Every one of these signatures was read out of the catalogue rather than written from memory.
-- A `drop function if exists` with the wrong argument list is a silent no-op that leaves the
-- function live, which is the worst of both outcomes.
drop function if exists meal_pack_deferred_revenue_paise();
drop function if exists meal_pack_deferred_tax_paise();
drop function if exists meal_pack_ineligibility_reason(p_order_id uuid, p_offer_id uuid);
drop function if exists spend_meal_pack_meals(p_user_id uuid, p_meals integer);
drop function if exists return_meal_pack_meal(p_redemption_id uuid, p_reason text);
drop function if exists check_meal_pack_ledger_invariant();
drop function if exists meal_packs_available_at(p_school_id uuid);
drop function if exists meal_pack_offers_for_school(p_school_id uuid);
drop function if exists parent_has_live_meal_pack(p_user_id uuid);
drop function if exists meal_pack_surface(p_user_id uuid, p_school_id uuid);
drop function if exists meal_pack_balance(p_user_id uuid);
drop function if exists meal_pack_balances(p_user_id uuid);
drop function if exists confirm_meal_pack_plan(p_user_id uuid, p_idempotency_key text,
                                               p_days jsonb, p_correlation_id uuid);
drop function if exists start_meal_pack_purchase(p_user_id uuid, p_offer_id uuid,
                                                 p_school_id uuid, p_idempotency_key text);
drop function if exists activate_paid_meal_pack(p_order_group_id uuid, p_correlation_id uuid);

-- The confirmation gate and its column. `meal_packs_confirmed` recorded an accounting question
-- that has since been answered (`0077`, the tax point), and a column whose only reader is gone is
-- a column that will be misread later — as it already was, by a brief that believed it was still
-- `false` and still holding packs back. The gate that actually holds is `is_active = false` plus
-- the absence of a `meal_pack_offer_school` row, and both survive this migration.
drop trigger if exists trg_refuse_live_pack_offer_before_confirmation on meal_pack_offer;
drop function if exists refuse_live_pack_offer_before_confirmation();
alter table platform_config drop column if exists meal_packs_confirmed;
-- `pack_tax_point` is retired for the same reason and one stronger: the tax point is settled.
-- Tax is charged at sale, always, and a column offering a second answer is a way to get it wrong.
alter table platform_config drop column if exists pack_tax_point;

drop table if exists meal_pack_plan;
drop table if exists meal_pack_redemption;
drop table if exists meal_pack;
drop table if exists meal_pack_offer_school;
drop table if exists meal_pack_offer;

-- After the tables, because its trigger lives on `meal_pack` and would otherwise block the drop.
-- It is rebuilt against the new shape in `0086`.
drop function if exists assert_meal_pack_group_kind();

drop type if exists pack_tax_point;
drop type if exists meal_pack_status;

-- =============================================================================
-- 2. In with the new.
-- =============================================================================

create type meal_pack_status      as enum ('pending', 'active', 'exhausted', 'expired');
create type pack_redemption_state as enum ('held', 'confirmed', 'released', 'reversed');

comment on type meal_pack_status is
  'pending: paid for, not yet settled, not spendable. active: spendable. exhausted: nothing left '
  'but not yet expired. expired: swept, balance recognised as breakage, items zeroed.';

comment on type pack_redemption_state is
  'held: a checkout has spoken for these items; the balance is UNTOUCHED. confirmed: the payment '
  'settled and the balance moved. released: the payment never happened. reversed: the order was '
  'cancelled and the items went back.';

-- -----------------------------------------------------------------------------
-- The offer. What an admin configures and sells.
-- -----------------------------------------------------------------------------

create table meal_pack_offer (
  id                 uuid primary key default gen_random_uuid(),
  name               text    not null,
  -- GST-EXCLUSIVE, like every menu price (non-negotiable #7). 300000 = ₹3,000.
  net_price_paise    bigint  not null,
  items_count        int     not null,
  bonus_items_count  int     not null default 0,
  bonus_window_days  int     not null default 0,
  validity_days      int     not null,
  -- Ships false and stays false. Enabling an offer on production is Andy's alone.
  is_active          boolean not null default false,
  sort_order         int     not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint meal_pack_offer_name_not_blank   check (char_length(btrim(name)) between 1 and 80),
  constraint meal_pack_offer_price_positive   check (net_price_paise > 0),
  constraint meal_pack_offer_items_positive   check (items_count > 0),
  constraint meal_pack_offer_bonus_non_neg    check (bonus_items_count >= 0),
  constraint meal_pack_offer_window_non_neg   check (bonus_window_days >= 0),
  constraint meal_pack_offer_validity_positive check (validity_days > 0),
  -- A bonus window with no bonus items, or bonus items with no window, is a misconfiguration that
  -- reads to a parent as a promise. Refused at the column rather than in a screen, because the
  -- screen is not the only way a row gets written.
  constraint meal_pack_offer_bonus_is_coherent
    check ((bonus_items_count = 0) = (bonus_window_days = 0)),
  -- A window that outlives the pack promises something the pack cannot deliver.
  constraint meal_pack_offer_window_within_validity
    check (bonus_window_days <= validity_days)
);

comment on table meal_pack_offer is
  'A pack an admin sells. ANY menu item counts as one item — no price cap, no category '
  'exclusion, deliberately (E21, Andy 2026-09-16). Prices are GST-exclusive.';

-- -----------------------------------------------------------------------------
-- The per-school switch. ABSENCE MEANS OFF.
-- -----------------------------------------------------------------------------

create table meal_pack_offer_school (
  offer_id   uuid not null references meal_pack_offer (id) on delete cascade,
  school_id  uuid not null references school (id),
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (offer_id, school_id)
);

comment on table meal_pack_offer_school is
  'Which schools an offer is sold at. NO ROW MEANS NOT SOLD THERE — the absence is the default, '
  'so a new school is never accidentally selling packs. Together with is_active = false this is '
  'the whole release gate, and both halves must be turned by a person.';

-- -----------------------------------------------------------------------------
-- The pack. A parent owns it, at one school.
-- -----------------------------------------------------------------------------

create table meal_pack (
  id               uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references app_user (id),
  -- Bought at one school and spent there (`P22`, Andy's ruling 2026-09-16).
  school_id        uuid not null references school (id),
  offer_id         uuid not null references meal_pack_offer (id),
  order_group_id   uuid not null references order_group (id) unique,

  -- Stamped at sale. `E21-67`: the old design joined the offer live, so renaming an offer
  -- retitled packs parents already held AND could retitle a tax invoice between sale and
  -- settlement. A snapshot fixes the balance screen and the invoice together.
  name_snapshot    text   not null,

  price_paid_paise bigint not null,   -- ex-tax. THE deferred-revenue numerator
  cgst_paise       bigint not null,
  sgst_paise       bigint not null,

  -- VALUED items: what the money bought. The only ones the ledger knows about.
  items_original   int not null,      -- never changes, ever
  valued_remaining int not null,      -- decremented ONLY at settlement

  -- BONUS items: a giveaway worth nothing in the books (`M12`).
  bonus_items          int not null default 0,
  bonus_remaining      int not null default 0,
  bonus_window_ends_at timestamptz not null,
  bonus_granted_at     timestamptz,

  -- Spoken for by a checkout that has not been paid for. NOT a decrement.
  items_reserved   int not null default 0,
  -- What a parent is told they have. Generated, so it cannot disagree with its parts.
  items_remaining  int generated always as (valued_remaining + bonus_remaining) stored,

  purchased_at   timestamptz not null default now(),
  expires_at     timestamptz not null,
  status         meal_pack_status not null default 'pending',
  correlation_id uuid not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Backstops, NOT the mechanism. The mechanism is the WHERE clause of one atomic statement
  -- (0086). If one of these fires, the mechanism has a bug and the write must abort loudly.
  constraint meal_pack_valued_in_range  check (valued_remaining between 0 and items_original),
  constraint meal_pack_bonus_in_range   check (bonus_remaining  between 0 and bonus_items),
  constraint meal_pack_reserved_non_neg check (items_reserved >= 0),
  constraint meal_pack_reserved_within_balance
    check (items_reserved <= valued_remaining + bonus_remaining),
  -- No bonus item exists before the bonus is earned. The converse is NOT a rule: a granted pack
  -- legitimately reaches bonus_remaining = 0 by spending them.
  constraint meal_pack_bonus_needs_grant
    check (bonus_granted_at is not null or bonus_remaining = 0),
  constraint meal_pack_money_non_neg
    check (price_paid_paise > 0 and cgst_paise >= 0 and sgst_paise >= 0),
  constraint meal_pack_items_positive check (items_original > 0),
  constraint meal_pack_expires_after_purchase check (expires_at > purchased_at)
);

create index ix_meal_pack_spend_order
  on meal_pack (customer_user_id, school_id, expires_at, id)
  where status = 'active';

comment on table meal_pack is
  'A pack a PARENT owns — never a child''s. It carries no recipient, no name, no class and no '
  'section, and has no screen that shows one (non-negotiable #4). Which child ate is a property '
  'of the order, not of the pack.';

comment on column meal_pack.items_reserved is
  'Items spoken for by a checkout awaiting payment. The parent''s BALANCE is untouched until the '
  'webhook confirms — this column is what makes that possible without a read-then-write. '
  'Invariant: equals the sum of meal_pack_redemption.items in state = held.';

comment on column meal_pack.items_original is
  'The denominator of every deferred-revenue calculation, for the life of the pack. It does NOT '
  'grow when the bonus is granted: bonus items carry no value (M12).';

-- -----------------------------------------------------------------------------
-- The redemption. One row per (order line, pack), append-only, with a state.
-- -----------------------------------------------------------------------------

create table meal_pack_redemption (
  id             uuid primary key default gen_random_uuid(),
  meal_pack_id   uuid   not null references meal_pack (id),
  order_group_id uuid   not null references order_group (id),
  order_id       uuid   not null references "order" (id),
  order_line_id  bigint not null references order_line (id),

  items        int not null,   -- how many of that line's quantity this pack covers
  valued_items int not null,   -- of those, how many were VALUED items
  bonus_used   int not null,   -- and how many were free bonus items

  -- The value the pack paid for, ex-tax. What `order_group.pack_applied_paise` is built from.
  -- NOT the deferred revenue recognised, which is a property of the PACK and not of this dish —
  -- a pack item is worth price_paid/items_original however cheap the item it buys.
  covered_subtotal_paise bigint not null,

  state           pack_redemption_state not null default 'held',
  held_at         timestamptz not null default now(),
  settled_at      timestamptz,
  reversed_at     timestamptz,
  reversal_reason text,
  correlation_id  uuid not null,

  constraint meal_pack_redemption_items_positive check (items > 0),
  -- The split is RECORDED at confirm time and read back on reversal, never recomputed — so a
  -- cancellation cannot turn a free bonus item into a valued one or the other way round.
  --
  -- **Only once the state says it is known.** A `held` reservation genuinely does not have a
  -- split: which items it will take depends on what the balance looks like when the payment
  -- settles, which has not happened yet and may never. Requiring the sum unconditionally was a
  -- first draft that asserted a fact about the future, and the test caught it on the first run.
  constraint meal_pack_redemption_split_adds_up
    check (state not in ('confirmed', 'reversed') or items = valued_items + bonus_used),
  constraint meal_pack_redemption_split_non_neg  check (valued_items >= 0 and bonus_used >= 0),
  constraint meal_pack_redemption_value_non_neg  check (covered_subtotal_paise >= 0),
  -- One line may span two packs. It may not draw from the same pack twice.
  constraint meal_pack_redemption_one_per_line_per_pack unique (order_line_id, meal_pack_id)
);

create index ix_meal_pack_redemption_pack  on meal_pack_redemption (meal_pack_id, state);
create index ix_meal_pack_redemption_group on meal_pack_redemption (order_group_id, state);

comment on table meal_pack_redemption is
  'One fact — this order line drew N items from this pack — in one of four states. Carries NO '
  'recipient: the old design had recipient_id here, and a column that does not exist is a column '
  'that cannot leak (non-negotiable #4).';

-- -----------------------------------------------------------------------------
-- The clock's work, recorded.
-- -----------------------------------------------------------------------------

create table meal_pack_expiry (
  meal_pack_id   uuid primary key references meal_pack (id),
  breakage_paise bigint not null,   -- valued items only; bonus items are worth nothing
  items_forfeit  int    not null,   -- what a parent would say they lost: valued + bonus
  valued_forfeit int    not null,   -- what the ledger saw
  expired_at     timestamptz not null default now(),
  constraint meal_pack_expiry_non_neg
    check (breakage_paise >= 0 and items_forfeit >= 0 and valued_forfeit >= 0)
);

comment on table meal_pack_expiry is
  'Why both counts. A pack expiring with 3 items left of which 2 are bonus forfeits THREE items '
  'as a parent would count them, and posts breakage for ONE. The books saying a smaller number is '
  'not a contradiction to explain away later — it is the giveaway having been free all along.';

-- =============================================================================
-- 3. Authorization. Default-deny, and a parent reaches only their own.
--
-- **Every policy names `to authenticated`.** A policy with no `TO` clause is granted to `PUBLIC`,
-- which includes `anon` — so an omission here is a policy that evaluates for a signed-out caller
-- rather than one that refuses. `authorization.test.sql` §9.4 calls it the missing-TO-clause trap
-- and checks for it explicitly; the first draft of this migration had all eight policies without
-- it, and the suite is what said so.
-- =============================================================================

alter table meal_pack_offer        enable row level security;
alter table meal_pack_offer_school enable row level security;
alter table meal_pack              enable row level security;
alter table meal_pack_redemption   enable row level security;
alter table meal_pack_expiry       enable row level security;

-- There is deliberately NO parent-facing policy on meal_pack_offer. What a parent may buy is
-- answered by `meal_pack_offers_for_school()`, a security-definer function, so the database
-- decides what exists for that school and there is no query a client could write to see more.
create policy meal_pack_offer_read_backoffice on meal_pack_offer
  for select to authenticated using (auth_can('meal_packs.manage', 'platform', null));

create policy meal_pack_offer_school_read_backoffice on meal_pack_offer_school
  for select to authenticated using (auth_can('meal_packs.manage', 'platform', null));

create policy deny_dead_accounts on meal_pack
  as restrictive for all to authenticated using (auth_is_live_user());
create policy meal_pack_read_own on meal_pack
  for select to authenticated using (customer_user_id = (select auth.uid()));

create policy deny_dead_accounts on meal_pack_redemption
  as restrictive for all to authenticated using (auth_is_live_user());
create policy meal_pack_redemption_read_own on meal_pack_redemption
  for select to authenticated using (exists (select 1 from meal_pack mp
                             where mp.id = meal_pack_redemption.meal_pack_id
                               and mp.customer_user_id = (select auth.uid())));

create policy deny_dead_accounts on meal_pack_expiry
  as restrictive for all to authenticated using (auth_is_live_user());
create policy meal_pack_expiry_read_own on meal_pack_expiry
  for select to authenticated using (exists (select 1 from meal_pack mp
                             where mp.id = meal_pack_expiry.meal_pack_id
                               and mp.customer_user_id = (select auth.uid())));

-- `updated_at`, the same way every other table does it.
create trigger set_updated_at before update on meal_pack_offer
  for each row execute function set_updated_at();
create trigger set_updated_at before update on meal_pack
  for each row execute function set_updated_at();

-- =============================================================================
-- 4. No refunds on a pack — already enforced, and deliberately left alone.
--
-- `refuse_refund_of_meal_pack_purchase()` and its `BEFORE INSERT ON refund` trigger survive from
-- the old build untouched. They key on `order_group.kind = 'meal_pack_purchase'`, which this
-- migration keeps, so the guard needs nothing from the rebuild and the rebuild needs nothing
-- from it.
--
-- Written down rather than silently skipped, because "the rebuild dropped the no-refund rule"
-- is exactly the kind of thing that is discovered by a parent asking for their money back.
-- `E21-71`'s pgTAP asserts it still refuses, against the NEW tables.
-- =============================================================================

commit;
