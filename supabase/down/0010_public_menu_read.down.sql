-- Reverses 0010_public_menu_read.sql — [AUTH-01].
--
-- Dropping the functions removes their grants with them.
--
-- After this runs, `anon` is back to reaching nothing at all in `public`, and a
-- signed-out user cannot read a dish by any route. That is exactly the state
-- [AUTH-01] was raised about, so run this only alongside a replacement — either
-- literal table grants, or option (a)'s service_role Edge Function — or the Menu tab
-- goes empty for everyone who is not signed in.

drop function if exists public.get_school_menu(uuid);
drop function if exists public.get_school_menu_version(uuid);
