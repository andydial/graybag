-- =============================================================================
-- 0004_allergen_fulfilment_scope.down.sql — reverses 0004
-- =============================================================================
--
-- BE CLEAR ABOUT WHAT THIS ROLLBACK RE-OPENS. It restores the fulfilment policy to
-- the form that lets a platform-scope `orders.view_pii` grant read tier-S allergen
-- data for every child who has ever ordered. That is the defect 0004 closed.
--
-- It exists because a migration that cannot be rolled back is worse than one that can
-- (MG2), and because if 0004 turns out to break legitimate kitchen access the fastest
-- safe move may be to revert and re-approach. It is NOT a routine operation, and it
-- must not be run against production without a decision recorded alongside it.
--
-- MG4 normally forbids a down migration that widens access. This is the deliberate
-- exception: the rollback of a security fix necessarily un-fixes it, and pretending
-- otherwise by shipping a no-op would be worse — it would leave the schema in a state
-- matching neither migration.
-- =============================================================================

drop policy recipient_allergen_read_fulfilment on recipient_allergen;

create policy recipient_allergen_read_fulfilment on recipient_allergen for select to authenticated
  using (auth_recipient_has_visible_order(recipient_id, 'orders.view_pii'));

drop function if exists auth_recipient_has_fulfilment_order(uuid);
