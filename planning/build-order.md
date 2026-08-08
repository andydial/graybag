# Build order

One thing at a time. Each block finishes green before the next starts.

Filter the dashboard to **MVP (v1) only** + **Open only** to see just this work.

## Gate 0 — before any code (Andy, ~30 min)

- [ ] `gh auth login` and `npx supabase login`
- [ ] Rotate the live Razorpay key (`E00-01`)
- [ ] Confirm: Mohali-only for v1?
- [ ] Confirm: is the Excel menu `Price` GST-inclusive or exclusive? (`E00-12`)
- [ ] Read `docs/data-model.md` — every later task is built on it, and this is the
      cheapest moment to catch a wrong assumption

## Block 1 — Foundations  (E01)

Repo, branch protection, two Supabase projects in Mumbai, local Docker Postgres, per-env
secrets, CI with the ~60s smoke test, migration tooling, seed data, deploy pipeline.

**Done when:** a PR runs the smoke test and a merge deploys to staging.

## Block 2 — Schema & authorization  (E02, E20 consent tables)

Every entity, RLS default-deny, the authorization test suite asserting every allow *and*
every deny, the config resolution chain, consent and policy-version tables.

**Done when:** the authorization suite is green and fails loudly if a policy is removed.

## Block 3 — Spikes, in parallel  (E19)  ✅ closed 2026-08-08, two parked

Razorpay + UPI on a real Android · mid-range Android performance ·
VAG Rounded Next licence · Bubble export dry run.

**Done when:** each has a written answer in `docs/`. Any bad answer changes the plan now
rather than in week six.

| Spike | State |
|---|---|
| `E19-04` Bubble export dry run | **Done.** `docs/bubble-recon-findings.md`; six `E16` constraints corrected, decisions `BR1`–`BR7` and `AR1`–`AR7` |
| `E19-01` Razorpay + UPI | **Parked on Andy's handset** (expected 2026-08-09 am). All setup merged; five checklist rows already answered without a device. `docs/spike-runbook.md` §2 |
| `E19-02` Android performance | **Parked with `E19-01`** — same APK, same session |
| `E19-03` VAG Rounded Next licence | `owner:andy`, still open. `E13` proceeds on the token layer, which is typeface-agnostic by design |

`E19-05`–`E19-08` are fast-follow, not Block 3 scope. **Block 4 started without waiting** —
neither parked spike blocks the design system: `E19-02` validates `E13-05`'s framework choice
rather than deciding it.

## Block 4 — Design system  (E13)

Tokens, component library, motion spec and catalogue, skeletons, accessibility pass.
Andy reviews the motion spec once before any screen is built.

**Stopped 2026-08-09 with three tasks blocked, and the block order is why.** Everything that
can be built without a running app is done: the token module and its web output (`E13-01`),
`motion.ts` and the reduce-motion harness (`E13-12`), the contrast gate (`E13-13`), the lint
gates (`E13-11`), and the four documentation corrections (`E13-15`, `E13-16`, `E13-17`,
`E13-20`). What remains cannot start here:

| Task | Blocked on | Why |
|---|---|---|
| `E13-03` component library | **`E14-01`** — Expo scaffold, **Block 5** | `apps/mobile` is a bare workspace: no React, no React Native, no Expo, no component test runner. Building the library would mean scaffolding the app inside Block 4, and `E14-01` has its own requirements — the existing bundle IDs, the icon and splash from the brand package — that would be done twice and differently |
| `E13-08` accessibility pass | `E13-03` | Three of its four parts are already asserted at the token layer — contrast by `E13-13`, tap targets and dynamic type by `E13-01`'s tests. The fourth, screen-reader labels, needs components to label |
| `E13-10` automated a11y in CI | `E13-03`, `E12` | Axe and Lighthouse need something rendered. Untagged, so fast-follow regardless |

Plus `E13-02`, which waits on `E19-03` (`owner:andy`, the VAG Rounded Next licence), and the
two `owner:andy` tasks — `E13-09` (review the motion spec) and `E13-14` (`DS-01`).

**This is a real ordering problem, not a slip.** Block 4 is defined as including the component
library and Block 5 as including the scaffold that library needs. Either the scaffold moves
into Block 4 or the component library moves into Block 5; the second is cheaper, because the
scaffold's own task already exists and is specified. Recorded rather than fixed unilaterally —
the block boundaries are Andy's call about when tokens get spent.

## Block 5 — Menu & app shell  (E04, E14)

Menu model, Excel importer, image pipeline, menu versioning + the on-device cache, Expo
scaffold with the existing bundle ids, the `api/` module lint rule, navigation, list
virtualisation.

**Done when:** the app opens, loads a cached menu offline-fast, and refetches only on a
version change.

## Block 6 — Ordering  (E05)

Dependents, cart, cutoff enforcement (server-side), break times, order creation with
snapshots, history, cancellation, idempotency.

## Block 7 — Payments  (E06)  ← the riskiest block

In-app checkout with native UPI, webhook signature verification, idempotent handling, the
order state machine, ledger, refunds including per-line, daily reconciliation.

**Done when:** a real test-mode payment completes end to end and reconciliation is clean.

## Block 8 — Invoicing & email  (E07, E08)

Gapless invoice numbering, the GST PDF, sender domain (SPF/DKIM/DMARC), confirmation and
cancellation emails.

## Block 9 — Back office  (E09, E10)

Kitchen order list, mark delivered, reject with refund, permission split; admin school and
kitchen onboarding, menu management, Excel upload, config UI, order dashboard.

## Block 10 — Website & compliance  (E12, E20)

Homepage, enquiry form, published privacy/terms/refund, grievance officer contact,
back-office login entry, Netlify deploy. Consent capture at child creation, policy
acceptance gate, no PII in logs or Sentry.

## Block 11 — Migration  (E16)

Migration script, role mapping, data quality report, validation suite, **two full dress
rehearsals**, rollback plan.

## Block 12 — Release  (E17)

EAS build and submit, store listings, App Privacy and Data Safety forms, TestFlight and
Play internal testing, ~2 week beta with real money, cutover weekend, phased store
rollout, decommission Bubble after 30 days.
