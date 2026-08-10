-- Rollback for 0020_school_column_grants.sql.
--
-- **This re-opens `E02-30`.** It restores the table-wide grant, which is what made
-- `school.contact_name`, `contact_email` and `contact_phone` readable with the publishable
-- key that ships in every APK. Run it only to unblock a deploy, and only with the follow-up
-- already scheduled — a rollback here is a live exposure of a named staff member's contact
-- details, not a return to a neutral state.
revoke select (id, name, city_id) on school from anon;
grant select on school to anon;
