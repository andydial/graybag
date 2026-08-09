---
id: E01
title: Foundations — Repo, CI, Environments
phase: 1
risk: medium
status: not-started
depends_on: [E00]
summary: Repo, two real environments, secrets management, and the test harness that every later task depends on.
---

## Why early

Everything after this inherits the quality bar set here. Getting tests and environments right on day one is what stops "manually swapping Razorpay keys" happening again.

## Tasks

- [x] `E01-00` (owner:andy) (mvp) One-off: authorise the GitHub (`gh auth login`) and Supabase CLIs on your machine — after this the build side creates and manages both
- [x] `E01-01` (mvp) Create GitHub repo, private, monorepo layout (`apps/mobile`, `apps/web`, `packages/shared`, `supabase/`)
- [x] `E01-02` (mvp) Branch protection on `main`: PR required, CI must pass, no direct pushes
- [ ] `E01-03` `CONTRIBUTING.md` + `CLAUDE.md` (project conventions for Claude Code) + `README.md`
- [x] `E01-04` (mvp) Create Supabase **staging** project in Mumbai (`ap-south-1`)
- [ ] `E01-05` (mvp) Create Supabase **production** project in Mumbai (`ap-south-1`)
- [ ] `E01-06` (mvp) Local dev: Docker Postgres + Supabase CLI, seed script, works fully offline
- [x] `E01-07` (risk:high) (mvp) Secrets per environment — Razorpay **test** keys in staging, **live** keys in prod, never in code, never hand-edited
- [x] `E01-08` (mvp) CI pipeline: typecheck, lint, unit tests, integration tests against a seeded ephemeral DB
- [ ] `E01-08a` (risk:high) CI security gates: **gitleaks** secret scanning (pre-commit and CI), Dependabot/Renovate, `npm audit` gate
- [ ] `E01-09` PR preview environments with a throwaway seeded database, destroyed on merge
- [x] `E01-10` (mvp) Database migration tooling + rule that every schema change ships as a reversible migration
- [ ] `E01-11` Test harness: unit (Vitest), integration (against real Postgres), E2E mobile (Maestro or Detox), E2E web (Playwright)
- [ ] `E01-12` Coverage gate with an **actual threshold number** + a `test:all` command that must be green before any merge
- [x] `E01-13` (mvp) Seed/fixture data representing 3 schools, 1 kitchen, 3 menus, several users and dependents
- [ ] `E01-14` (mvp) Deploy pipeline: merge to `main` -> staging; tagged release -> production, with manual approval
- [ ] `E01-15` (risk:critical) Enable **Supabase PITR** on production; define RPO and RTO explicitly
- [ ] `E01-16` (risk:critical) Off-Supabase encrypted export of database + storage on a schedule (do not rely on a single vendor)
- [ ] `E01-17` (risk:critical) **Timed restore drill** — restore a backup into a clean project and verify integrity. Phase 1 exit gate, repeated before cutover
- [ ] `E01-18` (risk:high) CI check that no `service_role` key or Razorpay secret ever appears in the mobile bundle or the web client build output
- [ ] `E01-20` (owner:andy) (risk:high) **Put the staging Supabase credentials into GitHub Actions secrets** — `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` and the staging project ref. `E01-04` created the project, but the values were never supplied, so **`Deploy to staging` has failed on every run since 2026-08-08** (`supabase link --project-ref ""`). CI's required checks are unaffected and green; nothing has ever actually deployed
- [ ] `E01-21` (owner:andy) **Supply the staging client env values** — the staging Supabase URL and anon key, plus the Razorpay **test** key id (`rzp_test_…`), either into `apps/mobile/.env.staging` (from `.env.staging.example`) or as EAS environment variables. Without them a staging build compiles but opens to an app that cannot reach any backend, so there is nothing to look at on a handset. EAS builds from a git archive, so a gitignored `.env.staging` is **not** uploaded — for a real device build these must be EAS env vars, not a local file
- [ ] `E01-19` **Provider stub server for Razorpay** (answers `/v1/orders`, `/v1/payments/:id`, `/v1/payments/:id/refund`, `/v1/payments`, `/v1/refunds`, `/v1/settlements/recon/combined`) built from the `docs/payments-design.md` §12 checklist, used by the offline CI payment tests in `docs/testing-strategy.md` §5. Must be corrected against `E19-01`'s answers when they land. Overlaps `E06-13` — if `E06-13` already owns the fixtures, fold this in there rather than duplicating
