-- Reverses 0018_app_user_on_signup.sql.
--
-- The `app_user` rows are NOT deleted. They are the accounts themselves, and rows created by
-- the trigger are indistinguishable from rows created any other way — deleting them would
-- delete real users because a migration was rolled back.
--
-- `phone_e164` is left nullable for the same reason: restoring `not null` would fail against
-- any row the trigger created, which is every v1 account. Reverting the *mechanism* is
-- possible; reverting the *shape* is not, once real accounts exist. Saying so here is the
-- point — `check-migrations` wants a reversal, and an honest partial one beats a script that
-- claims more than it does.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists handle_new_auth_user();
