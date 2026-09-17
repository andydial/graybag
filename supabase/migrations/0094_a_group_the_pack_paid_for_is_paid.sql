-- A group the pack paid for says it is paid. `E21-101`.
--
-- Andy, walking staging 2026-09-17: *"The cart doesn't empty after a pack-covered order. I placed
-- the order, it succeeded, and the items were still sitting in the cart."* He asked the right
-- question with it — *"check whether that's a pack-specific path or whether the ₹0 route skips the
-- same clear step the paid route takes"* — and the answer is **neither**.
--
-- ## What the data said
--
-- `GB-947XS0` on staging: `order.status = 'delivered'`, `pickup_code` allocated, delivery email
-- sent, `pack_applied_paise = 19800`, `payable_paise = 0`, `paid_at` set, **zero `payment` rows**.
-- And `order_group.status = 'draft'`.
--
-- ## Why the cart survived an order that worked perfectly
--
-- The ₹0 route does not skip the clear step. It reaches **exactly** the same one a cash order
-- reaches — `shouldClearCart(result.status)` in the poll — and can never satisfy it, because the
-- status it tests comes from `checkout-status`, which answers from `order_group.status`, which is
-- derived here. So:
--
--   1. `derive_order_group_status` computes `v_captured` from `payment where status = 'captured'`.
--      A pack redemption captures nothing, so `v_captured = 0`.
--   2. The order is past `draft`, so `G1` misses; nothing is pending, cancelled or refunded, so
--      `G2`–`G6` miss; `G7` needs `v_captured > 0`, so it misses too.
--   3. The `else` — the safe default, doing exactly its job — returns **`draft`**.
--   4. `checkout-status` reads `draft`, finds no payment rows to reconcile, and answers `unpaid`.
--   5. The client treats only `paid`, `failed` and `cancelled` as terminal. `unpaid` is none of
--      them, so it polls for ever: no confirmation screen, no `clearCart()`, no `payment_completed`.
--
-- **Money was the only evidence this function accepted that a group had been settled**, and a pack
-- redemption is a settlement that moves none. That is the whole defect.
--
-- ## `M16`, fourth instance — and the first on the food side
--
-- A derived status whose derivation cannot see the thing that actually changed. `E21-94` was this
-- for `kind = 'meal_pack_purchase'`; this is the same sentence for `kind = 'food'` with a pack
-- covering it. The pattern note in `M16` said the fix is to give the rule an owner that fires on
-- the thing that actually changes — so this widens the **evidence**, and does not add a second
-- writer.
--
-- ## Why here and not in `create_checkout`
--
-- `L1` is explicit: *"order_group.status is DERIVED, never written directly — two independently
-- maintained statuses describing the same money disagree, and the one nobody watches is the one
-- that goes wrong."* Setting the status from `create_checkout` would make it two. The function that
-- owns the field is the only correct place to teach it what settlement looks like.
--
-- ## What changes, and what deliberately does not
--
-- One new case, `G1a`, between `G1` and `G2`. It fires only when **the group owed nothing in cash,
-- a pack paid for it, and it has been marked paid** — all three, read from the group's own row:
--
--   * `payable_paise = 0` — a partly covered cart has a real payable, a real Razorpay order and a
--     real capture, so it already derives correctly and is untouched by this.
--   * `pack_applied_paise > 0` — distinguishes a pack-covered group from a free order arriving by
--     some other route that has not been designed yet. Without it this case would quietly claim
--     any zero-payable group.
--   * `paid_at is not null` — the settlement stamp. `create_checkout` writes it in the same
--     transaction that confirms the redemptions and the orders, so it is exactly as trustworthy as
--     a capture and arrives at exactly the same moment.
--
-- `G5` and `G6` stay keyed on `v_captured`, deliberately: they are about refunds, a pack group has
-- none, and a refund path for redeemed items does not exist to model yet. Widening them would be
-- inventing behaviour rather than describing it.
--
-- **Nothing about the cash path moves.** Every existing case keeps its condition and its order, and
-- `G1a` cannot fire for a group with a payable — which every cash order has.

begin;

create or replace function derive_order_group_status() returns trigger
language plpgsql
as $$
declare
  v_group        uuid;
  v_captured     bigint;
  v_refunded     bigint;
  v_members      int;
  v_draft        int;
  v_beyond_draft int;
  v_pending      int;
  v_cancelled    int;
  v_failed_reason int;
  v_closed       int;
  -- `E21-101`. The group's own settlement evidence, for the case where no money moved.
  v_pack_settled boolean;
  v_status       order_group_status;
begin
  v_group := coalesce(new.order_group_id, old.order_group_id);
  if v_group is null then return null; end if;

  -- Serialises a capture and a refund arriving together; without it the later write wins by
  -- accident rather than by rule. `select … into` rather than `perform`, so the same lock read
  -- also yields the three columns `G1a` needs — one row read, not two.
  select (og.payable_paise = 0 and og.pack_applied_paise > 0 and og.paid_at is not null)
    into v_pack_settled
    from order_group og where og.id = v_group for update;

  select coalesce(sum(amount_paise) filter (where status = 'captured'), 0)
    into v_captured from payment where order_group_id = v_group;

  -- `completed` only. An in-flight refund has not moved money yet, and calling a group
  -- `refunded` before the money has gone is the kind of claim a customer reads and acts on.
  select coalesce(sum(amount_paise) filter (where status = 'completed'), 0)
    into v_refunded from refund where order_group_id = v_group;

  select count(*),
         count(*) filter (where status = 'draft'),
         count(*) filter (where status <> 'draft'),
         count(*) filter (where status = 'pending_payment'),
         count(*) filter (where status = 'cancelled'),
         count(*) filter (where status = 'cancelled' and cancel_reason_code = 'payment_failed'),
         count(*) filter (where status in ('cancelled', 'refunded'))
    into v_members, v_draft, v_beyond_draft, v_pending, v_cancelled, v_failed_reason, v_closed
    from "order" where order_group_id = v_group;

  if v_members = 0 then
    return null;                                   -- nothing to derive from yet
  end if;

  v_status :=
    case
      -- G1
      when v_draft > 0 and v_beyond_draft = 0 then 'draft'
      -- G1a (`E21-101`) — a pack paid for the whole cart, so there is no capture to find.
      --
      -- Above G2 because a settled pack group has no pending orders for G2 to describe, and below
      -- G1 because a group whose orders are all still drafts has not been placed whatever stamps
      -- it carries.
      --
      -- **`v_pending = 0` and `v_cancelled = 0` are both load-bearing, and the first was added
      -- because the test caught its absence.** Without it a group carrying `paid_at` derived to
      -- `paid` while its orders were still `pending_payment` — a state `create_checkout` cannot
      -- produce today (it stamps and confirms in one transaction) but which any future path that
      -- stamped first would reach, and "paid" over an unconfirmed order is the whole family of
      -- bug this migration is in. Without the second, a cancelled pack order — whose items have
      -- been given back by `0089` — would still read `paid`.
      when v_pack_settled and v_beyond_draft > 0 and v_pending = 0 and v_cancelled = 0 then 'paid'
      -- G2
      when v_captured = 0 and v_pending > 0 then 'pending_payment'
      -- G3 — above G4 deliberately. This is what makes `payment_failed` reachable at all.
      when v_captured = 0 and v_cancelled = v_members and v_failed_reason = v_members
        then 'payment_failed'
      -- G4
      when v_captured = 0 and v_cancelled = v_members then 'cancelled'
      -- G5
      when v_captured > 0 and v_refunded = v_captured and v_closed = v_members then 'refunded'
      -- G6 — above G7 deliberately. Money came back, and the order list must say so.
      when v_captured > 0 and v_refunded > 0 then 'partially_refunded'
      -- G7
      when v_captured > 0 then 'paid'
      else 'draft'
    end;

  update order_group set status = v_status, updated_at = now()
   where id = v_group and status is distinct from v_status;

  return null;
end;
$$;

comment on function derive_order_group_status() is
  'L1 / §5: order_group.status is DERIVED, never written directly — two independently-maintained statuses describing the same money disagree, and the one nobody watches is the one that goes wrong. First match wins. G6 sits above G7 so a completed partial refund shows as partially_refunded even while most of the group is still to be delivered; G3 sits above G4 so an all-cancelled group whose members carry payment_failed derives to payment_failed rather than cancelled, which is the whole of E06-30 — without it, payment_failed is a status the product cannot reach. G1a (E21-101) is the settlement that moves no money: a pack covering a whole cart produces no payment row, so every money-keyed case missed and the else returned draft — which made checkout-status answer unpaid for ever, so the confirmation never showed and the cart never cleared. M16, fourth instance.';

-- ---------------------------------------------------------------------------
-- The groups already in this state, reconciled by re-running the derivation rather than by
-- writing the status by hand — which would be the exact thing `L1` forbids, in a migration.
--
-- Touching `updated_at` on the member orders fires `derive_group_status`... it does not: the
-- trigger is `after insert or update OF status, cancel_reason_code`. So the derivation is invoked
-- directly instead, through a no-op status write that sets the column to what it already holds.
-- `update … set status = status` does fire an `update of status` trigger.
--
-- Scoped to exactly the disagreement this migration describes. On production it matches nothing:
-- there are no pack-covered orders there at all.
-- ---------------------------------------------------------------------------
update "order" o
   set status = o.status
 where exists (
   select 1 from order_group g
    where g.id = o.order_group_id
      and g.kind = 'food'
      and g.payable_paise = 0
      and g.pack_applied_paise > 0
      and g.paid_at is not null
      and g.status = 'draft'
 );

commit;
