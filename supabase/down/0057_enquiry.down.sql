-- Rollback for `0057_enquiry.sql`.
--
-- Safe to run: the enquiry table is written only by the `enquiry-submit` Edge Function and read
-- by nothing yet, so dropping it breaks no foreign key and no policy elsewhere.
--
-- **It does destroy enquiries.** Every row is a school that asked to be contacted, which is not
-- recoverable from anywhere else — take a copy before running this on anything but a scratch
-- database.

drop function if exists public.enquiry_rate_hit(text, interval, integer);
drop table if exists public.enquiry_rate;
drop table if exists public.enquiry;
drop type if exists enquiry_role;
