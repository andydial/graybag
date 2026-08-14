-- =============================================================================
-- 0055_minimum_app_version.sql — the force-update gate. `E17-46`.
-- =============================================================================
--
-- Andy, 2026-08-15: a mandatory parent update on 19 August, and *"this is what makes the 19th
-- update mandatory in practice"*. Without it, "mandatory" is a store listing and an email; a
-- parent on 3.7.0 keeps using the old app against a schema it does not know about.
--
-- =============================================================================
-- THE FLOOR IS DATA, NOT A DEPLOY
-- =============================================================================
--
-- The obvious implementation is a constant in the app. It cannot work: a constant can only be
-- raised by shipping a build, and the population this exists to control is precisely the one that
-- has not taken the new build. The floor has to live somewhere the old app asks about, so it
-- lives in `platform_config` and is changed by an UPDATE.
--
-- That also means the 19th does not need a deploy. Andy raises one integer and every old build
-- finds out the next time it opens.
--
-- =============================================================================
-- ADVISORY AT THE API, BLOCKING IN THE APP — AND NOT THE REVERSE
-- =============================================================================
--
-- This function **reports**. It does not refuse anything, and no other function calls it.
--
-- A server that hard-refuses every request from an old build turns "please update" into an app
-- that appears broken — and the moment it would first happen is a parent mid-order on the
-- morning of the 19th, whose cart then fails with a network error. The app is where the
-- conversation belongs, because the app can say *why* and link to the store.
--
-- The trade is real and I am taking it deliberately: a modified client can ignore this. That is
-- acceptable for a compatibility floor, and it would not be acceptable for an authorisation
-- check — which is why this is the only guard in the system built this way.
--
-- =============================================================================
-- NUMERIC COMPARISON, REUSED
-- =============================================================================
--
-- `policy_version_rank` already turns `'4.0.0'` into `{4,0,0}` and already exists because
-- `E20-50` found `'9' > '10'` under text ordering recording consent against superseded wording.
-- A version floor has exactly the same failure mode — `'3.10.0' < '3.9.0'` as text — so it reuses
-- that function rather than adding a second comparator that can drift from it.
-- =============================================================================

alter table platform_config
  add column if not exists min_supported_app_version text not null default '0.0.0',
  -- Nullable: the app has a sensible default sentence, and a config row that has not been given
  -- one must not render an empty dialog. When it IS set it wins, so the wording on the 19th can
  -- be changed without a deploy — which is the whole point of the column.
  add column if not exists update_required_message text;

-- Guarded, so re-running the migration is a no-op. `add constraint` has no `if not exists`, and
-- a migration that raises on its second pass is a migration that cannot be replayed onto a
-- database somebody has already partially applied it to — which is exactly the situation a
-- launch week produces.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'platform_config_min_version_shape'
       and conrelid = 'platform_config'::regclass
  ) then
    alter table platform_config
      add constraint platform_config_min_version_shape
        check (min_supported_app_version ~ '^[0-9]+(\.[0-9]+)*$');
  end if;
end $$;

comment on column platform_config.min_supported_app_version is
  'E17-46. The oldest app build allowed to operate. DATA, not a constant in the app: a constant '
  'can only be raised by shipping a build, and the population this controls is the one that has '
  'not taken the new build. Default 0.0.0 = no floor, which is the correct state until a '
  'mandatory update is actually declared. Compared with policy_version_rank(), NOT as text — '
  '3.10.0 sorts below 3.9.0 as a string (E20-50).';

comment on column platform_config.update_required_message is
  'E17-46. Optional override for the sentence the app shows. Null means the app uses its own '
  'default, which must always be present — an empty dialog is worse than a generic one.';

-- -----------------------------------------------------------------------------
-- The one question the app asks, and the only place the comparison is made.
--
-- `anon`-executable on purpose: a parent on an unsupported build must be told so **before**
-- signing in. Gating this behind a session would mean the oldest builds — the ones most likely
-- to fail at the auth call itself — never receive the message.
-- -----------------------------------------------------------------------------
create or replace function app_version_support(p_version text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_min  text;
  v_msg  text;
  v_ok   boolean;
begin
  select min_supported_app_version, update_required_message
    into v_min, v_msg
    from platform_config where id = 1;

  -- No config row is not the app's fault and must not lock anybody out.
  if v_min is null then
    return jsonb_build_object('supported', true, 'minimum_version', null, 'message', null);
  end if;

  -- ---------------------------------------------------------------------------
  -- **An unknown version is SUPPORTED, and this is the load-bearing choice.**
  --
  -- Null, empty, or something that is not a dotted number — a build that forgot the header, a
  -- future format, a `4.0.0-rc1` — all resolve to "let them through".
  --
  -- The safe direction for a compatibility floor is the opposite of the safe direction for an
  -- authorisation check, and it is worth being explicit about why. A parent wrongly locked out
  -- has **no way to recover**: the screen tells them to update, the store says they are already
  -- on the latest build, and they cannot order lunch. A parent wrongly let through gets an app
  -- that mostly works. Between an unrecoverable false positive and a recoverable false negative,
  -- this takes the second.
  --
  -- `~` rather than a cast, because `policy_version_rank` is STRICT but not total: it raises on
  -- '4.0.0-rc1' rather than returning null, and a raise here is a 500 that reads as an outage.
  -- ---------------------------------------------------------------------------
  if p_version is null or p_version !~ '^[0-9]+(\.[0-9]+)*$' then
    return jsonb_build_object(
      'supported', true, 'minimum_version', v_min, 'message', null,
      'reason', 'version_not_stated');
  end if;

  -- ---------------------------------------------------------------------------
  -- **Padded to the same length before comparing**, because `4.0` and `4.0.0` are the same
  -- version and an int[] comparison says they are not: a shorter array is a prefix of a longer
  -- one and sorts below it.
  --
  -- This is not a nicety. `compareVersions()` in `packages/shared` pads with `?? 0` and calls
  -- them equal, so without this the client and the server disagree about whether a build is at
  -- the floor — and the server's answer is the one that locks a parent out.
  --
  -- **`policy_version_rank` has the same divergence and is NOT fixed here.** Its comment claims
  -- it mirrors `compareVersions()`; on trailing zeros (`'2'` vs `'2.0'`) it does not. It is used
  -- to pick the current policy version, versions there are short and hand-authored, and changing
  -- consent selection during a launch week is not a trade worth taking for a case nobody has
  -- written. Filed as `E20-56`.
  -- ---------------------------------------------------------------------------
  declare
    v_a int[] := policy_version_rank(p_version);
    v_b int[] := policy_version_rank(v_min);
    v_n int   := greatest(array_length(v_a, 1), array_length(v_b, 1));
  begin
    select array_agg(coalesce(v_a[i], 0) order by i), array_agg(coalesce(v_b[i], 0) order by i)
      into v_a, v_b
      from generate_series(1, v_n) i;

    v_ok := v_a >= v_b;
  end;

  return jsonb_build_object(
    'supported', v_ok,
    'minimum_version', v_min,
    'message', case when v_ok then null else v_msg end);
end;
$$;

comment on function app_version_support(text) is
  'E17-46. Reports whether a build may operate; REFUSES NOTHING and is called by no other '
  'function. A server that hard-refuses an old build turns "please update" into an app that '
  'appears broken, and the first time it would happen is a parent mid-order on the morning of the '
  'mandatory update — so the app blocks and the server reports. anon-executable because a parent '
  'must be told before signing in, and the oldest builds are the ones most likely to fail at the '
  'auth call itself. An UNKNOWN or unparseable version is SUPPORTED: a wrongly locked-out parent '
  'cannot recover (the store says they are already current), a wrongly admitted one gets an app '
  'that mostly works.';

revoke all on function app_version_support(text) from public;
grant execute on function app_version_support(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
