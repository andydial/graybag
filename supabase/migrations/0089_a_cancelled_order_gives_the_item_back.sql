-- A cancelled order returns its pack items. `E21-79`, decision `P24`.
--
-- Andy, 2026-09-16: the item comes back. "No refunds, ever" is a rule about the **pack**, not
-- about a cancelled order — and cash orders already refund on cancellation before cutoff
-- (`E06-45`), so forfeiting the item would be a second, harsher set of rules for a parent to
-- learn about the same act.
--
-- ## Why a trigger rather than an edit to `cancel_order`
--
-- There is more than one way an order is cancelled, and they live in different threads' files:
--
--   * `cancel_order()` — the parent, before cutoff (`E06-45`);
--   * `abandon_checkout()` — an unpaid group the parent walked away from (`E05-51`);
--   * `kitchen-order-status` — the kitchen or an operator (`E09-38`), which is WEB's.
--
-- Editing each one means three places to keep in step and a fourth that is somebody else's file.
-- A trigger on the status transition catches all of them, including any route added later, and
-- cannot be forgotten by whoever adds it. The same argument `derive_group_status` already makes
-- for group status.
--
-- ## Held and confirmed are different events with different answers
--
-- A `held` reservation is RELEASED: the payment never happened, the balance never moved, and the
-- hold simply goes back. Nothing is posted anywhere.
--
-- A `confirmed` redemption is REVERSED: the balance moved and revenue was recognised, so both are
-- undone, in the same transaction, by exactly the valued/bonus split recorded on the row. Reading
-- the split back rather than recomputing it is what stops a cancellation turning a free bonus item
-- into a paid one.

begin;

create or replace function return_meal_pack_items_on_cancellation()
returns trigger
language plpgsql
as $$
begin
  -- Confirmed redemptions on THIS order: the balance moved, so give it back and reverse the
  -- recognition. Returns 0 and posts nothing for an order that never drew on a pack, which is
  -- what lets this run unconditionally on every cancellation in the system.
  perform reverse_meal_pack_redemptions(
    new.id,
    coalesce(new.cancel_reason_code::text, 'cancelled'),
    new.correlation_id
  );

  -- Held reservations on this order's GROUP: the payment never came, so the hold goes back. Kept
  -- separate from the reversal above because they are different events — one undoes money that
  -- moved, the other undoes a promise that never became money — and collapsing them would mean
  -- posting a ledger entry for a balance that never changed.
  perform release_meal_pack_reservations(new.order_group_id, 'order_cancelled');

  return null;
end;
$$;

create trigger trg_return_meal_pack_items_on_cancellation
  after update of status on "order"
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function return_meal_pack_items_on_cancellation();

comment on function return_meal_pack_items_on_cancellation is
  'P24: a cancelled order returns its pack items. A trigger rather than an edit to cancel_order, '
  'because three different functions in two threads'' files cancel orders and a fourth will be '
  'added — this catches all of them, and cannot be forgotten by whoever adds the next one.';

commit;
