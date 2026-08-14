-- =============================================================================
-- 0052_order_cancellation_window.sql — the cancellation boundary, resolved server-side
-- from the order's own snapshot. `E06-42`.
-- =============================================================================
--
-- Order detail renders "we can't tell when cancelling closes for this order, so we are not
-- going to guess" for every order in the system, because `cancellationClosesAt` and
-- `cancellationAllowed` arrive as `null`/`false` from a read that never fetched them. That is
-- the safe direction and not the right one.
--
-- =============================================================================
-- WHY THIS IS NOT ARITHMETIC IN THE CLIENT
-- =============================================================================
--
-- The boundary is `cutoff_at − customer_cancellation_cutoff_minutes` and both operands are
-- already on the row: `order.cutoff_at` was snapshotted at checkout (`L6`) and the whole
-- resolved config went into `order.config_snapshot` (`C9`, `D5`). So a client *could* compute
-- it — and it must not, for two reasons that are separate and both sufficient:
--
-- 1. **`config_snapshot` must not leave the server.** It is `to_jsonb(effective_config)`, which
--    carries `revenue_share_bps` — the commercial term between GrayBag and the school. A parent's
--    order-detail read has no business carrying it, and "the column list is the redaction"
--    (`schools.ts`, `orders.ts`) is the rule this codebase already follows. Shipping the blob to
--    resolve one integer out of it would be a leak in exchange for nothing.
--
-- 2. **One implementation of the arithmetic.** `0008` says it in as many words: a second copy in
--    TypeScript that drifted by an hour would be a whole-day error at the default cutoff (`C5`).
--    `compute_cutoff_at` lives in SQL for exactly that reason and this subtraction is the same
--    kind of thing.
--
-- What the ticket actually protects against — a kitchen changing its cutoff tonight moving an
-- order placed last week — is handled by reading `config_snapshot` rather than
-- `resolve_effective_config()`. **That is the load-bearing choice here**, and it would be easy
-- to get wrong by reaching for the resolver, which is the function every other caller wants.
-- The snapshot is frozen at checkout; the resolver is live. `L6` is the same rule for
-- `cutoff_at` and it is stated there in the same words.
--
-- =============================================================================
-- POSTGREST COMPUTED COLUMNS, NOT A VIEW AND NOT AN RPC
-- =============================================================================
--
-- A function whose first argument is a table's row type is selectable as though it were a
-- column: `select=id,cancellation_closes_at`. That keeps non-negotiable #1 intact — this is a
-- **read**, so it may go through the Supabase client, and it does, on the same query that
-- already fetches the order.
--
-- A view would have meant a second object to keep in step with `"order"` and its policies. An
-- RPC would have meant a second round trip and a second place scope has to be re-stated —
-- and `E06-43` is a fresh reminder of what a second, differently-scoped read of the same rows
-- costs. Neither earns its keep for two derived scalars.
--
-- RLS is unaffected: the row is passed in *after* the policies have chosen it, so a computed
-- column cannot widen a result. It is a projection, not a query.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- `null` when the snapshot cannot answer, and that is deliberate.
--
-- `config_snapshot->>'customer_cancellation_cutoff_minutes'` is null for a row written before
-- the key existed — the `E16` Bubble backfill, and every pgTAP fixture that inserts `'{}'`.
-- Null propagates through the subtraction and the screen renders "we can't tell", which is the
-- honest answer for an order whose terms we did not record. It must never coalesce to 0:
-- 0 means "cancellable right up to the cutoff", which is a promise made from missing data.
-- -----------------------------------------------------------------------------
create or replace function cancellation_closes_at(o "order")
returns timestamptz
language sql stable
as $$
  select o.cutoff_at - make_interval(
    mins => (o.config_snapshot->>'customer_cancellation_cutoff_minutes')::integer
  );
$$;

comment on function cancellation_closes_at("order") is
  'E06-42 / order-lifecycle §9.2 E5. A PostgREST computed column: select=cancellation_closes_at. '
  'Reads the order''s OWN config_snapshot (C9), never resolve_effective_config() — the point of '
  'the task is that a kitchen changing its cutoff tonight cannot move an order placed last week. '
  'NULL when the snapshot lacks the key (backfilled and fixture rows); it must not coalesce to 0, '
  'because 0 means "cancellable right up to cutoff" and that is a promise made from missing data. '
  'Advisory only, exactly as is_service_date_orderable is: the authoritative check is '
  'assert_cutoff_open inside the cancellation transaction (§9.2 E5).';

-- -----------------------------------------------------------------------------
-- The other half of T10's guard. Same null discipline: a snapshot that does not say is `false`
-- at the screen, because `cancelAvailability` treats false as "this kitchen doesn't take
-- cancellations through the app, get in touch" — a routed human rather than a dead end.
-- -----------------------------------------------------------------------------
create or replace function cancellation_allowed(o "order")
returns boolean
language sql stable
as $$
  select coalesce((o.config_snapshot->>'customer_cancellation_allowed')::boolean, false);
$$;

comment on function cancellation_allowed("order") is
  'E06-42. PostgREST computed column. The other half of T10''s guard, from the order''s own '
  'config_snapshot. Coalesces to FALSE rather than NULL — unlike cancellation_closes_at, where '
  'null and false say different things to the parent, here they say the same thing and false is '
  'the shape the client wants.';

-- `authenticated` is the parent reading their own order detail; `service_role` is the
-- cancellation path in `0053`, which asks the same question before it acts.
revoke all on function cancellation_closes_at("order") from public;
revoke all on function cancellation_allowed("order")  from public;
grant execute on function cancellation_closes_at("order") to authenticated, service_role;
grant execute on function cancellation_allowed("order")  to authenticated, service_role;

-- PostgREST caches the schema and will not see a new computed column until told. Applying a
-- migration by hand rather than through `db push` is how this bites — `docs/learnings.md` has
-- the hour it cost with a captured payment sitting unsettled.
notify pgrst, 'reload schema';
