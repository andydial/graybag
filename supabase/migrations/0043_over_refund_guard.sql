-- =============================================================================
-- 0043_over_refund_guard.sql — two admins refunding the same order. `E06-21`.
-- =============================================================================
--
-- `docs/data-model.md` §8.3 states this guard as "Σ `refund.amount_paise` for a group must not
-- exceed the captured amount", which §7.3 of the lifecycle calls wrong in both directions: it
-- counts `failed` refunds (so two failed attempts block the third, legitimate one) and it
-- ignores in-flight ones (so two admins refunding at once both pass).
--
-- **The implementation was already half right.** `trg_assert_refund_not_over_captured` sums
-- `status <> 'failed'`, which is the correct set. So the arithmetic defect §8.3 describes does
-- not exist in the database — only in the document, which is corrected in this change.
--
-- **The race does exist**, and that is what this migration fixes.
--
-- =============================================================================
-- WHY DEFERRED-AT-COMMIT IS NOT ENOUGH ON ITS OWN
-- =============================================================================
--
-- The trigger is `DEFERRABLE INITIALLY DEFERRED`, so it fires at COMMIT rather than at INSERT.
-- That is right and it is not sufficient. Two concurrent transactions each insert a full refund
-- and each reaches its commit-time check; under `READ COMMITTED` neither can see the other's
-- uncommitted row, so **both sum the same total, both pass, and both commit**. The order is
-- refunded twice and the guard reports nothing.
--
-- Taking the `order_group` row lock **first** serialises them. The second transaction blocks
-- until the first commits, then re-reads and sees a total that now includes it. One passes, one
-- raises. The lock is on `order_group` rather than on the refund rows because there is no refund
-- row to lock — the whole problem is a row that does not exist yet.
--
-- =============================================================================
-- A DUPLICATE CAPTURE COUNTS TOWARD THE REFUNDABLE AMOUNT, DELIBERATELY
-- =============================================================================
--
-- Since `[OL-05]`/`0036` a group may carry a second `captured` payment marked as a duplicate.
-- The `captured` sum below includes it, and that is correct rather than an oversight: the
-- customer really was charged twice, that money is really refundable, and `E06-18`'s job is to
-- refund exactly it. A guard that excluded duplicates would refuse the one refund that must
-- always succeed.
-- =============================================================================

create or replace function trg_assert_refund_not_over_captured() returns trigger
language plpgsql
as $$
declare
  v_group    uuid := new.order_group_id;
  v_captured bigint;
  v_refunded bigint;
begin
  -- **First, and the whole point of this revision.** Serialises two concurrent refunds of the
  -- same group; without it both read the same total and both pass. `perform` because the row's
  -- contents are irrelevant — only the lock matters.
  perform 1 from order_group where id = v_group for update;

  -- Includes a capture marked as a duplicate ([OL-05]): the customer was charged twice, that
  -- money is refundable, and E06-18 exists to refund exactly it.
  select coalesce(sum(amount_paise), 0) into v_captured
    from payment where order_group_id = v_group and status = 'captured';

  -- `pending`, `processing` and `completed`. Spelled out rather than `<> 'failed'`: the two are
  -- the same set today, and if a status is ever added the explicit list refuses to include it
  -- until somebody decides, which is the direction that fails safely.
  select coalesce(sum(amount_paise), 0) into v_refunded
    from refund
   where order_group_id = v_group
     and status in ('pending', 'processing', 'completed');

  if v_refunded > v_captured then
    raise exception 'refunds for order_group % total % paise but only % paise were captured',
      v_group, v_refunded, v_captured
      using errcode = 'check_violation', hint = 'over_refund';
  end if;

  return null;
end;
$$;

comment on function trg_assert_refund_not_over_captured() is
  'E06-21 / §7.3. Sums refunds at pending, processing AND completed — failed is excluded, because a failed attempt must not block the legitimate retry, and in-flight ones are included, because otherwise two admins refunding at once both pass. Takes the order_group row lock FIRST: the trigger is deferred to COMMIT, which is necessary and not sufficient — under READ COMMITTED two concurrent transactions cannot see each other''s uncommitted refunds, so without the lock both sum the same total and both commit. A duplicate capture counts toward the refundable amount on purpose ([OL-05]): the customer really was charged twice.';
