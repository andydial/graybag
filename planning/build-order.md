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

**Closed 2026-08-09.** Everything that can be built without a running app is done: the token
module and its web output (`E13-01`), `motion.ts` and the reduce-motion harness (`E13-12`), the
contrast gate (`E13-13`), the lint gates (`E13-11`), and the four documentation corrections
(`E13-15`, `E13-16`, `E13-17`, `E13-20`). `E13-14` / `DS-01` is **approved** — see below.

**Three tasks moved to Block 5, 2026-08-09, on Andy's ruling.** Block 4 was defined as
including the component library and Block 5 as including the Expo scaffold that library needs;
`apps/mobile` had no React, no React Native and no component test runner, so `E13-03` could not
start. Moving the library was the cheaper of the two fixes — `E14-01` already exists and is
specified, including the bundle IDs and the icon and splash from the brand package, and doing
it twice would have produced two different scaffolds.

| Moved | Now sits after | Why |
|---|---|---|
| `E13-03` component library | `E14-01` | Needs the Expo scaffold and a component test runner |
| `E13-08` accessibility pass | `E13-03` | Three of its four parts are already asserted at the token layer — contrast by `E13-13`, tap targets and dynamic type by `E13-01`'s tests. The fourth, screen-reader labels, needs components to label |
| `E13-10` automated a11y in CI | `E13-03`, `E12` | Axe and Lighthouse need something rendered. Untagged, so fast-follow regardless |

Still open in `E13` and not moved: `E13-02`, which waits on `E19-03` (`owner:andy`, the VAG
Rounded Next licence), and `E13-09` (`owner:andy`, Andy reviews the motion spec once before any
screen is built).

## Block 5 — Menu & app shell  (E04, E14)

Menu model, Excel importer, image pipeline, menu versioning + the on-device cache, Expo
scaffold with the existing bundle ids, the `api/` module lint rule, navigation, list
virtualisation.

**Done when:** the app opens, loads a cached menu offline-fast, and refetches only on a
version change.

**"Done when" met, 2026-08-09.** The Menu tab opens with no session (`AR7`), serves the cached
menu, and refetches only when `school_menu_version` moves. Delivered: `E14-01/02/03/05/06/09`,
`E04-02/03/04/05/08/09/10/12`, `E13-03`, `E13-08`. Two migrations came out of it — `0006` (the
column `MI1` needed and never had) and `0007` (the `dish_allergen` trigger gap, where a
corrected allergen would never have reached a cached device).

**What is still open in `E04`/`E14`, and why none of it is a slip:**

| Task | Blocked on |
|---|---|
| `E04-01` Dish CRUD | The model and `0006` are done; the **write path** is an Edge Function that does not exist yet, and the admin UI is `E10` |
| `E04-06` Bulk image upload | Importer-side and genuinely doable — the honest answer is that it was not reached |
| `E04-13` Migrate the 3 menus | **`[MI-01]`** — the source workbook is not in the repository. Not buildable, not a slip |
| `E14-07` Cold-start budget | **Parked.** Andy's ruling: the numbers must come from `E19-02`, measured on a real handset |
| `E14-08` Optimistic cart UI | There is no cart. `E05`, Block 6 |
| `E14-11` OTA via EAS Update | Needs Expo account credentials — Andy |
| `E14-14` Screens rebuilt | A catch-all across twelve screens; Cart/Checkout are `E05`/`E06`, Login/Signup/Dependents are `E03`. It can only close as those blocks land |
| `E13-10` Automated a11y in CI | **Half done.** The app half runs on every push (`src/a11y/audit.ts`). The web half needs axe and Lighthouse against something rendered, and `E12` does not exist. Untagged — fast-follow |

`E19-01` and `E19-02` remain parked with `E14-07`.

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
