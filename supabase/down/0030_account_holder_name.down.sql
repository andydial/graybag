-- Rollback for 0030 — the account holder's name goes back to being a column nothing writes.
--
-- The functions go. The **column stays**, and that is the point of a name being optional: a
-- parent who typed "Priya" into a screen we then rolled back has not withdrawn it, and dropping
-- `name_prompted_at` would mean everyone who had already declined gets asked again on their
-- next order — the exact nag the column exists to prevent.
--
-- Nothing reads either function outside the `account` Edge Function, which is deployed
-- separately and would 500 until it is rolled back too. That is the honest failure: an
-- optional field that stops accepting input, on a screen whose skip still works.
drop function if exists clear_user_name(uuid);
drop function if exists skip_user_name_prompt(uuid);
drop function if exists set_user_name(uuid, text, text);
