-- =============================================================================
-- 0044_group_status_derivation.sql — `order_group.status` is derived. `L1`, §5, `E06-30`.
-- =============================================================================
--
-- `L1`: **`"order"` is the state machine; `order_group.status` is derived by trigger and is
-- never written directly by an Edge Function.** Two independently-written statuses describing
-- the same money disagree, and the one nobody is looking at is the one that goes wrong.
--
-- The derivation did not exist. `order_group.status` had a default and nothing maintained it, so
-- every group has read `draft` since `0001` regardless of what its orders were doing — and
-- `payment_failed`, `partially_refunded` and `refunded` were unreachable at the group level
-- entirely.
--
-- =============================================================================
-- FIRST MATCH WINS, AND TWO OF THE ORDERINGS ARE LOAD-BEARING
-- =============================================================================
--
-- §5's seven rules in order. Two are worth stating because they look like bugs:
--
-- **G6 above G7.** A group with a completed partial refund is `partially_refunded` even though
-- most of it is still going to be delivered. The kitchen does not read this status; the
-- customer's order list and the reconciliation report do, and both need to know money came back.
--
-- **G3 above G4.** A group whose members were all cancelled with `payment_failed` derives to
-- `payment_failed`; any other all-cancelled group derives to `cancelled`. This is the whole of
-- `E06-30`: without the split, every swept checkout would carry `checkout_expired`, G3 could
-- never match, and `payment_failed` would be a status the product could not reach. §10.4 already
-- describes the sweeper writing the two codes apart — this is the half that reads them.
--
-- =============================================================================
-- WHY THE LOCK, AND WHY AFTER
-- =============================================================================
--
-- `AFTER`, because the derivation must see the row that caused it. The group row is locked
-- first: a capture and a refund landing on the same group at the same moment would otherwise
-- both read the pre-state and the later write would win by accident rather than by rule.
--
-- It fires on `"order"`, `payment` and `refund`, because all three change the answer.
-- =============================================================================

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
  v_status       order_group_status;
begin
  v_group := coalesce(new.order_group_id, old.order_group_id);
  if v_group is null then return null; end if;

  -- Serialises a capture and a refund arriving together; without it the later write wins by
  -- accident rather than by rule.
  perform 1 from order_group where id = v_group for update;

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
  'L1 / §5: order_group.status is DERIVED, never written directly — two independently-maintained statuses describing the same money disagree, and the one nobody watches is the one that goes wrong. First match wins. G6 sits above G7 so a completed partial refund shows as partially_refunded even while most of the group is still to be delivered; G3 sits above G4 so an all-cancelled group whose members carry payment_failed derives to payment_failed rather than cancelled, which is the whole of E06-30 — without it, payment_failed is a status the product cannot reach.';

create or replace trigger derive_group_status
  after insert or update of status, cancel_reason_code on "order"
  for each row execute function derive_order_group_status();

create or replace trigger derive_group_status
  after insert or update of status on payment
  for each row execute function derive_order_group_status();

create or replace trigger derive_group_status
  after insert or update of status on refund
  for each row execute function derive_order_group_status();
