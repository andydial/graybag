-- Rollback for 0025. Drops both functions; no data is changed, and a recipient deactivated
-- while this was live stays deactivated (which is correct — the parent asked for it).
drop function if exists update_recipient_details(uuid, uuid, text, text, text, text, boolean, boolean);
drop function if exists deactivate_recipient(uuid, uuid);
