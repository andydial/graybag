-- =============================================================================
-- 0029_provisional_break_windows.sql — Gem and Paragon open for ordering. `P20`.
-- =============================================================================
--
-- Andy, 2026-08-11: **Gem and Paragon use the same two windows as Amity for now**, with friendly
-- labels, provisional until each school confirms its own at onboarding. Both schools open.
--
-- ## What this changes about `P19`
--
-- `P19` is unchanged as a rule: a school with no windows cannot be ordered from, and says so.
-- What changes is the *facts* — two of the three live schools had no windows, and now all three
-- do. Nothing in the app is conditional on which school it is; `CartScreen` reads the windows and
-- closes the school when the list is empty, so seeding rows here is what opens ordering. There is
-- no feature flag and no per-school branch, which is the property that makes this reversible: the
-- down migration deletes the rows and both schools go back to closed on their own.
--
-- ## Why this is not the invention the catalogue seed refused to make
--
-- `catalogue.sql` left Gem and Paragon with zero windows deliberately, and its comment says why:
-- the legacy option-set db values contradict their labels, so a window taken from that field
-- would be a time nobody agreed to. That reasoning still holds — and it is not what is happening
-- here.
--
-- These times are **not** read from the legacy option set. They are Amity's real, hand-verified
-- windows, applied to the other two schools on Andy's instruction, with the provenance recorded
-- in the column comment below and in the app-visible fact that they are the same two times.
--
-- The recon supports it independently. `docs/bubble-recon-findings.md` §7: *"`Break-Timings` only
-- defines Amity's windows, yet 10 Paragon orders and 1 Gem order use the same two label strings.
-- Break windows are effectively global, despite the `School` column implying per-school
-- configuration."* Eleven legacy orders were already served at these two windows at these two
-- schools. Copying them forward is what the business has been doing; the difference is that it is
-- now written down as provisional rather than assumed to be permanent.
--
-- Its closing advice — *"do not build a per-school break model off this data without asking"* —
-- is honoured rather than ignored. The model stays per-school (`break_time.school_id`), because
-- three schools sharing a schedule today is a fact about today, not about the model. Kitchen-wide
-- scheduling would be a schema change we would have to undo the first time one school moves its
-- lunch break by ten minutes.
--
-- ## Provisional, and how anyone will know
--
-- "Provisional" is a claim that decays silently unless it is written where the next person looks.
-- Three places carry it: this header, the `is_provisional` marker below, and `P20`. **The windows
-- are confirmed per school at onboarding** — the same conversation that fixes the menu assignment
-- and the delivery mode. When a school confirms, update its rows and clear the marker; if a
-- school confirms *different* times, that is an ordinary update, not a correction of an error.
--
-- The marker goes in `code` — `break-1-provisional` — because that column is unique per school,
-- never shown to a parent, and read by nobody at runtime, so a query answers "which windows are
-- still borrowed" without a new column. It deliberately does **not** go in `legacy_option_value`,
-- which stays NULL: these rows have no legacy option value, and putting a marker in a field whose
-- own comment says never to trust it teaches the next reader to distrust the marker too.
--
-- ## Amity's labels are fixed in the same change
--
-- Amity's `label` currently holds the time range itself — `'10:40AM - 11:15AM'` — which is the
-- defect `0001` line 374 already names and `P19` already ruled against: *"a parent picking
-- between `10:40AM - 11:15AM` and `11:15AM - 11:40AM` is reading raw data"*. The picker draws the
-- label on top and `formatBreakWindow` underneath, so Amity currently renders the time twice, in
-- two different formats, one of them 12-hour.
--
-- It is fixed here rather than in a follow-up because the alternative is worse than either end
-- state: seeding "Morning break" for Gem and Paragon while Amity keeps "10:40AM - 11:15AM" would
-- make the same window read as two different things depending on which school a parent picked.
--
-- Guarded on the exact old string, so an operator who has already renamed them is not overwritten.
--
-- ## Idempotent, and a no-op where the catalogue was never seeded
--
-- Fixed UUIDs (`SD1`), and `on conflict (school_id, code) do nothing` on the natural key, so a
-- re-run changes nothing and an environment that already has these rows keeps its own ids.
-- Nothing in the app references a break-time id as a constant; it reads the selected school's.
--
-- **`insert ... select ... join school`, not a bare `values` list.** A plain insert would raise a
-- foreign-key violation in every database that has these migrations but not the catalogue —
-- including the one `supabase db reset` builds for the pgTAP suites, which seeds the synthetic
-- fixtures and not the real schools. A migration that fails there fails the test database, and
-- the failure would arrive as a foreign-key error at migration time rather than as anything
-- resembling its cause. Joining against `school` gives 0029 the property `0024`'s header claims
-- for itself: where the catalogue has not been seeded, no row matches and this does nothing.
-- =============================================================================

insert into break_time (id, school_id, code, label, starts_at, ends_at, sort_order,
                        legacy_option_value)
select w.id, w.school_id, w.code, w.label, w.starts_at, w.ends_at, w.sort_order, null
  from (values
    -- Gem Public School
    ('b1e9c0d2-1f4a-4a7e-9c3b-0e5a7d6c8f01'::uuid, '79752fe3-841f-45b6-a47b-1169ce70e648'::uuid,
     'break-1-provisional', 'Morning break', '10:40:00'::time, '11:15:00'::time, 10::smallint),
    ('b1e9c0d2-1f4a-4a7e-9c3b-0e5a7d6c8f02'::uuid, '79752fe3-841f-45b6-a47b-1169ce70e648'::uuid,
     'break-2-provisional', 'Second break',  '11:15:00'::time, '11:40:00'::time, 20::smallint),
    -- Paragon Senior Secondary
    ('b1e9c0d2-1f4a-4a7e-9c3b-0e5a7d6c8f03'::uuid, '50994394-8557-4985-a76f-707d16a83c1a'::uuid,
     'break-1-provisional', 'Morning break', '10:40:00'::time, '11:15:00'::time, 10::smallint),
    ('b1e9c0d2-1f4a-4a7e-9c3b-0e5a7d6c8f04'::uuid, '50994394-8557-4985-a76f-707d16a83c1a'::uuid,
     'break-2-provisional', 'Second break',  '11:15:00'::time, '11:40:00'::time, 20::smallint)
  ) as w (id, school_id, code, label, starts_at, ends_at, sort_order)
  join school s on s.id = w.school_id
on conflict (school_id, code) do nothing;

-- Amity's real windows get the friendly names the picker was built for. Guarded on the exact
-- string that came out of the export, so a hand-edited label survives.
update break_time set label = 'Morning break', updated_at = now()
 where school_id = '77308e75-d8e9-47ba-a503-7c38d482a72c'
   and code = 'break-1'
   and label = '10:40AM - 11:15AM';

update break_time set label = 'Second break', updated_at = now()
 where school_id = '77308e75-d8e9-47ba-a503-7c38d482a72c'
   and code = 'break-2'
   and label = '11:15AM - 11:40AM';

comment on column break_time.code is
  'Internal, never shown to a parent. A code ending `-provisional` marks a window BORROWED FROM ANOTHER SCHOOL rather than confirmed by this one: 0029 gave Gem Public School and Paragon Senior Secondary Amity''s two windows on Andy''s instruction (2026-08-11) so both schools could open for ordering, to be confirmed per school at onboarding. `select school_id, code from break_time where code like ''%-provisional''` lists what is still borrowed. When a school confirms, set its real times and rename the code.';
