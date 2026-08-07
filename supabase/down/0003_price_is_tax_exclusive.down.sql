-- =============================================================================
-- 0003_price_is_tax_exclusive.down.sql — reverses 0003
-- =============================================================================
--
-- Restores the [DM-20] state: nullable and unset, so tax calculation refuses to run
-- rather than proceeding on an assumption.
--
-- This is a real rollback rather than a no-op, but be clear about what reversing it
-- would MEAN: if any order, invoice or credit note has been priced under 0003, the
-- prices in those rows were computed as tax-exclusive and setting this back to null
-- does not un-compute them. The rollback is for a failed deploy, not for changing the
-- pricing model after money has moved — `docs/migrations.md` §4.
-- =============================================================================

alter table platform_config
  alter column price_is_tax_inclusive drop not null;

update platform_config
   set price_is_tax_inclusive = null,
       updated_at = now()
 where id = 1;

comment on column platform_config.price_is_tax_inclusive is
  'Whether menu prices include GST. [DM-14]/[DM-20]: deliberately NULL and nullable so tax calculation refuses to run until it is answered.';
