-- Reverse of `0064_allergen_vocabulary_egg_peanut_sesame.sql`.
--
-- Deletes only the three rows that migration inserts, and only by their **id**, so a code added
-- separately under a different id survives.
--
-- Like `0063`'s down migration, this will refuse — foreign key `restrict` — if any dish or child
-- has been tagged with one of these. That is correct and deliberately not forced: removing an
-- allergen a child's record points at is how a warning silently stops firing. If you genuinely
-- mean it, clear `dish_allergen` and `recipient_allergen` first, deliberately, having read what
-- you are about to delete.

delete from allergen
 where id in (
   'a1000000-0000-0000-0000-000000000005',
   'a1000000-0000-0000-0000-000000000006',
   'a1000000-0000-0000-0000-000000000007'
 );
