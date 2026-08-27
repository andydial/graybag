-- Order groups get a KIND, and packs get their visibility rules. `E21-26`, `E21-27`, `E21-28`.
--
-- Andy, 2026-08-26, choosing between teaching the totals assertion and giving packs their own
-- payment linkage: *"duplicating the payment path means duplicating settlement, the webhook, the
-- drain and reconciliation — the most fragile code we own, and the place every serious bug this
-- month has lived."* So packs go through the existing payment path, and the invariant learns what
-- a pack purchase is.
--
-- *"Teach it properly rather than weakening it… That isn't a hole in the invariant, it's the
-- invariant finally being complete — right now it silently assumes every group is food."*
--
-- No nullable escape, no exemption flag, no "skip if empty". Every group declares its kind and
-- every kind has a rule that must hold.

begin;

-- ---------------------------------------------------------------------------------------------
-- 1. The kind. `E21-26`.
-- ---------------------------------------------------------------------------------------------

create type order_group_kind as enum ('food', 'meal_pack_purchase');

-- `not null` with a default, so every existing group is explicitly food rather than unknown. The
-- default stays afterwards because food is overwhelmingly the common case and an omitted kind
-- should be the safe one — a group that forgot to say is held to the stricter, older rule.
alter table order_group
  add column kind order_group_kind not null default 'food';

comment on column order_group.kind is
  'What this group IS (E21-26). `food` — totals equal the sum of member orders. '
  '`meal_pack_purchase` — totals equal the pack price and there are NO member orders. Both rules '
  'are enforced by assert_order_group_totals; neither is an exemption from the other.';

/**
 * Totals must match — and what "match" means now depends on what the group is.
 *
 * ## Why this is completion, not weakening
 *
 * The original assertion had exactly one rule and applied it to every group. That was correct
 * while every group was food, and it silently assumed it. A pack purchase is money taken for meals
 * not yet chosen: it has no member orders, so summing them yields zero and the old rule declared
 * a perfectly correct ₹3,000 purchase to be broken.
 *
 * The temptation was an escape hatch — skip when there are no member orders. That would have made
 * the invariant unable to catch a FOOD group that lost all its orders, which is a real corruption
 * and exactly what this trigger exists to notice. So instead each kind gets its own rule and
 * neither can be satisfied by accident:
 *
 *   · `food`               — totals equal the sum of member orders (unchanged, to the paise)
 *   · `meal_pack_purchase` — totals equal the pack's stamped price, AND there are no member orders
 *
 * A pack group with a food order in it now fails, and so does a pack group whose totals drift from
 * the pack. Neither was expressible before.
 */
create or replace function assert_order_group_totals(p_group_id uuid) returns void
language plpgsql as $$
declare
  g order_group%rowtype;
  s record;
  p record;
  v_order_count int;
begin
  select * into g from order_group where id = p_group_id;
  if not found then
    return;   -- the group was deleted in this same transaction; nothing to assert
  end if;

  if g.kind = 'meal_pack_purchase' then
    select count(*) into v_order_count from "order" o where o.order_group_id = p_group_id;
    if v_order_count <> 0 then
      raise exception
        'order_group % is a meal pack purchase and must have no member orders, but has %',
        p_group_id, v_order_count
        using errcode = 'check_violation';
    end if;

    select net_price_paise, tax_total_paise into p
      from meal_pack where order_group_id = p_group_id;

    if not found then
      -- The pack is written in the same transaction as the group, and this trigger is DEFERRED to
      -- COMMIT, so by the time it runs the pack must exist. A group calling itself a pack purchase
      -- with no pack is a half-written purchase, which is worse than either whole state.
      raise exception
        'order_group % is a meal pack purchase but no meal_pack references it', p_group_id
        using errcode = 'check_violation';
    end if;

    if g.subtotal_paise <> p.net_price_paise
       or g.tax_total_paise <> p.tax_total_paise
       or g.discount_paise <> 0 then
      raise exception
        'order_group % totals do not match its pack: group (subtotal %, tax %, discount %) vs pack (net %, tax %)',
        p_group_id, g.subtotal_paise, g.tax_total_paise, g.discount_paise,
        p.net_price_paise, p.tax_total_paise
        using errcode = 'check_violation';
    end if;

    return;
  end if;

  -- `food`: unchanged, deliberately. This is the rule that has held since 0001 and nothing about
  -- packs is a reason to relax it.
  select coalesce(sum(o.subtotal_paise), 0)                                       as subtotal,
         coalesce(sum(o.tax_cgst_paise + o.tax_sgst_paise + o.tax_igst_paise), 0) as tax,
         coalesce(sum(o.discount_paise), 0)                                       as discount
    into s
    from "order" o
   where o.order_group_id = p_group_id;

  if g.subtotal_paise <> s.subtotal
     or g.tax_total_paise <> s.tax
     or g.discount_paise <> s.discount then
    raise exception
      'order_group % totals do not match its orders: group (subtotal %, tax %, discount %) vs orders (subtotal %, tax %, discount %)',
      p_group_id, g.subtotal_paise, g.tax_total_paise, g.discount_paise, s.subtotal, s.tax, s.discount
      using errcode = 'check_violation';
  end if;
end;
$$;

-- A pack's purchase group must actually SAY it is one. Without this a pack could hang off a food
-- group, which would then be held to the food rule and fail confusingly at COMMIT rather than
-- clearly at insert.
create or replace function assert_meal_pack_group_kind()
returns trigger language plpgsql as $$
begin
  if (select kind from order_group where id = new.order_group_id) <> 'meal_pack_purchase' then
    raise exception 'meal_pack % must hang off an order_group of kind meal_pack_purchase', new.id
      using errcode = 'check_violation', hint = 'wrong_group_kind';
  end if;
  return new;
end;
$$;

create trigger trg_assert_meal_pack_group_kind
  after insert on meal_pack
  for each row execute function assert_meal_pack_group_kind();

-- ---------------------------------------------------------------------------------------------
-- 1b. How a pack-paid food order reconciles to nothing payable
-- ---------------------------------------------------------------------------------------------
--
-- A redeemed meal makes `payable_paise` zero, and the existing arithmetic is
-- `payable = subtotal + tax - discount - wallet_applied`. There were two ways to make that work
-- with what already exists, and both are wrong:
--
--   · Put the value in `discount_paise`. But nothing was discounted — the food is the same price,
--     it was paid for in advance. Every discount report would then include redemptions, and the
--     number Andy uses to see what promotions cost would silently include prepaid meals.
--   · Put it in `wallet_applied_paise`. A wallet is a different liability with a different ledger
--     account, and conflating them makes the deferred-revenue invariant unverifiable.
--
-- So a redemption gets its own term. It is the same SHAPE as the wallet — money already held
-- against this parent, applied at checkout — which is why it slots into the arithmetic the same
-- way, and it stays distinguishable in every report that reads these columns.

alter table order_group
  add column pack_applied_paise bigint not null default 0;

alter table order_group drop constraint if exists order_group_payable_arithmetic;
alter table order_group add constraint order_group_payable_arithmetic check (
  payable_paise = subtotal_paise + tax_total_paise
                  - discount_paise - wallet_applied_paise - pack_applied_paise
);

alter table order_group add constraint order_group_pack_applied_non_negative
  check (pack_applied_paise >= 0);

-- A pack PURCHASE cannot itself be paid with a pack. Obvious, and cheap to make impossible.
alter table order_group add constraint order_group_purchase_pays_real_money check (
  kind <> 'meal_pack_purchase' or pack_applied_paise = 0
);

comment on column order_group.pack_applied_paise is
  'Value settled by redeeming meals from a pack (E21). Deliberately NOT discount_paise — nothing '
  'was discounted, it was prepaid — and not wallet_applied_paise, which is a different liability.';

-- ---------------------------------------------------------------------------------------------
-- 2. Only Andy configures packs. Platform scope only. `E21-27`.
-- ---------------------------------------------------------------------------------------------
--
-- Andy: *"A new permission at platform scope only. Not kitchen, not support, not a school-scoped
-- grant."* `valid_scope_types` is the enforcement — `grant_permission` refuses a scope outside it,
-- so a school-scoped grant of this permission cannot be created even by someone with the rights to
-- grant things.

insert into permission (code, category, display_name, description, is_sensitive, valid_scope_types)
values (
  'meal_packs.manage',
  'meal_packs',
  'Configure meal packs',
  'Create, price, activate and withdraw meal pack offers, and choose which schools are offered '
  'them. Platform scope ONLY — a meal pack is money taken before food is served, so this is not '
  'delegable to a school, a kitchen or support.',
  true,
  '{platform}'
)
on conflict (code) do update
  set valid_scope_types = excluded.valid_scope_types,
      is_sensitive      = excluded.is_sensitive,
      description       = excluded.description;

-- Back-office visibility of offers, including INACTIVE ones. The `anon`/`authenticated` policy
-- from 0068 shows active offers to everyone — that is the shop window. This is the workshop, and
-- an offer that is not yet live is only visible to someone holding the platform permission.
create policy meal_pack_offer_read_backoffice on meal_pack_offer
  for select to authenticated
  using (auth_can('meal_packs.manage', 'platform', null));

create policy meal_pack_offer_school_read_backoffice on meal_pack_offer_school
  for select to authenticated
  using (auth_can('meal_packs.manage', 'platform', null));

-- ---------------------------------------------------------------------------------------------
-- 3. Is there any pack surface at all for this school? `E21-28`.
-- ---------------------------------------------------------------------------------------------
--
-- Andy: *"if no offer is live for that school, the parent sees an app with no such concept.
-- Default off everywhere."*
--
-- One server-side answer, so the app never decides for itself and never has to be trusted to.
-- Both halves must be true: the offer is active AND this school is switched on. Absence of a row
-- is off, so a school added tomorrow sells nothing until somebody says otherwise.

create or replace function meal_packs_available_at(p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from meal_pack_offer o
      join meal_pack_offer_school os on os.offer_id = o.id
     where os.school_id = p_school_id
       and os.is_enabled
       and o.is_active
  );
$$;

/**
 * The offers a parent at this school may actually see.
 *
 * `security definer`, and there is no customer-plane policy on `meal_pack_offer` at all — see the
 * note in `0068`. The distinction is the point: with a table policy the app decides what to ask
 * for and the database only checks it is permitted, so a bug in the app is a bug in what a parent
 * sees. Here the DATABASE decides what exists for that school, and there is no query the app can
 * write to see more. Andy: *"Only I can create or see offers."*
 *
 * Returns nothing at all when packs are off, which is what makes "the parent sees an app with no
 * such concept" enforceable rather than a convention the UI is trusted to follow.
 */
create or replace function meal_pack_offers_for_school(p_school_id uuid)
returns table (
  id uuid, name text, meals_count int, items_per_meal int,
  required_category_id uuid, net_price_paise bigint,
  alacarte_reference_paise bigint, validity_days int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.id, o.name, o.meals_count, o.items_per_meal,
         o.required_category_id, o.net_price_paise,
         o.alacarte_reference_paise, o.validity_days
    from meal_pack_offer o
    join meal_pack_offer_school os on os.offer_id = o.id
   where os.school_id = p_school_id
     and os.is_enabled
     and o.is_active
   order by o.meals_count;
$$;

comment on function meal_pack_offers_for_school is
  'The only way a parent sees offers (E21-27/E21-28). No customer-plane policy exists on '
  'meal_pack_offer, so this function is the whole surface and it applies the school gate itself.';

comment on function meal_packs_available_at is
  'Whether a parent at this school may see ANY pack surface (E21-28). The app renders nothing '
  'pack-related when this is false — no tab, no menu entry, not even an empty state. Default off: '
  'it needs an active offer AND an enabled school row, and absence of a row is off.';

commit;

-- ---------------------------------------------------------------------------------------------
-- 4. The nightly integrity check learns the two new liability types
-- ---------------------------------------------------------------------------------------------
--
-- `assert_ledger_integrity` keeps its OWN copy of the account-type-to-normal-balance mapping,
-- deliberately: it exists to catch the constraint in `0013`/`0035` having been dropped, so reading
-- the constraint would defeat the point. The cost is that a new account type must be taught to
-- both, and `0068` taught only the constraint — which made the nightly check report two perfectly
-- correct accounts as broken.
--
-- Found by `ledger.test.sql` failing, which is the test doing exactly its job.

CREATE OR REPLACE FUNCTION public.assert_ledger_integrity()
 RETURNS TABLE(check_name text, failures bigint, detail text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Every transaction's debits and credits cancel.
  select 'transaction_balances'::text,
         count(*)::bigint,
         'ledger_transaction rows whose entries do not sum to zero'::text
    from (
      select e.transaction_id
        from ledger_entry e
       group by e.transaction_id
      having sum(case when e.direction = 'debit' then e.amount_paise else -e.amount_paise end) <> 0
    ) bad

  union all

  -- Double-entry means at least two entries. One entry that happens to sum to zero is
  -- impossible (amounts are positive), but a transaction with NO entries is not.
  select 'transaction_has_entries',
         count(*)::bigint,
         'ledger_transaction rows with fewer than two entries'
    from (
      select t.id
        from ledger_transaction t
        left join ledger_entry e on e.transaction_id = t.id
       group by t.id
      having count(e.id) < 2
    ) bad

  union all

  -- The constraint in §2 enforces this going forward; this catches it having been dropped.
  select 'account_normal_balance',
         count(*)::bigint,
         'ledger_account rows whose normal_balance disagrees with their account_type'
    from ledger_account a
   where not (
     -- `E21`: deferred_revenue and deferred_tax are LIABILITIES — money held against something
     -- still owed — so both run credit. The nightly check carries its own copy of this mapping
     -- on purpose (it is the backstop for the constraint being dropped), which means a new
     -- account type has to be taught to BOTH or the check reports a healthy ledger as broken.
     (a.account_type in ('wallet','payable','tax_payable','revenue',
                         'deferred_revenue','deferred_tax') and a.normal_balance = 'credit')
     or
     (a.account_type in ('receivable','provider_clearing','provider_fees','suspense','bank')
        and a.normal_balance = 'debit')
   )

  union all

  -- Two independently maintained things, compared. I8 / [DM-04].
  select 'wallet_matches_ledger',
         count(*)::bigint,
         'wallet_balance rows that disagree with the ledger'
    from wallet_balance w
    join ledger_account a
      on a.owner_type = 'user' and a.owner_id = w.user_id and a.account_type = 'wallet'
   where w.balance_paise <> ledger_balance(a.id)

  union all

  -- A wallet is a liability: it may be zero, never negative. Cheap, and it is the one
  -- that turns into a support conversation about money that does not exist.
  select 'wallet_never_negative',
         count(*)::bigint,
         'user wallet accounts with a negative balance'
    from ledger_account a
   where a.account_type = 'wallet' and ledger_balance(a.id) < 0;
$function$

;
