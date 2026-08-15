-- =============================================================================
-- 0060_policy_gate_in_checkout.sql — the ordering gate `0001` has always claimed. `E20-55`.
-- =============================================================================
--
-- `user_policy_acceptance`'s own comment, since `0001`:
--
--   "The E20-03 ordering gate: order creation checks that, for every policy_version where
--    blocks_ordering and effective_from <= now() and it is the latest version of its policy,
--    a matching acceptance row exists for the customer."
--
-- **`create_checkout` did no such check.** No migration outside the schema, RLS and privilege
-- files referenced the table at all. The gate was client-side only — `fetchPendingPolicies` plus
-- `PolicyGateScreen` — which makes it advisory: anything reaching the Edge Function without
-- going through the screen placed the order.
--
-- =============================================================================
-- WHY NOW, WHILE IT CANNOT FIRE
-- =============================================================================
--
-- **No row in any environment sets `blocks_ordering = true`**, so this changes nothing today.
-- That is exactly why it is the right moment: the first time somebody publishes a blocking
-- version — a new terms of service, a changed privacy notice — they will assume the gate they
-- read about in `0001` exists. Discovering it does not, at that moment, means either shipping a
-- migration in a hurry or publishing wording nobody is actually held to.
--
-- Andy, 2026-08-16: *"Fix it now while nothing sets blocks_ordering, rather than discovering it
-- when something does."*
--
-- =============================================================================
-- INSIDE THE TRANSACTION, NOT IN THE EDGE FUNCTION
-- =============================================================================
--
-- The check and the write must see the same snapshot. A gate in `checkout/index.ts` would read
-- acceptances, then call `create_checkout` in a second statement — and a version published in
-- between would be missed. More importantly, `create_checkout` is callable by `service_role` from
-- anywhere; a guard that only exists in one caller is a guard with a bypass.
--
-- =============================================================================
-- WHAT "LATEST" MEANS, AND WHY IT REUSES current_policy_version_id
-- =============================================================================
--
-- Only the **current** version of each policy is required. Asking a parent to accept version 1
-- *and* version 2 of the same document is a bug that looks like diligence.
--
-- `current_policy_version_id()` (`0033`) is already the single answer to "which wording is
-- current" — it exists because `create_recipient` had that ORDER BY inline and `'9' > '10'` as
-- text recorded consent against superseded wording, invisibly (`E20-50`). A second copy of that
-- ordering here would be a second chance to get it wrong.
-- =============================================================================

create or replace function assert_policies_accepted(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_missing text[];
begin
  select array_agg(pd.code order by pd.code)
    into v_missing
    from policy_document pd
    join policy_version pv on pv.id = current_policy_version_id(pd.code)
   where pv.blocks_ordering
     and pv.published_at is not null
     and pv.effective_from <= now()
     and not exists (
       select 1 from user_policy_acceptance a
        where a.policy_version_id = pv.id and a.user_id = p_user_id
     );

  if v_missing is not null and array_length(v_missing, 1) > 0 then
    -- Names the policies. "Acceptance required" sends somebody to guess which document, and the
    -- app needs the codes to route to the right gate screen.
    raise exception 'policy acceptance required: %', array_to_string(v_missing, ', ')
      using errcode = 'P0001', hint = 'policy_acceptance_required';
  end if;
end;
$$;

comment on function assert_policies_accepted(uuid) is
  'E20-55 / E20-03. The ordering gate 0001 has claimed since the beginning and which was never '
  'built: refuses when any CURRENT, published, in-effect policy_version with blocks_ordering has '
  'no acceptance row for this user. Only the current version of each policy counts — requiring v1 '
  'AND v2 of one document is a bug that looks like diligence. Reuses current_policy_version_id() '
  'rather than repeating its ORDER BY, because E20-50 was that ordering being wrong in a second '
  'place. Inert until something sets blocks_ordering, which nothing does yet — built now so the '
  'first person to publish a blocking version gets the gate they will assume exists.';

-- -----------------------------------------------------------------------------
-- `create_checkout` asks before it writes.
--
-- Regenerated from `pg_get_functiondef()` with one `perform` inserted next to the seller-identity
-- guard, and asserted to differ in nothing else — the same discipline `0045` used when it added
-- that one. Both are preconditions on taking money, and they belong together.
-- -----------------------------------------------------------------------------
do $$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_checkout';

  if v_src is null then
    raise exception 'create_checkout not found — 0060 cannot patch a function that is not there';
  end if;

  if position('assert_policies_accepted' in v_src) > 0 then
    raise notice '0060: create_checkout already calls assert_policies_accepted; nothing to do';
    return;
  end if;

  -- Anchored on the seller-identity guard, which is a single unambiguous line in the body.
  v_new := replace(
    v_src,
    'perform assert_seller_identity_configured();',
    'perform assert_seller_identity_configured();' || E'\n' ||
    '  -- `E20-55`. The ordering gate `0001` describes. Inside the transaction, so the check and' || E'\n' ||
    '  -- the write see one snapshot; inert until a policy_version sets blocks_ordering.' || E'\n' ||
    '  perform assert_policies_accepted(p_customer_user_id);');

  if v_new = v_src then
    raise exception '0060: could not find the seller-identity guard to anchor on — create_checkout has changed shape, patch it by hand rather than letting this silently no-op';
  end if;

  execute v_new;
end;
$$;

revoke all on function assert_policies_accepted(uuid) from public;
grant execute on function assert_policies_accepted(uuid) to service_role;

notify pgrst, 'reload schema';
