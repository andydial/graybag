-- =============================================================================
-- 0037_payment_timing_config.sql — the three settings §9 and §10 depend on, and the two reason
-- codes that go with them. `E06-20`, `E06-24`, `L9`, `[OL-03]`.
-- =============================================================================
--
-- `docs/order-lifecycle.md` §15 lists three config settings the payment paths need and that
-- `docs/data-model.md` §9.1 does not have. Without them, `E06-06`'s sweeper and `E06-16`'s
-- status endpoint have no numbers to read and would hard-code them — which is how a per-kitchen
-- tolerance becomes a constant nobody can change without a deploy.
--
-- All three are **per-scope like the rest of the chain**: NOT NULL with a default on
-- `platform_config`, nullable on `kitchen_config` and `school_config`, and resolved
-- school-over-kitchen-over-platform by `resolve_effective_config()`.
--
-- ## `payment_in_flight_grace_minutes` — 15, and it is decided
--
-- `L9`, Andy, twice: settlement inside `cutoff_at + grace` is honoured, settlement after it is
-- refused and auto-refunded. **Default 15 minutes**, which covers every realistic settlement
-- delay and nothing else. A parent whose money left their account before the cutoff did order in
-- time, and refunding them reads as a bug; but "honour it" with no bound hands the kitchen an
-- order it cannot cook, which is what a cutoff is for.
--
-- **Never shown to a parent and never counted down at them.** It is a server tolerance, not a
-- deadline they can act on, and putting it on screen would invite racing it. A kitchen that
-- cannot absorb late orders sets it to 0 and gets a hard cutoff — which is `[OL-02]` option (b)
-- as a configuration rather than as a second code path.
--
-- ## `pending_payment_ttl_minutes` — 30, and it is PROVISIONAL
--
-- `[OL-03]`'s recommendation, and the one number here that is a guess. Its floor is a fact we do
-- not have: **how long Razorpay lets a UPI collect stay pending**, which is `E19-07` row 3 and
-- is answered by the sitting in `docs/e19-07-webhook-sitting.md`. Too short manufactures the
-- late-capture path `L9` exists to absorb; too long fills the order list with zombies.
--
-- It is config precisely so that answer costs an UPDATE rather than a migration. **The sweeper
-- must also reconcile against Razorpay before cancelling rather than trusting this clock**
-- (`E06-17`) — the TTL decides when to go and ask, not what the answer is.
--
-- ## `payment_retry_window_minutes` — 30
--
-- How long a failed attempt may be retried against the same `order_group` before the checkout is
-- treated as abandoned. Matched to the TTL deliberately: a window longer than the TTL would let
-- a retry succeed against a checkout the sweeper had already cancelled, which is the late
-- capture again by another door.
-- =============================================================================

alter table platform_config
  add column if not exists pending_payment_ttl_minutes     integer not null default 30,
  add column if not exists payment_in_flight_grace_minutes integer not null default 15,
  add column if not exists payment_retry_window_minutes    integer not null default 30;

alter table kitchen_config
  add column if not exists pending_payment_ttl_minutes     integer,
  add column if not exists payment_in_flight_grace_minutes integer,
  add column if not exists payment_retry_window_minutes    integer;

alter table school_config
  add column if not exists pending_payment_ttl_minutes     integer,
  add column if not exists payment_in_flight_grace_minutes integer,
  add column if not exists payment_retry_window_minutes    integer;

-- Zero is meaningful for the grace window — it is how a kitchen chooses a hard cutoff — but a
-- negative tolerance is not a thing, and a negative TTL would sweep a checkout before it was
-- created. Applied to all three tables because an override is as capable of being wrong as a
-- default.
alter table platform_config
  add constraint platform_config_payment_minutes_non_negative check (
    pending_payment_ttl_minutes >= 0
    and payment_in_flight_grace_minutes >= 0
    and payment_retry_window_minutes >= 0);

alter table kitchen_config
  add constraint kitchen_config_payment_minutes_non_negative check (
    coalesce(pending_payment_ttl_minutes, 0) >= 0
    and coalesce(payment_in_flight_grace_minutes, 0) >= 0
    and coalesce(payment_retry_window_minutes, 0) >= 0);

alter table school_config
  add constraint school_config_payment_minutes_non_negative check (
    coalesce(pending_payment_ttl_minutes, 0) >= 0
    and coalesce(payment_in_flight_grace_minutes, 0) >= 0
    and coalesce(payment_retry_window_minutes, 0) >= 0);

comment on column platform_config.pending_payment_ttl_minutes is
  'How long a pending_payment checkout is held before the sweeper cancels it ([OL-03]). PROVISIONAL: 30 minutes is a recommendation, and its floor is how long Razorpay lets a UPI collect stay pending — E19-07 row 3. Config rather than a constant so that answer costs an UPDATE. The sweeper must reconcile against Razorpay before cancelling rather than trusting this clock (E06-17): the TTL decides when to ask, not what the answer is.';

comment on column platform_config.payment_in_flight_grace_minutes is
  'L9: a settlement landing within cutoff_at + this is honoured; after it the capture is refused and auto-refunded. Default 15 minutes — enough for every realistic settlement delay and nothing else. NEVER shown to a parent and never counted down at them: it is a server tolerance, not a deadline they can act on, and displaying it would invite racing it. A kitchen that cannot absorb late orders sets it to 0 and gets a hard cutoff.';

comment on column platform_config.payment_retry_window_minutes is
  'How long a failed attempt may be retried against the same order_group before the checkout is abandoned. Matched to pending_payment_ttl_minutes on purpose: a longer window would let a retry succeed against a checkout the sweeper had already cancelled, which is the late-capture path by another door.';

-- -----------------------------------------------------------------------------
-- The composite type the resolver returns, and the resolver itself.
--
-- `alter type ... add attribute` appends to `effective_config`; the function below then selects
-- into the three new positions. The body is `pg_get_functiondef()` on the live function with
-- three coalesces added and asserted to differ in nothing else — the same discipline 0033 used,
-- and for the same reason: this function decides every cutoff and every price in the product.
-- -----------------------------------------------------------------------------
alter type effective_config add attribute pending_payment_ttl_minutes     integer cascade;
alter type effective_config add attribute payment_in_flight_grace_minutes integer cascade;
alter type effective_config add attribute payment_retry_window_minutes    integer cascade;

CREATE OR REPLACE FUNCTION public.resolve_effective_config(p_school_id uuid)
 RETURNS effective_config
 LANGUAGE sql
 STABLE
AS $function$
  select row(
    coalesce(kc.timezone, pc.timezone),
    coalesce(sc.order_cutoff_time,                    kc.order_cutoff_time,                    pc.order_cutoff_time),
    coalesce(sc.order_cutoff_days_before,             kc.order_cutoff_days_before,             pc.order_cutoff_days_before),
    coalesce(sc.max_advance_order_days,               kc.max_advance_order_days,               pc.max_advance_order_days),
    coalesce(sc.min_advance_order_days,               kc.min_advance_order_days,               pc.min_advance_order_days),
    coalesce(sc.default_delivery_mode,                kc.default_delivery_mode,                pc.default_delivery_mode),
    coalesce(sc.allow_classroom_delivery,             kc.allow_classroom_delivery,             pc.allow_classroom_delivery),
    coalesce(sc.allow_counter_pickup,                 kc.allow_counter_pickup,                 pc.allow_counter_pickup),
    coalesce(sc.pickup_code_enabled,                  kc.pickup_code_enabled,                  pc.pickup_code_enabled),
    coalesce(sc.revenue_share_bps,                    kc.revenue_share_bps,                    pc.revenue_share_bps),
    pc.price_is_tax_inclusive,   -- platform only
    pc.cgst_rate_bps,            -- platform only, statutory
    pc.sgst_rate_bps,            -- platform only, statutory
    pc.igst_rate_bps,            -- platform only, statutory
    pc.sac_code,                 -- platform only
    coalesce(sc.refund_default_destination,           kc.refund_default_destination,           pc.refund_default_destination),
    coalesce(sc.wallet_at_checkout_enabled,           kc.wallet_at_checkout_enabled,           pc.wallet_at_checkout_enabled),
    coalesce(sc.allergen_warning_enabled,             kc.allergen_warning_enabled,             pc.allergen_warning_enabled),
    coalesce(sc.customer_cancellation_allowed,        kc.customer_cancellation_allowed,        pc.customer_cancellation_allowed),
    coalesce(sc.customer_cancellation_cutoff_minutes, kc.customer_cancellation_cutoff_minutes, pc.customer_cancellation_cutoff_minutes),
    -- Added by 0037. Same three-level chain as every setting above it: school overrides
    -- kitchen overrides platform, and only the platform row is NOT NULL.
    coalesce(sc.pending_payment_ttl_minutes,          kc.pending_payment_ttl_minutes,          pc.pending_payment_ttl_minutes),
    coalesce(sc.payment_in_flight_grace_minutes,      kc.payment_in_flight_grace_minutes,      pc.payment_in_flight_grace_minutes),
    coalesce(sc.payment_retry_window_minutes,         kc.payment_retry_window_minutes,         pc.payment_retry_window_minutes)
  )::effective_config
  from school s
  join platform_config pc on pc.id = 1
  left join kitchen_config kc on kc.kitchen_id = s.kitchen_id
  left join school_config  sc on sc.school_id  = s.id
  where s.id = p_school_id;
$function$;

-- -----------------------------------------------------------------------------
-- Reason codes. §15 item 3, and `[DM-22]` says Andy should eyeball the customer-facing wording.
-- -----------------------------------------------------------------------------
insert into reason_code (code, category, display_name, requires_note, is_customer_visible) values
  -- The sweeper's own reason. Customer-visible: somebody whose checkout timed out is owed an
  -- explanation, and "cancelled" with no reason reads as us cancelling on them.
  ('checkout_expired', 'cancellation', 'Payment was not completed in time', false, true),
  -- `L9`'s other branch: captured after cutoff_at + grace, so auto-cancelled and refunded. The
  -- wording deliberately does not mention a grace window (see the column comment) — it says the
  -- kitchen had closed, which is the fact the parent can act on.
  ('cutoff_missed', 'cancellation', 'Payment arrived after the kitchen had closed', false, true)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- `E06-24` — a refund to a source that does not exist.
--
-- `refund.destination` is an enum including 'source', and nothing stopped a row claiming to
-- refund to the original payment method while naming no payment. `PY5` makes one logical refund
-- possibly two rows — the wallet-funded portion to the wallet, the rest to source — and it is
-- exactly that split where a source row could be written without its payment.
-- -----------------------------------------------------------------------------
alter table refund add constraint refund_source_requires_payment
  check (destination <> 'source' or payment_id is not null);

comment on constraint refund_source_requires_payment on refund is
  'E06-24 / §9.9: a refund to the original payment method must name the payment it reverses. PY5 splits one logical refund across the wallet and the source, and that split is where a source row would otherwise be written with nothing to send the money back to.';
