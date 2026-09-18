-- `paid_at` arrives one statement too late. `E21-104`, and it is `0094` being wrong.
--
-- **Numbered 0096, not 0095.** The web thread took `0095` for `the_kitchen_can_see_who_ordered`
-- and merged first, so this renumbered — the same rule the decision-id collisions settled on. It
-- was caught by `gh pr merge` refusing a branch that was behind, and it had already done damage:
-- this migration was applied to STAGING and recorded as `0095` before the collision existed, so
-- staging's ledger claimed `0095` was done while the SQL that had actually run under that number
-- was this file. A `db push` would have skipped the kitchen migration and said nothing. The ledger
-- was re-pointed to `0096` after verifying both halves — this function present, their view absent —
-- and `0095` left unapplied and unrecorded for them, which is the truthful state.
--
-- Andy re-walked staging after `0094` and got the identical symptom: stuck on "Still confirming",
-- cart not emptied, balance unchanged. Two orders, `GB-0RH40X` and `GB-7A0ER1`, both with
-- `order.status = 'paid'`, a pickup code, `payable_paise = 0`, `pack_applied_paise > 0`,
-- `paid_at` set — and **`order_group.status = 'draft'`**, exactly as before the fix.
--
-- ## Why `0094` did not fire, and it is a one-line reason
--
-- `G1a` required `paid_at is not null`. `create_checkout`'s zero-cash branch writes in this order:
--
-- ```sql
--   for v_order in select id from "order" where order_group_id = v_group_id loop
--     perform confirm_order_as_paid(v_order.id);        -- (1) fires derive_order_group_status
--   end loop;
--   update order_group set paid_at = now() ...;         -- (2) paid_at is written HERE
-- ```
--
-- The derivation runs at **(1)**, as an `after update of status on "order"` trigger. At that
-- instant `paid_at` is still null, so `v_pack_settled` was false, `G1a` missed, and the `else`
-- returned `draft` — the same answer as before `0094` existed. Step **(2)** then writes `paid_at`
-- and re-derives nothing, because the derivation is not a trigger on `order_group`.
--
-- `0094`'s own comment asserted the opposite in as many words: *"`create_checkout` writes it in the
-- same transaction that confirms the redemptions and the orders, so it … arrives at exactly the
-- same moment."* Same transaction is true. **Same moment is not**, and a trigger sees statements,
-- not transactions. That distinction is the whole defect.
--
-- ## Why the test passed anyway — the part worth keeping
--
-- `meal_packs.test.sql` §16 seeded `paid_at` **at insert time**, then transitioned the order. That
-- is the real sequence backwards, so the fixture handed `G1a` a stamp the product does not have
-- yet. Every assertion was green against a state `create_checkout` cannot produce.
--
-- It is worse than a gap. Because the fixture stamped first, `G1a` fired while the order was still
-- `pending_payment`, and that made an assertion fail — so a **`v_pending = 0` condition was added
-- to satisfy a fixture that was itself wrong**. A test modelling the subject instead of driving it
-- did not merely miss the bug; it shaped the fix around its own mistake.
--
-- The replacement drives `create_checkout` itself (`checkout.test.sql` §11). There is no order for
-- a fixture to get wrong, because the function under test writes it.
--
-- ## The fix: stop asking for the stamp
--
-- `paid_at` was never the evidence. It is a second record of something the orders already say, and
-- it is the one that arrives late. What is true at step (1) — and is what settlement *means* for a
-- group nothing was charged for — is:
--
--   * the group owed nothing in cash and a pack paid for it (`payable_paise = 0`,
--     `pack_applied_paise > 0`), and
--   * its orders have been confirmed (`v_beyond_draft > 0`, `v_pending = 0`, `v_cancelled = 0`).
--
-- `confirm_order_as_paid` is the only way an order reaches `paid`, and for a zero-payable pack
-- group there is no webhook that could call it later. So orders being `paid` **is** the settlement,
-- observed directly rather than through a stamp written afterwards.
--
-- `v_pending = 0` keeps its place and now earns it honestly: it is what stops a group being called
-- paid between `create_checkout` writing its orders and confirming them. It was the right guard
-- for the wrong reason, and it is still the right guard.
--
-- Renamed `v_pack_covered`, because "settled" was the claim that turned out to be unverified.

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
  -- `E21-104`. Read from the group's money alone. NOT `paid_at` — see the header: that column is
  -- written one statement after the trigger that would read it.
  v_pack_covered boolean;
  v_status       order_group_status;
begin
  v_group := coalesce(new.order_group_id, old.order_group_id);
  if v_group is null then return null; end if;

  -- Serialises a capture and a refund arriving together; without it the later write wins by
  -- accident rather than by rule. `select … into` rather than `perform`, so the same locking read
  -- also yields the two columns `G1a` needs.
  select (og.payable_paise = 0 and og.pack_applied_paise > 0)
    into v_pack_covered
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
      -- G1a (`E21-101`, corrected by `E21-104`) — a pack paid for the whole cart, so there is no
      -- capture to find and no stamp to wait for. The orders being confirmed IS the settlement:
      -- `confirm_order_as_paid` is the only route to `paid`, and a zero-payable pack group has no
      -- webhook that could call it later.
      --
      -- All three order conditions are load-bearing. `v_pending = 0` stops a group being called
      -- paid between `create_checkout` writing its orders and confirming them; `v_cancelled = 0`
      -- stops a cancelled order — whose items `0089` has given back — still reading paid;
      -- `v_beyond_draft > 0` is what G1 already implies and is kept so the case reads on its own.
      when v_pack_covered and v_beyond_draft > 0 and v_pending = 0 and v_cancelled = 0 then 'paid'
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
  'L1 / §5: order_group.status is DERIVED, never written directly. First match wins. G6 above G7 so a completed partial refund shows as partially_refunded; G3 above G4 so an all-cancelled group whose members carry payment_failed derives to payment_failed (E06-30). G1a is the settlement that moves no money — a pack covering a whole cart produces no payment row, so every money-keyed case missed and the else returned draft, which made checkout-status answer unpaid for ever, so the confirmation never showed and the cart never cleared. E21-104 corrects E21-101: G1a must NOT read order_group.paid_at, because create_checkout writes that column one statement AFTER confirming the orders, and this trigger fires on the order. The orders being confirmed is the evidence. M16, fourth instance.';

-- ---------------------------------------------------------------------------
-- The two groups from Andy's re-walk, and any like them. Re-derived rather than written by hand
-- — `L1` forbids setting this column directly, and a migration is not an exemption.
--
-- `update … set status = status` on the member orders fires `after update of status on "order"`,
-- which is the derivation. Scoped to exactly the disagreement described above; on production it
-- matches nothing, because there are no pack-covered orders there.
-- ---------------------------------------------------------------------------
update "order" o
   set status = o.status
 where exists (
   select 1 from order_group g
    where g.id = o.order_group_id
      and g.kind = 'food'
      and g.payable_paise = 0
      and g.pack_applied_paise > 0
      and g.status = 'draft'
 );

commit;
