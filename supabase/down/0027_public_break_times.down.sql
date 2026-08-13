-- Rollback for 0027. Removes anon's read of break windows.
--
-- After this, a signed-out visitor cannot tell whether a school has orderable windows, so the
-- "we're still setting up ordering for this school" state can only appear after sign-in. The
-- app still works; the parent finds out later and after more effort.
drop policy if exists anon_break_time_of_visible_school on break_time;
revoke execute on function auth_school_is_public(uuid) from anon;
revoke select (id, school_id, label, starts_at, ends_at, sort_order) on break_time from anon;
