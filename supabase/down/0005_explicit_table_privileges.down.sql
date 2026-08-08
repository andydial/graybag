-- =============================================================================
-- 0005_explicit_table_privileges.down.sql — reverses 0005
-- =============================================================================
--
-- BE CLEAR ABOUT WHAT THIS ROLLBACK DOES, BECAUSE IT IS ASYMMETRIC BY ENVIRONMENT.
--
-- 0005 granted `authenticated` the baseline §10 assumes and then re-applied 0001's
-- and 0002's revokes on top. Undoing it removes the grant. What that leaves behind
-- depends on where you run it:
--
--   * On a HOSTED project, the platform's own default privileges granted the same
--     thing before 0005 existed. Revoking here takes those away too — Postgres does
--     not record who granted what for you to unpick. The end state is therefore NOT
--     the pre-0005 state: it is `authenticated` with no privilege in public, and an
--     app that returns "permission denied" for every read. That is a bigger outage
--     than whatever prompted the rollback.
--
--   * On the LOCAL/CI stack, this restores the broken state 0005 was written to fix
--     — the authorization suite goes back to failing in its Part 0 harness.
--
-- So this file exists to satisfy MG2 (a migration that cannot be rolled back is
-- worse than one that can) and to make the asymmetry a matter of record. It is NOT
-- a routine operation. Against production it is close to an outage switch, and if
-- you are reaching for it there, the recovery is almost certainly to re-run 0005
-- rather than to stay here.
--
-- The revokes from 0001 and 0002 are deliberately NOT undone. They are the security
-- model; they were correct before 0005 and remain correct after it. Rolling back the
-- baseline must never re-open a class-3 write.
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    alter default privileges in schema public
      revoke select, insert, update, delete on tables from authenticated;
    alter default privileges in schema public
      revoke usage, select on sequences from authenticated;

    revoke usage, select on all sequences in schema public from authenticated;
    revoke select, insert, update, delete
      on all tables in schema public from authenticated;

    -- Schema USAGE is left in place. It is not what 0005 was about, other things
    -- depend on it, and removing it turns a permission error into a confusing
    -- "schema does not exist" class of failure.
  end if;
end;
$$;
