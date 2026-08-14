-- =============================================================================
-- minimum_app_version.test.sql — the force-update gate. `E17-46`.
--
-- Two properties carry the whole feature, and they pull in opposite directions:
--
--   1. **An old build is told it is old.** Otherwise "mandatory update" is a store listing.
--   2. **An unknown build is NOT.** A parent wrongly locked out cannot recover — the screen says
--      update, the store says they are current, and lunch cannot be ordered.
--
-- Plus the one that makes both meaningful: the comparison is **numeric**. `'3.10.0' < '3.9.0'` as
-- text, and a floor of 3.9.0 that admits 3.10.0's predecessor while rejecting its successor is
-- worse than no floor, because it looks like it is working.
-- =============================================================================

begin;
set local search_path = public, tests_tmp, extensions, pg_catalog;
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgtap') then
    begin execute 'create extension pgtap with schema extensions';
    exception when others then execute 'create extension pgtap'; end;
  end if;
end;
$$;
create schema if not exists tests_tmp;
select * from no_plan();

-- =============================================================================
-- 0. The default is NO floor. Every environment starts here and most stay here.
-- =============================================================================

select is(
  (select min_supported_app_version from platform_config where id = 1),
  '0.0.0',
  'the shipped default is 0.0.0 — no floor, which is the correct state until a mandatory '
  'update is actually declared');

select ok(
  ((select app_version_support('3.7.0'))->>'supported')::boolean,
  'so an old build is admitted while no floor is set — turning this on is a deliberate act');

-- =============================================================================
-- 1. With a floor: old refused, current and newer admitted.
-- =============================================================================

update platform_config
   set min_supported_app_version = '4.0.0',
       update_required_message = 'Please update GrayBag to keep ordering.'
 where id = 1;

select ok(not ((select app_version_support('3.7.0'))->>'supported')::boolean,
          '3.7.0 below a 4.0.0 floor is NOT supported — the live listing''s version, which is '
          'the exact build this gate exists for');

select ok(((select app_version_support('4.0.0'))->>'supported')::boolean,
          '4.0.0 exactly at the floor IS supported — the boundary is >=, not >, or the build '
          'you just shipped locks itself out');

select ok(((select app_version_support('4.1.2'))->>'supported')::boolean,
          'and anything above it');

select is(
  (select app_version_support('3.7.0'))->>'message',
  'Please update GrayBag to keep ordering.',
  'an unsupported build gets the configured sentence, so the wording on the 19th changes '
  'without a deploy');

select is(
  (select app_version_support('4.0.0'))->>'message',
  null,
  'and a supported one gets no message to render');

select is(
  (select app_version_support('4.0.0'))->>'minimum_version',
  '4.0.0',
  'the floor is reported either way — the app can log what it was compared against');

-- =============================================================================
-- 2. NUMERIC, not text. The assertion that would fail on the obvious implementation.
-- =============================================================================

update platform_config set min_supported_app_version = '3.9.0' where id = 1;

select ok(((select app_version_support('3.10.0'))->>'supported')::boolean,
          '3.10.0 is ABOVE a 3.9.0 floor — as text it sorts below, which is E20-50''s bug in a '
          'new place and would lock out every build after 3.9');

select ok(not ((select app_version_support('3.8.9'))->>'supported')::boolean,
          'and 3.8.9 is genuinely below it');

update platform_config set min_supported_app_version = '4.0.0' where id = 1;

select ok(((select app_version_support('4.0'))->>'supported')::boolean,
          'a shorter version compares part by part rather than by length — 4.0 is not below 4.0.0');

select ok(((select app_version_support('10.0.0'))->>'supported')::boolean,
          'and 10.0.0 is above 4.0.0, which string comparison would deny');

-- =============================================================================
-- 3. UNKNOWN IS ADMITTED. The direction that is safe here and unsafe almost everywhere else.
-- =============================================================================

select ok(((select app_version_support(null))->>'supported')::boolean,
          'a build that states no version is ADMITTED — a wrongly locked-out parent cannot '
          'recover, a wrongly admitted one gets an app that mostly works');

select ok(((select app_version_support(''))->>'supported')::boolean,
          'and so is an empty one');

select ok(((select app_version_support('4.0.0-rc1'))->>'supported')::boolean,
          'and a pre-release tag, which policy_version_rank would RAISE on — a 500 here reads '
          'as an outage and locks out the same parent more confusingly');

select ok(((select app_version_support('not-a-version'))->>'supported')::boolean,
          'and outright rubbish');

select is(
  (select app_version_support(null))->>'reason',
  'version_not_stated',
  'the admission is labelled, so a client that silently stopped sending its version is '
  'visible rather than indistinguishable from a supported one');

-- =============================================================================
-- 4. Reachable by the callers that need it — including before sign-in.
-- =============================================================================

select ok(has_function_privilege('anon', 'app_version_support(text)', 'execute'),
          'anon may ask: a parent on an unsupported build must be told BEFORE signing in, and '
          'the oldest builds are the ones most likely to fail at the auth call itself');

select ok(has_function_privilege('authenticated', 'app_version_support(text)', 'execute'),
          'and so may a signed-in parent');

-- STABLE, not VOLATILE: it is a read, and the app may call it on every foreground.
select is(
  (select provolatile from pg_proc where proname = 'app_version_support'),
  's'::"char",
  'STABLE — it reads config and decides nothing else');

-- =============================================================================
-- 5. The shape constraint: a floor nobody can parse is a floor nobody is held to.
-- =============================================================================

select throws_ok(
  $$ update platform_config set min_supported_app_version = 'four' where id = 1 $$,
  '23514', null,
  'a non-numeric floor is refused at the column — otherwise it silently admits everybody, '
  'because an unparseable version compares as unknown and unknown is admitted');

select * from finish();
rollback;
