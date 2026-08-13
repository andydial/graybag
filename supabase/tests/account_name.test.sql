-- =============================================================================
-- account_name.test.sql — the account holder's own name. `P18`, `E05-39`, migration `0030`.
--
-- `app_user.first_name` has existed since `0001` and nothing ever wrote it, so these are the
-- first assertions that the field can be set at all. What is worth testing is not "an update
-- ran" but the three rules the screens depend on:
--
--   * a blank name is refused, so no row is non-null and renders as nothing;
--   * "asked" is recorded when the question is ANSWERED, including by skipping — this is the
--     whole of `P18`'s "never asked twice";
--   * clearing a name does NOT reset that, because taking a name back is not a request to be
--     asked again on the next order.
-- =============================================================================

begin;
set local search_path = public, tests_tmp, extensions, pg_catalog;

create schema if not exists tests_tmp;
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgtap') then
    begin
      execute 'create extension pgtap with schema extensions';
    exception when others then
      execute 'create extension pgtap';
    end;
  end if;
end;
$$;

select * from no_plan();

-- Its own accounts, marked with the fixture marker (`check-test-fixtures`), so this suite
-- neither depends on nor disturbs whichever seed user happens to be first.
--
-- Through `auth.users`, not straight into `app_user`: `app_user.id` is a foreign key to it, and
-- `0018`'s trigger is what creates the row — so inserting the auth user is both the shorter
-- fixture and a second assertion that the trigger still fires.
insert into auth.users (id, email) values
  ('a0000000-7e57-0000-0000-00000000ffa1'::uuid, 'name-ffa1@example.test');

create temporary table n_ctx as
select 'a0000000-7e57-0000-0000-00000000ffa1'::uuid as user_id;

-- =============================================================================
-- 1. The starting state every real account is in.
-- =============================================================================

select is(
  (select first_name from app_user where id = (select user_id from n_ctx)),
  null,
  'E05-41: a new account has NO name — nothing has ever written app_user.first_name, and 0018''s signup trigger does not either');

select is(
  (select name_prompted_at from app_user where id = (select user_id from n_ctx)),
  null,
  'and nobody has been asked for one, which is the other half of the condition a screen tests');

-- =============================================================================
-- 2. Saving a name is also answering the question.
-- =============================================================================

select set_user_name((select user_id from n_ctx), '  Priya  ', '  Sharma  ');

select is(
  (select first_name || '|' || last_name from app_user where id = (select user_id from n_ctx)),
  'Priya|Sharma',
  'the name is trimmed on the way in — a screen that sent a trailing space must not create a name nobody can search for');

select ok(
  (select name_prompted_at is not null from app_user where id = (select user_id from n_ctx)),
  'P18: saving a name records that the question was answered, in the SAME call — leaving the stamp to a second request means a network failure between them asks again for a name we already hold');

-- =============================================================================
-- 3. A blank name is refused, and whitespace is blank.
-- =============================================================================

select throws_ok(
  format($$ select set_user_name(%L::uuid, '   ') $$, (select user_id from n_ctx)),
  'P0001',
  null,
  'whitespace is not a name: a row holding "   " is non-null and renders as nothing, so every "do we have a name" test says yes and every surface prints a blank');

select is(
  (select first_name from app_user where id = (select user_id from n_ctx)),
  'Priya',
  'and the refusal changed nothing');

-- =============================================================================
-- 4. Clearing. Allowed, because P18 says order one has no name and that must be fine
--    everywhere — so a name is something a person may give and then take back.
-- =============================================================================

select clear_user_name((select user_id from n_ctx));

select is(
  (select coalesce(first_name, '<null>') || '|' || coalesce(last_name, '<null>')
     from app_user where id = (select user_id from n_ctx)),
  '<null>|<null>',
  'a name can be removed — an edit form that refused an empty field would be claiming we need it after telling them we do not');

select ok(
  (select name_prompted_at is not null from app_user where id = (select user_id from n_ctx)),
  'and clearing it does NOT un-ask the question: they have been asked, and taking the name back is not a request to be asked again on the next order');

-- =============================================================================
-- 5. Skipping, and skipping twice.
-- =============================================================================

insert into auth.users (id, email) values
  ('a0000000-7e57-0000-0000-00000000ffa2'::uuid, 'name-ffa2@example.test');

select skip_user_name_prompt('a0000000-7e57-0000-0000-00000000ffa2'::uuid);

select ok(
  (select name_prompted_at is not null from app_user
    where id = 'a0000000-7e57-0000-0000-00000000ffa2'::uuid),
  'P18: a skip is RECORDED, not merely acted on — a skip that is not recorded is a question that comes back on the next order, and on the next device today');

create temporary table n_first as
select name_prompted_at as at from app_user
 where id = 'a0000000-7e57-0000-0000-00000000ffa2'::uuid;

select lives_ok(
  $$ select skip_user_name_prompt('a0000000-7e57-0000-0000-00000000ffa2'::uuid) $$,
  'skipping an already-skipped prompt succeeds: a second device dismissing the same prompt is not a failure');

select is(
  (select name_prompted_at from app_user where id = 'a0000000-7e57-0000-0000-00000000ffa2'::uuid),
  (select at from n_first),
  'and it does not re-stamp — the column means "when they answered", not "when they last opened the app"');

-- =============================================================================
-- 6. The identity is a parameter, so the caller decides whose row moves. That is exactly why
--    0030 grants these to service_role ONLY and the Edge Function takes the id from the JWT.
-- =============================================================================

select throws_ok(
  $$ select set_user_name('00000000-7e57-0000-0000-0000000000dd'::uuid, 'Ghost') $$,
  'P0001',
  null,
  'an account that does not exist is refused rather than silently updating nothing');

select is_empty(
  $$ select r.rolname::text
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join lateral aclexplode(p.proacl) a
       join pg_roles r on r.oid = a.grantee
      where n.nspname = 'public'
        and p.proname in ('set_user_name', 'skip_user_name_prompt', 'clear_user_name')
        and r.rolname in ('anon', 'authenticated') $$,
  'PB1: neither anon nor authenticated may execute these. They are security definer and take the user id as a PARAMETER, so a grant to authenticated would let any signed-in user rename anybody — worse than the direct UPDATE this replaced, which RLS at least confined to their own row');

select * from finish();
rollback;
