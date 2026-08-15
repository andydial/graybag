-- Reverse of `0060_allergen_vocabulary.sql`.
--
-- Deletes only the four rows this migration inserts, and only by their **id**, so a code added
-- separately under a different id survives.
--
-- The delete will refuse — foreign key `restrict` — if any dish or child has been tagged with one
-- of these in the meantime. That is correct and deliberately not forced: removing an allergen
-- that a child's record points at is how an allergy warning silently stops firing, which is the
-- exact failure `0060` exists to end. If you genuinely mean it, clear `dish_allergen` and
-- `recipient_allergen` first, deliberately, having read what you are about to delete.

delete from allergen
 where id in (
   'a1000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000002',
   'a1000000-0000-0000-0000-000000000003',
   'a1000000-0000-0000-0000-000000000004'
 );
