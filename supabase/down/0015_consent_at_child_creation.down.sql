-- Reverses 0015_consent_at_child_creation.sql.
--
-- The consent RECORDS are deliberately not deleted. A consent record is evidence that a
-- named adult agreed to something on a date, and deleting evidence because a migration was
-- rolled back is the opposite of what the record is for. `on delete restrict` on
-- policy_version means the delete below simply fails if any consent references the notice,
-- which is the correct outcome.
drop function if exists create_recipient(uuid, text, text, uuid, text, text, uuid[], text, boolean, jsonb);
drop function if exists parental_verification_method();

delete from consent_purpose where code in ('child_meal_service', 'child_allergen_info');
delete from policy_version  where policy_code = 'child_data_notice';
delete from policy_document where code = 'child_data_notice';
