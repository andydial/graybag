-- =============================================================================
-- 0041_migration_actor_transitions.sql — `E16-49`, half two. The narrowest exemption I can write.
-- =============================================================================
--
-- `0040` added the `migration` actor. This gives it the two transitions the Bubble import
-- actually needs and nothing else, and then makes even those unusable outside the import.
--
-- ## Only two states, because only two exist
--
-- `docs/bubble-recon-findings.md` §8 counted the legacy statuses: **281 `Paid`, 2 `Cancelled`,
-- 78 `Draft` — and the drafts are explicitly not migrated.** So the exemption is
-- `INSERT → paid` and `INSERT → cancelled`. `delivered` and `refunded` are deliberately absent:
-- no legacy order is in either, and an exemption sized for states that do not exist is an
-- exemption somebody will find a use for.
--
-- ## INSERT only
--
-- A migration actor can create history. It can never *move* a live order — there is no
-- `UPDATE` row for it anywhere in the table, so `migration` cannot cancel a real customer''s
-- lunch, mark one delivered, or touch anything that already exists.
--
-- ## And it may only write rows carrying a legacy id
--
-- This is the part that answers "impossible to use outside the import". Setting
-- `app.actor_type = 'migration'` is not enough: the row itself must have a
-- `legacy_bubble_id`. A new order has none and never will, so **the actor and the data have to
-- agree**, and only the importer holds data that satisfies both. Someone who wanted to abuse
-- this would have to invent a Bubble id and write it onto a real order, at which point they
-- have left a permanent, greppable marker on the row saying exactly what they did.
--
-- `migration_source = 'bubble_migrated'` on the `app_user` side already does the same job for
-- accounts (`0018`), so imported rows stay distinguishable for ever on both halves.
--
-- Regenerated from `pg_get_functiondef()` with two table rows and one guard added, and asserted
-- to differ in nothing else — the same discipline `0033`, `0035`, `0037` and `0039` use.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.assert_order_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_actor actor_type;
begin
  -- Not a transition. Other columns may change freely — this trigger is about status and only
  -- status, and firing on every update would make it the gatekeeper for the whole table.
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;

  v_actor := nullif(current_setting('app.actor_type', true), '')::actor_type;
  if v_actor is null then
    raise exception 'order status change with no app.actor_type set (order %)', new.id
      using errcode = '23514', hint = 'actor_type_missing';
  end if;

  -- **`migration` may only write rows that carry a legacy id**, and this is what makes the
  -- exemption impossible to use outside the import (`E16-49`, Andy: "as narrow as you can").
  -- A new order has no `legacy_bubble_id` and never will, so no amount of setting
  -- `app.actor_type = 'migration'` opens a path for one — the actor and the data have to agree,
  -- and only the importer holds data that satisfies both.
  if v_actor = 'migration' and new.legacy_bubble_id is null then
    raise exception 'the migration actor may only insert rows carrying a legacy_bubble_id (order %)', new.id
      using errcode = '23514', hint = 'migration_actor_needs_legacy_id';
  end if;

  -- §4.1, literally. `(operation, from, to, actor)`.
  if not (
    (tg_op, coalesce(old.status::text, ''), new.status::text, v_actor::text) in (
      -- T1: an admin creating an order on somebody's behalf.
      ('INSERT', '', 'draft',            'admin'),
      -- T2: the ordinary checkout.
      ('INSERT', '', 'pending_payment',  'system'),
      -- T3: a draft submitted.
      ('UPDATE', 'draft', 'pending_payment', 'admin'),
      ('UPDATE', 'draft', 'pending_payment', 'customer'),
      -- T4: a draft abandoned.
      ('UPDATE', 'draft', 'cancelled', 'admin'),
      ('UPDATE', 'draft', 'cancelled', 'customer'),
      ('UPDATE', 'draft', 'cancelled', 'system'),
      -- T5: the capture is verified. `payment_provider` is NOT here: a webhook does not move an
      -- order directly, it moves a payment, and the settlement path moves the order as `system`
      -- after checking the capture server-side (§3.6, and `R8`).
      ('UPDATE', 'pending_payment', 'paid', 'system'),
      -- T6: no capture, and every attempt terminal.
      ('UPDATE', 'pending_payment', 'cancelled', 'system'),
      ('UPDATE', 'pending_payment', 'cancelled', 'customer'),
      ('UPDATE', 'pending_payment', 'cancelled', 'admin'),
      -- T7: the kitchen starts.
      ('UPDATE', 'paid', 'preparing', 'kitchen'),
      ('UPDATE', 'paid', 'preparing', 'admin'),
      -- T8: bulk mark-delivered, straight from paid (`L8` — a kitchen clearing a class at the
      -- end of service never touched `preparing`, and forcing it to would be a lie in the data).
      ('UPDATE', 'paid', 'delivered', 'kitchen'),
      ('UPDATE', 'paid', 'delivered', 'admin'),
      -- T9: the ordinary handover.
      ('UPDATE', 'preparing', 'delivered', 'kitchen'),
      ('UPDATE', 'preparing', 'delivered', 'admin'),
      -- T10: the customer cancels in time. The clock is the caller's to check.
      ('UPDATE', 'paid', 'cancelled', 'customer'),
      -- T11 / T12: staff cancellation, no time bound.
      ('UPDATE', 'paid', 'cancelled', 'kitchen'),
      ('UPDATE', 'paid', 'cancelled', 'admin'),
      ('UPDATE', 'preparing', 'cancelled', 'kitchen'),
      ('UPDATE', 'preparing', 'cancelled', 'admin'),
      -- T13: fully refunded, after cancellation. Never straight from `paid` — a refund with no
      -- cancellation loses WHY the food was not delivered.
      ('UPDATE', 'cancelled', 'refunded', 'system'),
      -- T14 / `E16-49`: the Bubble import, and ONLY the two states it actually carries. The
      -- recon counted 281 `Paid` and 2 `Cancelled`; drafts are not migrated at all, and
      -- `delivered` and `refunded` are deliberately absent because no legacy order is in them.
      -- INSERT only — a migration actor can create history and can never move a live order.
      ('INSERT', '', 'paid',      'migration'),
      ('INSERT', '', 'cancelled', 'migration')
    )
  ) then
    raise exception 'illegal order transition % -> % by % (order %)',
      coalesce(old.status::text, '(new)'), new.status, v_actor, new.id
      using errcode = '23514', hint = 'illegal_transition';
  end if;

  return new;
end;
$function$;
