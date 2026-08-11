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

## Re-planned 2026-08-09 — Amity launches with **zero migration**

Andy's ruling. Amity's old email domains are dead; those ~150 users re-register from scratch on
`ais.amity.edu.in`, and **the loss of their order history is accepted**. Andy cleans the export
himself and hands over a final import batch of valid users only. The other ~250 users at the
smaller schools migrate **after** cutover.

Three consequences, and they reorder everything below:

1. **`E16` leaves the critical path entirely** and becomes post-cutover work. That is 10 open
   MVP tasks off the launch, and it removes the single riskiest calendar dependency in the plan
   — two full dress rehearsals that had to finish before a cutover weekend.
2. **Onboarding became revenue-critical.** 150 parents will register in a compressed window and
   re-enter their children by hand, on whichever app is live. `E03` had **no block at all** in
   this document before today — it was referenced once, in passing, as something `E14-14` waits
   for. It is now a block of its own.
3. **`E06` is the long pole**, and is to be pushed to the point where the only thing missing is
   the handset test.

**`E03-16`** ("migrate the ~400 existing users by email match") is no longer a launch task: 150
of those users are re-registering and the rest migrate later. It moves to the post-cutover block
with `E16`, along with `E03-18`/`E03-19` (the two-account support path), which only matter to
migrated accounts.

## Block 6 — Ordering  (E05)  ← in progress

Dependents, cart, cutoff enforcement (server-side), break times, order creation with
snapshots, history, cancellation, idempotency.

Done: `E05-04` (cart), `E05-07` (cutoff). Half: `E05-08` (server), `E05-06` (resolver).

**Finish with the checkout transaction** — `docs/order-lifecycle.md` §8.2 steps 1–9 (`E05-09`,
`E05-12`, `E05-13`), then `E05-11`. Steps 1–9 are pure database and need no Razorpay, no auth
and no handset, so this is the last large piece that is unblocked by anything or anyone.

**`assert_cutoff_open` still has no caller.** `E05-07` shipped the mechanism and its proof;
enforcement only becomes real when step 6 calls it. Nothing else in this block matters more.

## Block 7 — Identity & onboarding  (E03)  ← promoted, was unscheduled

Google Sign-In, Sign in with Apple, email OTP, account linking, session across restarts,
account deletion, optional email and mobile on the profile.

**Done when:** a new parent goes from a cold app open to a child added and a cart ready to pay,
with no password, no email-verification step, and no step that could have been deferred —
and the number of taps is written down.

Promoted above payments deliberately. It is smaller (11 open MVP tasks against 15), and it is
the difference between a flow that ends **done** and one that ends **blocked**: `E06` finishes
waiting on a handset whatever order it is built in, whereas `E03` can be finished outright.
Until it exists, nothing downstream can be exercised as a real user, because there are no real
users.

`AR7` governs every task here and is now a revenue constraint rather than a principle: any task
adding a step between opening the app and paying needs an explicit justification recorded with
it.

## Block 7a — The dish mark and school menu restriction  (E04-14…E04-17, E04-19, E04-20)  ← inserted ahead of payments, 2026-08-11

`dish.food_type` is null on every dish, `public_menu` never selected the column, and no fixture
anywhere contains a `non_veg` dish. So the veg / egg / non-veg mark does not exist end to end:
not in the data, not in the read path, not in a test.

That was tolerable while it was decoration. Two things changed on 2026-08-11. The public site
committed in writing that *"every dish carries a veg, egg or non-veg mark, and your school's menu
contains only what you have agreed to"*; and **schools are lined up who want non-vegetarian food
next**.

**This is a revenue feature, not a safety catch.** It is what lets us sell non-veg to the schools
that want it *without* losing the schools that do not. Without it, the only way to honour a
vegetarian school is to keep the whole catalogue vegetarian, which is the business decision this
work exists to avoid having to make.

An earlier proposal — a trigger refusing creation of any `non_veg` dish until the restriction
shipped — was **withdrawn** (`E04-18`). It would have blocked the business it was meant to
protect. Sequencing does the same job: this block lands before the first non-veg dish exists.

| | |
|---|---|
| `E04-14` | Expose `food_type` through `public_menu`; bump the cache token |
| `E04-19` | A `non_veg` fixture in both seeds and in the prototype — the enum branch has never run |
| `E04-16` | `not_stated` on the enum; column `not null`, **no default** |
| `E04-15` | Load the kitchen's marking sheet (`tools/food-type-sheet/`) |
| `E04-17` | `school.allowed_food_types` + four server-side checkpoints + allow/deny tests |
| `E04-20` | pgTAP coverage — the suite currently has zero references to `food_type` |

**Done when:** a school configured vegetarian-only cannot be assigned a menu containing a non-veg
or unmarked dish, cannot have one added to a menu it already has, never sees one in
`public_menu`, and is refused at checkout if one is submitted anyway — each proved by a test that
fails if the rule is removed.

**`not_stated` fails closed**, so a dish nobody has marked is treated as disallowed everywhere.

**The kitchen is not on the critical path for building this.** `E04-16` backfills every existing
dish to `not_stated` and adds the constraint immediately; `E04-15` then corrects those values
whenever the sheet comes back. What the kitchen *does* gate is the first restricted school going
live — because until its dishes are marked, failing closed means its menu is empty.

## Block 8 — Payments  (E06)  ← the long pole

In-app checkout with native UPI, webhook signature verification, idempotent handling, the
order state machine, ledger, refunds including per-line, daily reconciliation.

**Done when:** a real test-mode payment completes end to end and reconciliation is clean.

**Target state before the handset exists:** everything except the device test. Signature
verification, the `L3` capture-rank monotonic state machine, webhook idempotency, the ledger,
refunds and reconciliation are all server-side and testable against `E01-19`'s provider stub
with no real UPI and no phone. Build all of it. Stop at anything that needs a real UPI
transaction and say so — never mock around it.

`E19-01` (Razorpay + UPI on a real Android) remains parked on the handset and is the gate.

## Block 9 — Invoicing & email  (E07, E08)  ← externally blocked, start the unblocked half

Gapless invoice numbering, the GST PDF, sender domain (SPF/DKIM/DMARC), confirmation and
cancellation emails.

**This is a second long pole, and it is not ours.** `E07` is blocked on `E00-10`/`E00-11` for
the GSTIN and SAC code, and `G3` makes the invoice issuer **refuse to allocate a number while
either is a placeholder**. So no compliant invoice can be issued in production without the
accountant. Real money cannot complete a clean transaction until that arrives.

The numbering machinery, the gapless-series triggers (`G8`) and the email domain (`E08`) do not
need the GSTIN and should be built while waiting.

## Block 10 — Back office  (E09, E10)

Kitchen order list, mark delivered, reject with refund, permission split; admin school and
kitchen onboarding, menu management, Excel upload, config UI, order dashboard.

Launch needs the kitchen half (`E09`, 5 open MVP tasks) — an order nobody can see is an order
nobody cooks. The admin half can follow.

## Block 11 — Website & compliance  (E12, E20)

Homepage, enquiry form, published privacy/terms/refund, grievance officer contact,
back-office login entry, Netlify deploy. Consent capture at child creation, policy
acceptance gate, no PII in logs or Sentry.

Both stores require the published policies to exist at a reachable URL before submission, so
this cannot be the last thing done.

## Block 12 — Release  (E17)

EAS build and submit, store listings, App Privacy and Data Safety forms, TestFlight and
Play internal testing, ~2 week beta with real money, cutover weekend, phased store
rollout, decommission Bubble after 30 days.

**The third long pole, and it is calendar time rather than work.** App Store review is days and
can reject; the beta is ~2 weeks by design. Three of its open MVP tasks are `owner:andy`. It
cannot be compressed by building faster, which is the argument for starting the store-facing
paperwork (`E17-04`'s privacy answers, the listings) during Block 9 rather than after Block 11.

Cutover is now much cheaper than it was: with Amity migrating nothing, the weekend is a store
release rather than a data migration with two dress rehearsals behind it.

## Block 13 — Migration, after cutover  (E16, `E03-16`, `E03-18`, `E03-19`)

The ~250 users at the smaller schools, from Andy's cleaned export. Migration script, role
mapping, data quality report, validation suite, dress rehearsals, rollback plan.

Moved here from Block 11 by the 2026-08-09 ruling. It is no longer a gate on launch, which is
what takes it off the critical path — but the dress rehearsals and the validation suite are not
cancelled, only deferred. Migrating real people's order history into a live system with money in
it is not less dangerous for happening later.
