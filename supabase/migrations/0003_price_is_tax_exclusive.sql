-- =============================================================================
-- 0003_price_is_tax_exclusive.sql — answers [DM-14] / [DM-20]
-- =============================================================================
--
-- Andy confirmed on 2026-08-07 that menu prices are **GST-EXCLUSIVE**: the stored
-- `price_paise` is the taxable value and 5% is added on top at checkout, which is
-- what the Bubble cart does today. `docs/decisions.md` SC2.
--
-- 0001 left `platform_config.price_is_tax_inclusive` nullable and unset ON PURPOSE.
-- [DM-20] chose that over `NOT NULL DEFAULT false` precisely so tax calculation would
-- *refuse to run* rather than silently inherit a guess about money into every invoice
-- ever issued. This migration is that decision being made explicitly, which is the
-- moment the nullability existed to create.
--
-- Setting the value and making the column NOT NULL are done together. Leaving it
-- nullable now would preserve a state — "configured, but nobody said which" — that can
-- no longer legitimately occur, and a nullable column invites a future `coalesce(...,
-- false)` that would quietly re-open the question.
--
-- Consequence worth stating: this also settles [GST-01] as option (a), the cheap one.
-- The tax-inclusive path would have required relaxing order_line's
-- `check (line_subtotal_paise = unit_price_paise * quantity)`, because deriving a
-- per-unit taxable value from a tax-inclusive price multiplies the per-unit rounding
-- error by the quantity — four Rs 99.00 tax-inclusive dishes come to Rs 396.02, not
-- Rs 396.00. Exclusive pricing makes that constraint true by construction and leaves
-- invoice.round_off_paise at zero.
--
-- Reversible: 0003_price_is_tax_exclusive.down.sql restores nullable-and-unset.
-- =============================================================================

update platform_config
   set price_is_tax_inclusive = false,
       updated_at = now()
 where id = 1;

-- Belt and braces: platform_config is a singleton (`check (id = 1)`), but if the row
-- were somehow absent the ALTER below would succeed against zero rows and the column
-- would be NOT NULL with nothing in it.
do $$
begin
  if not exists (select 1 from platform_config where id = 1 and price_is_tax_inclusive is not null) then
    raise exception
      'platform_config row 1 is missing or price_is_tax_inclusive is still null; refusing to add the NOT NULL constraint';
  end if;
end;
$$;

alter table platform_config
  alter column price_is_tax_inclusive set not null;

comment on column platform_config.price_is_tax_inclusive is
  'FALSE — menu prices are GST-EXCLUSIVE and 5% is added at checkout. Confirmed by Andy 2026-08-07, docs/decisions.md SC2, closing [DM-14]/[DM-20]. NOT NULL since 0003: "nobody has said" is no longer a state this system can be in. Changing this to true is not a config edit — it changes what every stored price MEANS, and requires the [GST-01] rounding work first.';
