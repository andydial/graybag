-- Rollback for 0041 — the migration actor loses its two transitions and its guard.
--
-- After this, `actor_type` still has the label `migration` (`0040` is declared irreversible and
-- says why) and **nothing can act as it**: there is no row in the table permitting any move by
-- that actor, so every attempt raises. The label becomes inert, which is the correct resting
-- state for an exemption that has been withdrawn.
--
-- `E16`'s import cannot run after this. That is the point of rolling it back.
--
-- The function is restored to exactly what `0039` left, taken from `pg_get_functiondef()` before
-- `0041` replaced it rather than retyped.
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
      ('UPDATE', 'cancelled', 'refunded', 'system')
    )
  ) then
    raise exception 'illegal order transition % -> % by % (order %)',
      coalesce(old.status::text, '(new)'), new.status, v_actor, new.id
      using errcode = '23514', hint = 'illegal_transition';
  end if;

  return new;
end;
$function$

;
