-- 0027_public_break_times.sql — the break windows a parent picks from. `E05-30`, `P19`.
--
-- ## Why anon needs this
--
-- `P19`: the parent chooses the break window at checkout, from the school's real windows, and
-- **a school with no windows cannot be ordered from at all**. Two of the three live schools
-- have none, so "closed for ordering" is a state the app has to be able to show.
--
-- Until now `break_time` was `authenticated`-only. That would mean a signed-out visitor could
-- browse Gem Public School's menu, fill a cart, tap Place order, sign in — and only then be
-- told we cannot serve their school. Making them identify themselves in order to be turned
-- away is the worst version of this. `AR7` is about not walling browsing; it is not a reason
-- to withhold the one fact that decides whether browsing can lead anywhere.
--
-- ## What is exposed
--
-- `id`, `school_id`, `label`, `starts_at`, `ends_at`, `sort_order` — a time of day and a name
-- for it, for an already-public school. `0002`'s own comment on the neighbouring policy says
-- it outright: *"Class labels and break times are not personal data."*
--
-- `legacy_option_value` is **withheld**, and that is deliberate: its column comment says never
-- to trust it, because the legacy option-set db values contradict their labels. Publishing a
-- value we have documented as wrong is worse than publishing nothing.
--
-- ## This widens the anon surface, and that is a deliberate act
--
-- `authorization.test.sql` pins the anon-readable set exactly and fails when a policy is
-- **added**, which is the direction that leaks. `0011`'s header explains why that friction
-- exists: a list of approved exceptions grows quietly, and the pin is what makes each addition
-- loud. This is the fourth, it is argued above, and the suite is updated in the same commit.
--
-- ## Only windows that can actually be ordered against
--
-- `is_active`, and only for a school that is itself publicly visible. A window belonging to a
-- school nobody can see is not something anyone can order against.
--
-- **Through `auth_school_is_public()`, not an inline `exists`.** The inline version was written
-- first and failed: a policy predicate runs as the *caller*, and `anon` holds only column
-- grants on `school` (`id, name, city_id` — `0020`), so a subquery reading `is_active`,
-- `onboarded_at` and `offboarded_at` is `permission denied for table school`. The helper is
-- `security definer` and already exists for exactly this; `break_time_read_all` beside it uses
-- the same one. Granting anon three more `school` columns to satisfy a subquery would have
-- widened the surface further to answer a question the helper already answers.

-- The helper is not anon-executable by default (the privilege baseline revokes the `auth_*`
-- family from anon), so this is the second deliberate widening in this migration.
--
-- It is the narrower of the two options. The alternative was granting anon `is_active`,
-- `onboarded_at` and `offboarded_at` on `school` so an inline subquery could read them — three
-- more columns, on the table that also carries a named staff member's contact details. This
-- function returns a **boolean about an already-public fact**: anon can already list public
-- schools (`0020` grants `id, name, city_id`; `anon_school_onboarded` limits the rows), so "is
-- this school public" is derivable from what anon can already see. It discloses nothing new.
grant execute on function auth_school_is_public(uuid) to anon;

grant select (id, school_id, label, starts_at, ends_at, sort_order) on break_time to anon;

create policy anon_break_time_of_visible_school on break_time
  for select to anon
  using (is_active and auth_school_is_public(school_id));

comment on policy anon_break_time_of_visible_school on break_time is
  'E05-30 / P19. A signed-out visitor must be able to learn that a school has no orderable break windows BEFORE building a cart — otherwise the only way to find out is to sign in and be turned away. Break times are not personal data (see the break_time_read_all policy comment in 0002).';
