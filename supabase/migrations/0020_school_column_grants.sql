-- =============================================================================
-- 0020_school_column_grants.sql
--
-- `E02-30`, risk critical. **`anon` could read every column of `school`, including
-- `contact_name`, `contact_email` and `contact_phone` — a named member of staff's
-- contact details — with the publishable key that ships inside every APK.**
--
-- Verified against staging on 2026-08-10 with the key from the EAS `preview` profile:
--
--   GET /rest/v1/school?select=name,contact_name,contact_email,contact_phone
--   -> [{"name":"Alpha Public School","contact_name":"Alpha Admin",
--        "contact_email":"alpha@example.invalid","contact_phone":"+919000000011"}, …]
--
-- =============================================================================
-- HOW IT HAPPENED, BECAUSE THE SHAPE MATTERS MORE THAN THE FIX
--
-- `0011` created `get_schools()` precisely to keep these columns back, and said so:
-- "**Withheld, and this is the point:** `school` also carries `contact_name`,
-- `contact_email` and `contact_phone` — a named member of staff at that school."
--
-- `0012` ([AUTH-01]) then dropped that function — correctly, "one way in" — and replaced
-- it with `grant select on school … to anon` plus the row policy `anon_school_onboarded`.
-- The row policy was written carefully. The column restriction was simply lost, because
-- **RLS filters rows and GRANTs filter columns, and only one of the two was carried over.**
--
-- The projection then lived on in `packages/shared/src/api/schools.ts` as
-- `SCHOOL_COLUMNS = 'id,name,city:city_id(name)'` — a client-side column list. A client
-- choosing not to ask for a column is not a restriction; it is a convention, and the
-- server answered anything else it was asked for. This is non-negotiable #2, and it is
-- the same defect the legacy Bubble app shipped.
--
-- -----------------------------------------------------------------------------
-- WHY COLUMN-LEVEL GRANTS RATHER THAN A VIEW
--
-- A `public_school` view would read better and would match `public_menu`. It does not
-- work here: every view in this schema is `security_invoker = true` (asserted by §12), so
-- it carries no authority of its own and the caller still needs SELECT on the underlying
-- columns. A view over a fully-granted table restricts nothing — it would look like a fix
-- and be none, which is worse than the hole, because the next person would stop looking.
--
-- Column-level privileges are the actual boundary, so they are what changes.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS DOES TO `select *`
--
-- It breaks it, for `anon`, deliberately. After this migration `GET /rest/v1/school`
-- with no explicit column list returns `42501 permission denied`. That is the intended
-- outcome: an unlisted `select *` is how a column added in two years' time — a principal's
-- mobile number, a bank detail — becomes public the day it is created, with no migration
-- and no review. Every reader must now name what it wants.
--
-- The app already does (`SCHOOL_COLUMNS`). `service_role` and `authenticated` are
-- untouched: the back office needs these columns and reaches them through its own
-- policies (`school_read_backoffice`, `0002`).
--
-- -----------------------------------------------------------------------------
-- THE ROW POLICY STILL WORKS
--
-- `anon_school_onboarded` filters on `is_active`, `onboarded_at` and `offboarded_at`,
-- none of which are granted below. That is fine and is not an oversight: an RLS policy's
-- USING expression is evaluated by the system as part of the scan, not as part of the
-- caller's projection, so it does not require the caller to hold privileges on the
-- columns it reads. `authorization.test.sql` PART 6.3 asserts exactly this — that anon
-- still sees only onboarded schools after the grant is narrowed — so if a future
-- Postgres changes that, the suite fails rather than the picker silently emptying.
-- =============================================================================

-- 1. Take the table-wide privilege away.
revoke select on school from anon;

-- 2. Give back exactly what the school picker needs, and nothing else.
--
--    `id`      — to order for, and to key a child to.
--    `name`    — what a parent recognises, and what the list sorts by.
--    `city_id` — the embed `city:city_id(name)` resolves through it; `city` has its own
--                grant and its own policy.
--
-- Deliberately NOT granted: `code`, `address_line1`, `address_line2`, `postcode`,
-- `contact_name`, `contact_email`, `contact_phone`, `kitchen_id`, `institution_type`,
-- `is_active`, `onboarded_at`, `offboarded_at`, `legacy_bubble_id`, `created_at`,
-- `updated_at`. The contact columns are a person's details. `kitchen_id` is the supply
-- graph and is nobody's business. The rest simply has no reader.
grant select (id, name, city_id) on school to anon;

comment on table school is
  'Anon holds column-level SELECT on (id, name, city_id) only — 0020/E02-30. RLS filters '
  'rows; grants filter columns, and school carries a named staff member''s contact details. '
  'A `select *` as anon is a permission error by design. Adding a column does not expose it.';
