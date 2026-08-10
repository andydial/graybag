-- Rollback for 0022_self_recipients.sql.
--
-- Drops the self-recipient path. Any recipient already created with is_self = true keeps its
-- row and its consent record — they are not deleted, because deleting a consent record
-- destroys the evidence that consent was given, which is the one thing a consent log exists
-- to preserve. They simply become uncreatable again.
--
-- `self_data_notice` is left published for the same reason: unpublishing a notice somebody
-- has already consented against would orphan their consent record's policy_version_id.
drop function if exists recipient_collection_mode(uuid);
drop function if exists create_recipient(uuid, text, text, uuid, text, text, uuid[], text, boolean, jsonb, boolean);
