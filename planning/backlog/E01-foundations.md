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

- [ ] `E01-00` (owner:andy) (mvp) One-off: authorise the GitHub (`gh auth login`) and Supabase CLIs on your machine — after this the build side creates and manages both
- [ ] `E01-01` (mvp) Create GitHub repo, private, monorepo layout (`apps/mobile`, `apps/web`, `packages/shared`, `supabase/`)
- [ ] `E01-02` (mvp) Branch protection on `main`: PR required, CI must pass, no direct pushes
- [ ] `E01-03` `CONTRIBUTING.md` + `CLAUDE.md` (project conventions for Claude Code) + `README.md`
- [ ] `E01-04` (mvp) Create Supabase **staging** project in Mumbai (`ap-south-1`)
- [ ] `E01-05` (mvp) Create Supabase **production** project in Mumbai (`ap-south-1`)
- [ ] `E01-06` (mvp) Local dev: Docker Postgres + Supabase CLI, seed script, works fully offline
- [ ] `E01-07` (risk:high) (mvp) Secrets per environment — Razorpay **test** keys in staging, **live** keys in prod, never in code, never hand-edited
- [ ] `E01-08` (mvp) CI pipeline: typecheck, lint, unit tests, integration tests against a seeded ephemeral DB
- [ ] `E01-08a` (risk:high) CI security gates: **gitleaks** secret scanning (pre-commit and CI), Dependabot/Renovate, `npm audit` gate
- [ ] `E01-09` PR preview environments with a throwaway seeded database, destroyed on merge
- [ ] `E01-10` (mvp) Database migration tooling + rule that every schema change ships as a reversible migration
- [ ] `E01-11` Test harness: unit (Vitest), integration (against real Postgres), E2E mobile (Maestro or Detox), E2E web (Playwright)
- [ ] `E01-12` Coverage gate with an **actual threshold number** + a `test:all` command that must be green before any merge
- [ ] `E01-13` (mvp) Seed/fixture data representing 3 schools, 1 kitchen, 3 menus, several users and dependents
- [ ] `E01-14` (mvp) Deploy pipeline: merge to `main` -> staging; tagged release -> production, with manual approval
- [ ] `E01-15` (risk:critical) Enable **Supabase PITR** on production; define RPO and RTO explicitly
- [ ] `E01-16` (risk:critical) Off-Supabase encrypted export of database + storage on a schedule (do not rely on a single vendor)
- [ ] `E01-17` (risk:critical) **Timed restore drill** — restore a backup into a clean project and verify integrity. Phase 1 exit gate, repeated before cutover
- [ ] `E01-18` (risk:high) CI check that no `service_role` key or Razorpay secret ever appears in the mobile bundle or the web client build output
- [ ] `E01-19` **Provider stub server for Razorpay** (answers `/v1/orders`, `/v1/payments/:id`, `/v1/payments/:id/refund`, `/v1/payments`, `/v1/refunds`, `/v1/settlements/recon/combined`) built from the `docs/payments-design.md` §12 checklist, used by the offline CI payment tests in `docs/testing-strategy.md` §5. Must be corrected against `E19-01`'s answers when they land. Overlaps `E06-13` — if `E06-13` already owns the fixtures, fold this in there rather than duplicating
