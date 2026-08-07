-- =============================================================================
-- 0001_initial_schema.down.sql — reverses 0001_initial_schema.sql
-- =============================================================================
--
-- 0001 creates the `migration` schema and, in `public`, 65 tables, 44 enum types,
-- 28 functions, 1 view, 53 indexes and 14 triggers. There is no partial reverse of
-- an initial schema, so this drops both schemas and rebuilds an empty `public`
-- carrying the grants a fresh Supabase project ships with.
--
-- DESTRUCTIVE — THIS DELETES ALL APPLICATION DATA.
--
-- It exists so that a failed *first* deploy into a fresh project can be rolled back
-- to a clean state. It is not a routine operation and it must never be run against a
-- production database that has real orders in it. `docs/migrations.md` §4 is the
-- rollback procedure; the restore-from-backup path (E01-15/E01-17) is the correct
-- answer for anything that has served a customer.
--
-- Extensions are deliberately NOT dropped. 0001 creates `citext` and `btree_gist`
-- with `if not exists`, so it cannot know whether it installed them or found them
-- already present, and dropping an extension the project had beforehand would take
-- away more than 0001 added. Extensions are additive and inert; leaving them is the
-- conservative direction.
-- =============================================================================

drop schema if exists migration cascade;
drop schema if exists public cascade;

create schema public;
alter schema public owner to postgres;

grant usage  on schema public to anon, authenticated, service_role;
grant all    on schema public to postgres, service_role;
