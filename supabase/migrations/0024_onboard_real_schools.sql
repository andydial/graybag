-- =============================================================================
-- 0024_onboard_real_schools.sql — make the real schools visible. E16-48.
-- =============================================================================
--
-- `supabase/seeds/catalogue.sql` inserts the three real Mohali schools, but its first
-- application predated the `onboarded_at` column being set, and **a changed seed file is not
-- re-applied**: `supabase db push --include-seed` notices the new hash, prints "Updating seed
-- hash", records it, and does not execute the file. So the correction had nowhere to run.
-- Recorded in docs/learnings.md — it is a silent no-op, which is the dangerous kind.
--
-- Migrations always run, so the correction lives here instead.
--
-- ## Why this matters more than it looks
--
-- `anon_school_onboarded` is `is_active and onboarded_at is not null and offboarded_at is null`.
-- With `onboarded_at` null, three real schools with 119 priced menu rows behind them were
-- invisible to every signed-out visitor: the school picker returned an empty list and the app
-- rendered "no schools" — a configuration gap wearing the costume of an empty database, which is
-- exactly the `docs/ux-spec.md` §5.21 conflation the whole N1/N2 distinction exists to prevent.
--
-- ## Safe in production
--
-- Idempotent and doubly guarded: it names three ids and only fills a NULL. The ids are derived
-- deterministically from the legacy Bubble ids (see tools/seed-catalogue/build.mjs), so they are
-- the same rows in every environment — but in an environment where the catalogue has not been
-- seeded, no row matches and this is a no-op. It never *un*-onboards anything, and it never
-- overwrites a date somebody set deliberately.
--
-- The dates are the schools' real menu-assignment start dates from Bubble, not now().

update school set onboarded_at = '2025-10-16T00:00:00+05:30', updated_at = now()
 where id = '77308e75-d8e9-47ba-a503-7c38d482a72c'   -- Amity International School
   and onboarded_at is null;

update school set onboarded_at = '2026-05-22T00:00:00+05:30', updated_at = now()
 where id = '50994394-8557-4985-a76f-707d16a83c1a'   -- Paragon Senior Secondary
   and onboarded_at is null;

update school set onboarded_at = '2025-10-16T00:00:00+05:30', updated_at = now()
 where id = '79752fe3-841f-45b6-a47b-1169ce70e648'   -- Gem Public School
   and onboarded_at is null;

-- The synthetic fixture schools, retired for the same reason the seed retires them: Alpha Public
-- School sitting beside Amity International School in a live picker is a confusion we introduced.
-- Deactivated by id, never deleted (E05-21), so the E05-16 test order keeps its references.
update school set is_active = false, updated_at = now()
 where id in ('50000000-0000-0000-0000-000000000001',
              '50000000-0000-0000-0000-000000000002',
              '50000000-0000-0000-0000-000000000003');

update menu set status = 'retired'
 where id in ('e0000000-0000-0000-0000-000000000001',
              'e0000000-0000-0000-0000-000000000002',
              'e0000000-0000-0000-0000-000000000003')
   and status <> 'retired';
