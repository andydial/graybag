-- =============================================================================
-- 0002_rls_policies.down.sql — reverses 0002_rls_policies.sql
-- =============================================================================
--
-- 0001 leaves every table in `public` and `migration` with RLS enabled and NO
-- policies, which is default deny (D17). 0002 is the complete set of named
-- exceptions to that. So the reverse of 0002 is: drop every policy in those two
-- schemas, drop the triggers and helper functions it added, and return to
-- default deny. That is a *safe* direction to move in — the database ends up
-- denying more, not less.
--
-- TWO THINGS ARE DELIBERATELY NOT REVERSED:
--
-- 1. The revokes against `anon` (0002 §12) are left in place. 0002 revokes all
--    table, sequence and function privileges from `anon` and strips them from the
--    default privileges. Re-granting them here would be a down migration that
--    *widens* access to the role that must hold exactly zero ([AZ-03]), and a
--    rollback script is the last place anyone is watching for that. If a future
--    migration ever needs those grants back it does so explicitly, in an up
--    migration, with the authorization suite asserting the new state.
--
-- 2. Storage buckets are removed only when empty. `delete from storage.buckets`
--    on a bucket holding objects either fails on the foreign key or orphans the
--    files depending on the Supabase version, and losing issued invoice PDFs to a
--    rollback is not an acceptable failure mode. A non-empty bucket is left alone
--    and reported with a notice.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Triggers added by 0002 (§6.1, the protected-column guard)
-- -----------------------------------------------------------------------------
drop trigger if exists guard_protected_columns on app_user;
drop trigger if exists guard_protected_columns on recipient;
drop trigger if exists guard_protected_columns on guardian_link;
drop trigger if exists guard_protected_columns on data_subject_request;

-- -----------------------------------------------------------------------------
-- 2. Every policy in `public` and `migration`
--
-- Dropped by enumeration rather than by name: 0002 creates 140 of them, and a
-- hand-maintained list here would drift from the one in 0002 the first time a
-- policy is added. Enumerating is also strictly correct — 0001 guarantees the
-- starting state is zero policies, so "drop them all" *is* the inverse.
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname in ('public', 'migration')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    n := n + 1;
  end loop;
  raise notice '0002 down: dropped % policy/policies', n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Helper functions added by 0002
--
-- Named explicitly (so this cannot silently drop a function some other migration
-- added) but resolved through pg_proc, so overloads are handled without this file
-- having to restate 28 argument lists that would rot on the first signature change.
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select n.nspname as schema_name,
           p.proname  as func_name,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'auth_break_time_school_id',
        'auth_can',
        'auth_can_manage_recipient',
        'auth_can_on_dish',
        'auth_can_on_group',
        'auth_can_on_menu',
        'auth_can_on_menu_item',
        'auth_can_on_order',
        'auth_can_on_refund',
        'auth_can_order_for_recipient',
        'auth_can_platform',
        'auth_can_reach_recipient',
        'auth_can_reach_school',
        'auth_can_see_report_asset',
        'auth_customer_can_see_dish',
        'auth_customer_can_see_menu',
        'auth_has_any_grant',
        'auth_is_back_office',
        'auth_is_live_user',
        'auth_is_privileged_role',
        'auth_owns_group',
        'auth_owns_invoice',
        'auth_owns_order',
        'auth_owns_refund',
        'auth_recipient_has_visible_order',
        'auth_school_is_public',
        'effective_config_public',
        'trg_guard_protected_columns'
      )
  loop
    execute format('drop function if exists %I.%I(%s)', r.schema_name, r.func_name, r.args);
    n := n + 1;
  end loop;
  raise notice '0002 down: dropped % helper function(s)', n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Storage buckets — only when empty (see the header)
-- -----------------------------------------------------------------------------
do $$
declare
  b text;
  used bigint;
begin
  if to_regclass('storage.buckets') is null then
    raise notice '0002 down: storage.buckets is absent; nothing to remove';
    return;
  end if;

  foreach b in array array['dish-images', 'invoices', 'reports', 'imports']
  loop
    execute 'select count(*) from storage.objects where bucket_id = $1' into used using b;
    if used > 0 then
      raise notice '0002 down: bucket % holds % object(s); left in place', b, used;
    else
      delete from storage.buckets where id = b;
    end if;
  end loop;
end;
$$;
