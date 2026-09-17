-- A paid pack purchase says it is paid. `E21-94`.
--
-- Found on staging, 2026-09-17, while diagnosing why a bought pack did not appear: the purchase
-- group had `paid_at` set and `status = 'pending_payment'`, and would have stayed that way for
-- ever.
--
-- ## Why nothing moved it
--
-- `derive_group_status` owns a group's status, and it is a trigger **on `order`** — it fires when
-- a member order changes and recomputes the group from its orders. That is correct for food and
-- silent for packs, because **a meal pack purchase has no member orders**: `assert_order_group_totals`
-- refuses one that does. `settle_payment` sets `paid_at` and nothing sets `status`, so the two
-- fields disagree from the moment the money arrives.
--
-- ## The third instance of one pattern — see `M16`
--
-- Andy, 2026-09-17: *"it's the third instance of the same family — a money row whose status
-- fields disagree because nothing owns moving them."* He is right, and the three are worth
-- listing because the shape is the lesson, not any one of them:
--
--   1. `E21-65` — an order reached `paid` only inside one webhook loop, so a redemption inserted
--      afterwards stayed `pending_payment` and the kitchen never saw it.
--   2. Found while mutation-checking that fix — `derive_group_status` demoted a settled group
--      back to `pending_payment` when a later order was added to it, while `paid_at` stayed set.
--   3. This one — a pack purchase whose status nothing owns at all.
--
-- Every one is the same mistake: **a derived field whose derivation is attached to a table that
-- is not always involved.** The fix each time is to give the rule an owner that fires on the
-- thing that actually changes.
--
-- ## So this is a trigger, not a line in `settle_payment`
--
-- Editing `settle_payment` would fix today's caller and leave the next one to remember. A trigger
-- on `order_group.paid_at` fires for **any** path that marks a pack purchase paid — today's, and
-- the refund or admin correction nobody has written yet — which is the same argument
-- `derive_group_status` makes for food, applied to the case it cannot see.
--
-- BEFORE, so it writes `new.status` rather than issuing a second UPDATE: no recursion, no second
-- trigger pass, and the row is only ever written once.

begin;

create or replace function derive_pack_group_status()
returns trigger
language plpgsql
as $$
begin
  -- Food groups are `derive_group_status`'s, and it is better at the job: it reads every member
  -- order and handles cancellation and refunds. Touching them here would give one field two
  -- owners, which is how they come to disagree in the first place.
  if new.kind is distinct from 'meal_pack_purchase' then
    return new;
  end if;

  -- Only the transition INTO paid, and only from a state that has not moved past it. A cancelled
  -- or refunded purchase must not be dragged back to `paid` by a later touch of the row.
  if new.paid_at is not null and new.status = 'pending_payment' then
    new.status := 'paid';
  end if;

  return new;
end;
$$;

create trigger trg_derive_pack_group_status
  before insert or update of paid_at, status on order_group
  for each row execute function derive_pack_group_status();

comment on function derive_pack_group_status is
  'E21-94. A meal pack purchase has no member orders, so derive_group_status — a trigger on '
  '`order` — never fires for one and its status stayed pending_payment while paid_at was set. '
  'BEFORE rather than AFTER so it writes new.status directly: one write, no recursion. M16 '
  'records the pattern, of which this is the third instance.';

-- The purchase already on staging, and any like it. Scoped to exactly the disagreement this
-- migration is about: a pack purchase that has been paid for and does not say so. It touches no
-- food group and no unpaid group, and on production it matches nothing at all — there are zero
-- pack purchases there.
update order_group
   set status = 'paid'
 where kind = 'meal_pack_purchase'
   and paid_at is not null
   and status = 'pending_payment';

commit;
