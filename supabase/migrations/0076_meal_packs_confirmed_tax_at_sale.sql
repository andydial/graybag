-- The tax point is settled: a pack is taxed in full at purchase. `E21-53`.
--
-- Andy, 2026-08-27, with the accountant's answer: *"a meal pack is taxed in full at purchase. Tax
-- point = sale, invoice issued at purchase, no further GST when a meal is redeemed."*
--
-- `pack_tax_point` already defaults to `'sale'` and every pack sold stamps its own copy
-- (`meal_pack.tax_point`), so nothing about existing rows changes and nothing needs migrating —
-- which is the whole reason the value was stamped rather than read live (`E21-22`).
--
-- What this migration does is remove the block: `meal_packs_confirmed` becomes true, so an offer
-- may go live. **It does not make anything live.** Every offer still carries `is_active = false`
-- and no parent sees a pack until somebody deliberately activates one.
--
-- ## The `redemption` path is NOT deleted
--
-- `confirm_meal_pack_plan` still posts the tax legs correctly for a pack stamped `redemption`,
-- and `meal_pack_deferred_tax_paise` still exists. Deleting them would be tidier and wrong twice:
-- the answer could change for a future product, and — more immediately — the invariant asserts
-- the tax leg is zero on **both** sides under `sale`, which is a real assertion only while the
-- other side can be non-zero. A branch nobody can reach is a branch nobody tests.

begin;

update platform_config set meal_packs_confirmed = true where id = 1;

comment on column platform_config.pack_tax_point is
  'WHEN GST on a prepaid pack arises. **Settled 2026-08-27: `sale`** — taxed in full at purchase, '
  'invoice issued then, no further GST at redemption. Read ONLY when a pack is sold, then stamped '
  'onto meal_pack.tax_point, so a future change would apply to future sales and never rewrite a '
  'pack already sold and invoiced.';

commit;
