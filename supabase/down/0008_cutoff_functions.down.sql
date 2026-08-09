-- =============================================================================
-- 0008_cutoff_functions.down.sql — reverses 0008
-- =============================================================================
--
-- WHAT THIS RE-OPENS. Without `assert_cutoff_open` the checkout transaction has no guard to
-- call, so orders can be created after the kitchen's cutoff — which is a kitchen discovering
-- at 6am that it owes lunches it never counted. Without `compute_cutoff_at` there is no
-- shared implementation of §9.1, and the next one written will be in TypeScript and will
-- differ by a timezone.
--
-- Dropping these while a checkout path calls them fails loudly at the call site rather than
-- silently permitting anything, which is the correct direction. MG4 is satisfied: this
-- widens no access.
-- =============================================================================

drop function if exists is_service_date_orderable(uuid, date);
drop function if exists assert_cutoff_open(timestamptz, integer);
drop function if exists compute_cutoff_at(uuid, date);
