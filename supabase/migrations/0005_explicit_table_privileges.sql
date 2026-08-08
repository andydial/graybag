-- =============================================================================
-- 0005_explicit_table_privileges.sql
--
-- States the privilege baseline that docs/authorization-model.md §10 has always
-- assumed, instead of inheriting it from Supabase's platform defaults (E02-25,
-- and the implementation half of E02-21).
-- =============================================================================
--
-- THE DEFECT
--
-- §10 opens with this sentence, and everything under it is built on it:
--
--   "Supabase's default privileges give `anon` and `authenticated`
--    SELECT/INSERT/UPDATE/DELETE on new tables in `public`; RLS is what actually
--    stops them."
--
-- That is true on a hosted Supabase project. It is NOT true on the local CLI stack,
-- where migrations are applied by a role whose default privileges differ — there,
-- `authenticated` ends up with no privilege on the tables at all.
--
-- So 0001 and 0002 revoke from a baseline they never establish. Three layers of
-- REVOKE and not one GRANT:
--
--   0001  append-only tables      revoke UPDATE, DELETE  from anon, authenticated
--   0001  schema `migration`      revoke ALL + USAGE     from anon, authenticated
--   0002  everything in public    revoke ALL             from anon
--   0002  37 class-3 tables       revoke INSERT/UPDATE/DELETE from authenticated
--
-- On staging that subtracts from a full grant and lands on the intended model, which
-- is why E02-18 saw the suite pass there. In CI it subtracts from nothing, and the
-- authorization suite dies in its own Part 0 harness on
-- `permission denied for table "order"` before it can assert anything at all.
--
-- The bug was never that one environment is misconfigured. It is that **the suite
-- could not mean the same thing in both**, so a green run in CI was not evidence
-- about production. A security suite that proves something different from what ships
-- is the same class of false confidence as E02-24's `Tests: 0`.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS MIGRATION CHANGES, IN NET TERMS
--
-- On a hosted project: **nothing.** It grants what the platform already granted and
-- then re-applies the same revokes 0001 and 0002 already applied. Run it against
-- staging and the end state is identical, which is the point — parity is what is
-- being fixed, not the model.
--
-- On the local/CI stack: `authenticated` gains the baseline it was always assumed to
-- have, and the suite becomes able to run.
--
-- The privilege model itself is UNCHANGED. If you want to argue with the model,
-- argue with §10 — this migration only makes it say out loud what it was relying on.
--
-- -----------------------------------------------------------------------------
-- WHY GRANT-THEN-REVOKE RATHER THAN A POSITIVE LIST
--
-- Granting exactly the surviving set would mean writing "every table except these
-- 37, and except UPDATE/DELETE on these 6" as a literal list, in a second place.
-- 0002 already owns the class-3 list and says so in capitals: it is the machine-
-- readable form of §5 rule 4 and the test suite asserts against the same list. A
-- second copy would drift from it, and the drift would be silent and would open
-- writes. Re-applying the revokes keeps 0002's list the only list.
--
-- -----------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT GRANTED
--
--   * `anon` gets nothing, at all. 0002 revoked it and this migration does not undo
--     that, does not grant to it, and does not set default privileges for it. The
--     suite asserts anon holds no table privilege in public ([AZ-03]).
--   * Schema `migration` is untouched. Every statement here is scoped to `public`.
--   * No FORCE ROW LEVEL SECURITY — §10 explains why, and this does not revisit it.
--   * No function EXECUTE grants. 0002 owns those boundaries.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The baseline §10 assumes.
--
-- SELECT/INSERT/UPDATE/DELETE to `authenticated` on every existing table in public.
--
-- READ THIS BEFORE BEING ALARMED BY THE BREADTH. A privilege is not access here.
-- Every table in public has RLS enabled — the suite asserts that as a structural
-- invariant, "RLS on every table" — so a role holding SELECT still reads zero rows
-- unless a policy admits it. That two-layer arrangement is the model: the grant is
-- the outer door, RLS is the lock, and §10's revokes remove the door entirely where
-- no policy will ever open it.
--
-- `authenticated` is the role every signed-in end user is impersonated as. It is not
-- an admin role: privileged operations go through `service_role` in Edge Functions,
-- which holds BYPASSRLS and is out of scope here.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema public to authenticated;

    grant select, insert, update, delete
      on all tables in schema public to authenticated;

    -- Identity/serial columns need the sequence to be usable by whoever may INSERT.
    -- Where INSERT is revoked below, the sequence grant is unreachable anyway.
    grant usage, select on all sequences in schema public to authenticated;

    -- Tables created by LATER migrations inherit the same baseline, which is what the
    -- platform default did. Without this, migration 0006 would create a table nobody
    -- can read and the failure would surface as an empty screen, not an error.
    alter default privileges in schema public
      grant select, insert, update, delete on tables to authenticated;
    alter default privileges in schema public
      grant usage, select on sequences to authenticated;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Re-apply 0001's append-only revoke.
--
-- The grant above just handed UPDATE and DELETE back on these six. History is the
-- product on them — a correction is a new row: a reversing ledger transaction, a
-- withdrawal consent event, a compensating order_event. The BEFORE UPDATE OR DELETE
-- trigger from 0001 still stands and would raise anyway; this is the privilege layer
-- underneath it, so the attempt fails before the trigger is even reached.
--
-- INSERT is intentionally left granted: appending is the supported operation.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    return;
  end if;
  foreach t in array array[
    'order_event', 'ledger_transaction', 'ledger_entry',
    'consent_record', 'user_policy_acceptance', 'audit_log'
  ] loop
    execute format('revoke update, delete on public.%I from authenticated', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Re-apply 0002's class-3 revoke.
--
-- No policy will ever back a direct write to these from an end user: orders, money,
-- the ledger, invoices, payouts, the permission tables, config, policy documents,
-- audit and reporting. Every one of them is written by `service_role` through an
-- Edge Function, which is where the business rules and the audit trail live.
--
-- Revoking the privilege means an accidentally-added policy still cannot write —
-- that is the whole point of the second layer, and it is why this list must not
-- drift. IT IS COPIED VERBATIM FROM 0002 AND MUST STAY THAT WAY. The suite asserts
-- against the same list ("§10: authenticated holds no INSERT/UPDATE/DELETE privilege
-- on any class-3 table"), so a copy that drifts fails CI rather than opening a write
-- quietly.
--
-- SELECT is deliberately retained: reading an order or an invoice is exactly what
-- RLS's policies are for, and §8's matrix depends on it.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    return;
  end if;
  foreach t in array array[
    'order_group', 'order', 'order_line', 'order_event',
    'payment', 'payment_webhook_event', 'refund', 'refund_line',
    'ledger_account', 'ledger_transaction', 'ledger_entry', 'wallet_balance',
    'invoice', 'invoice_line', 'invoice_sequence', 'payout', 'payout_line',
    'permission', 'role_template', 'role_template_permission', 'permission_grant',
    'platform_config', 'kitchen_config', 'school_config', 'config_change_log',
    'policy_document', 'policy_version', 'consent_purpose',
    'retention_policy', 'purge_run', 'idempotency_key',
    'audit_log', 'school_report', 'notification_delivery',
    'school_menu_version', 'menu_item_capacity', 'reason_code'
  ] loop
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Re-assert that anon got nothing.
--
-- Step 1 granted only to `authenticated`, so anon should be untouched. This repeats
-- 0002's revoke anyway, because "should be" is not the standard this table of
-- privileges is held to, and the statement is free. [AZ-03].
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables    in schema public from anon;
    revoke all on all sequences in schema public from anon;
    alter default privileges in schema public revoke all on tables    from anon;
    alter default privileges in schema public revoke all on sequences from anon;
  end if;
end;
$$;
