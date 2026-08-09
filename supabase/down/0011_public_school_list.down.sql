-- Reverses 0011_public_school_list.sql.
--
-- Dropping the function removes its grant. After this, a signed-out user has no way to
-- choose a school, so the Menu tab is empty for everyone — 0010's menu read needs a
-- school id and nothing else supplies one.
drop function if exists public.get_schools();
