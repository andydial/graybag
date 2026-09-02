# Andy's queue

**Everything Andy has asked for that is not yet done**, in the order it will be done, with the
date he asked. Not the backlog — that is `planning/backlog/` and `planning/TODO.md`. This file
exists so the queue can be seen draining rather than reconstructed from chat each time.

**Rules, agreed 2026-08-11:**

- Updated in **every** report. If it is not on here, it is not queued.
- Cleared **in order**. No new work is taken until it is empty.
- Anything new goes to the **bottom**, and the report says so explicitly.
- Andy's own tasks (`owner:andy`) are **not** here — they are in `planning/TODO.md`. This is
  only work that is mine to do.

> **Why it exists.** Self-ordering (`E05-38`) has been bumped four times by feedback arriving
> after it. Each bump was individually reasonable and the cumulative effect was invisible,
> because the queue only ever existed in conversation.

---

## Open — 7 items

Rewritten 2026-08-26, because this table had gone stale in both directions: it still listed
Maestro as blocked when a section further down records it green on 2026-08-16, and it still
listed three asks that have shipped. A queue nobody trusts is worse than no queue, so the
closed rows are moved out rather than left to be read as outstanding.

**Production is taking real orders.** Everything below ships behind the same gate — smoke green,
verified on a preview that sends production's headers, promoted deliberately — and nothing here
touches the ordering or payment path.

| # | Ask | Asked | Status |
|---|---|---|---|
| 10 | **Build the back office from the prototype** | 2026-08-26 | **In progress.** `docs/prototype/graybag-admin-prototype.html` is the acceptance criteria; where it and a current screen disagree, it wins. Six items in Andy's order: meal packs config, the dishes workbench, named reusable menus, **Reports**, People & access, and Growth reduced to acquisition only. **Reports is done** — `E11-16` built the data layer (range, school filter, CSV, cohort funnel, per-school) and `E11-17` laid it out against the prototype, including one disagreement resolved in the prototype's favour (`P21`). **Packs are no longer blocked** — corrected 2026-08-27: the mobile thread landed the whole pack schema through migration `0075` and seeded the permission, which is named **`meal_packs.manage`** and not `packs.manage` as everything here had assumed. The admin side is buildable and is the last item outstanding. **`E11-19` is done** — it was pulled ahead of the remaining screens on Andy's instruction (*"Fix it before the dishes workbench"*) and cleared the same day. Growth reduced to acquisition is also done (`E11-22`). The dishes workbench (`E10-48`), named menus (`E10-49`) and People & access (`E10-51`) are all done and promoted to production on 2026-08-27. **Only meal packs config remains** |
| ~~6~~ | **UX review of the screens other than Kitchen and Orders** — **done 2026-08-27** (`E10-52`) | 2026-08-20 | Partly done and worth keeping open honestly. `/admin/people` was rebuilt for scale (`E10-46`), `/reports` twice (`E11-10`, `E11-17`), and `/admin/sales` is new. **`/admin/config`, `/admin/import` and `/admin/allergens` have still never had that treatment.** Item 10 covers some of this ground, so this closes when it does |
| ~~12~~ | **Bound the reads behind Reports** (`E11-19`) — **done 2026-08-26** | 2026-08-26 | **Done.** Pulled to the front of item 10 at Andy's instruction and cleared the same day. `fetchGrowth` reads every order with no range filter and no page size. Fine at 219 rows; at 400 registrations a week the failure is the nasty kind — revenue is filtered server-side by service date and stays correct while usage silently undercounts beside it. `E11-17` added an on-screen guard that detects exactly that disagreement, and Andy's ruling is the right one: *"Your disagreement guard is good, but as you said, a guard is not the fix."* |
| ~~11~~ | **Growth, reduced to acquisition only** — **done 2026-08-26** (`E11-22`) | 2026-08-26 | **Added 2026-08-26.** Part of item 10 and listed separately because it is a deletion rather than a build: the funnel moves off Growth and onto Reports, where it sits beside the revenue it explains. Andy's framing: *"Growth = are new families arriving. Reports = does a family who arrives get to an order, over a range."* The funnel half already exists on Reports as of `E11-16`; what remains is removing it from Growth without removing the stuck-parent list, which is the actionable part of that screen |
| 14 | **One owner account, derived rather than enumerated** | 2026-08-28 | **Client half done and merged; the DDL is written, approved and waiting on a migration number.** Andy: *"a single recorded account against which permission checks pass, not a list of grants somebody keeps in step"*, with two guards — exactly one owner, changed visibly and deliberately; and **no test may run as the owner**. Approved in full on 2026-08-28 including the boundary that decides whether this is a convenience or a hole: **the owner derives permissions, never relationships.** The short-circuit is one boolean `or` in `auth_has_permission` and deliberately *not* in `auth_can_reach_recipient` and its siblings, which answer whether a guardian link exists — extending it there would make one account the implicit guardian of every child. Design and DDL in `docs/proposals/E02-39-derived-platform-owner.md`; decisions `AZ14`–`AZ22`. **`E02-40` (the client) is live and inert**: it treats "no such function" and "no such table" as *"there is no owner yet"*, so the back office is unchanged until the migration lands and unchanged for everyone afterwards. **`E02-41` is what remains** — a number (`0077`+) from the mobile thread and the hand-apply-and-record that put `0068`–`0075` on production. `E02-39` itself is tagged `owner:andy` and stays open for Andy to tick, since the decision was his |
| 15 | **Grant `meal_packs.manage` on production** | 2026-08-28 | **Done 2026-08-28.** Approved explicitly, and every premise checked before writing: the permission is in the production catalogue (`valid_scope_types = {platform}`, sensitive), the account is live and not disabled, and no grant — live or revoked — existed. Dry run first, one row in the plan, then `--apply`. Verified by reading the row back **and** by asking the server: `auth_has_permission(…, 'meal_packs.manage', 'platform', null)` returns `t`. 31 grants → 32; no other account's count changed. Meal packs is now in the sidebar and `/admin/people` should read `Platform admin` with no missing clause |
| 16 | **Back-office prototype parity — the last three screens** | 2026-08-28 | **Done 2026-08-28, merged to `main` with no promote marker.** `E10-67` Today as a status page, `E10-70` `/orders` filters + CSV + its first a11y audit, `E10-71` Schools picker and People collapsed. Three things deliberately **not** copied from the prototype, each because it would duplicate a write path we have sited elsewhere behind a different permission: `Mark all delivered` and by-class/by-dish grouping on `/orders` (they are `/kitchen`'s), and the packs toggle and editable config on `/admin/schools` (they are `/admin/packs`' and `/admin/config`'s). The prototype has one screen per noun; we have one per job. What was missing in each case was the **information**, and that is what shipped. `E10-72` files the People drawer for when there is no rollout on |
| 9 | **Prove a PostHog event arriving from Andy's real device** | 2026-08-25 | **Blocked, and the blocker is not mine to clear.** Reading events needs a **personal** API key (`phx_`); `~/.graybag-secrets/prod.env` holds only the write-only project key (`phc_`), which returns 401 on the query endpoint — confirmed, not assumed. The emitters are shipped and the key is inlined in the production bundle, so the proof is a read away once a `phx_` key exists. Tracked for Andy as a credentialed action |
| 15 | **Finish what's in flight, then stop — Amity is rolling out to parents** | 2026-08-28 | **Done 2026-08-28. Everything asked for is merged; nothing was shipped to parents.** `#157` (`E21-51` + `E21-50`), `#160` (the workflow union, `DP8`/`DP9`), `#161` (`E21-63`). `npm run test:all` green on `main`: 1118 mobile, 916 pgTAP, 22 pages 0 a11y violations. **Production is untouched and still at `0075`** — seven migrations sit on `main` unapplied, and no OTA was published, so what Amity's parents run today is exactly what they ran this morning. The one thing that touched a parent-facing path is `E21-51`'s refactor of `useAllergenWatchlist`, which the menu and cart share; behaviour-preserving, and Maestro's end-to-end cart run passed. Flagged before merging rather than after |
| 16 | **Three fixes and the date picker — the parent who could not order** | 2026-09-01 | **Done 2026-09-01.** Cutoff config live (23:00, `min_advance 0`) across all three schools — the next school day was previously **always** already closed, for everyone, every day. `0076`–`0084` applied to production, which is now at `0084` with the ledger clean. `E05-52` (calendar readable by a parent) and `E05-55` (`not_a_service_day` instead of blaming a dish) landed server-side first, then the client. **The date picker was the real fix** and Andy found it: the cart had no date control at all, so the three server fixes alone would only have reduced how often the trap sprang. `moveCartToDate` merges collapsing lines with quantities **summing**, mutation-checked four ways. OTA `83b2db4d` published and verified on both platforms (`appEnv=production`). **`E05-58` deliberately excluded** — the allergy line that renders a known as an unknown; fails safe, needs schema work, goes next |
| 13 | **Fix the production deploy workflow, apply `0068`–`0075`, and list what else is unapplied** | 2026-08-28 | **Done 2026-08-28, and the premise was wrong in a way worth stating.** The 25 Aug run did not fail on the Migrations job — that job never began. It was a `workflow_dispatch` from `main`; the `production` environment admits `v*` **tags** only, so GitHub refused the ref at the gate: one second, zero steps, no logs. **No `v*` tag has ever existed either, so the workflow has never once succeeded** — production's migrations and Edge Functions have all been applied by hand, including these. Workflow fixed in `E17-63` (PR #152, merged): an ungated `preflight` job, mutation-checked four ways. **A second, independent fault was found before spending Andy's approval** (`E17-64`, `owner:andy`): the `production` environment has **no secrets at all** and `SUPABASE_PROJECT_REF` exists at no level, so the deploy would have failed its own credential guard four steps in — and repo-level `SUPABASE_DB_PASSWORD` is staging's. **Applied by hand instead, which is the path CLAUDE.md #10 sanctions**: production is at **0075**, all eight recorded, every one of fourteen functions/constraints/columns verified to exist, `assert_ledger_integrity()` 5 checks 0 failures, `check_meal_pack_ledger_invariant()` both legs `0 = 0`. Packs are **dark**: `meal_packs_confirmed = false`, zero offers, zero packs, zero redemptions. **All nine stale Edge Functions deployed**; 22 of 22 now current, `payments-webhook` still `verify_jwt=false`. `E15-12`'s money alerting is live on production for the first time |
| 14 | **`E17-64` approved; close `E17-60` and move the store URLs to `graybag.com`** | 2026-08-28 | **Done 2026-08-28.** Secrets: risk accepted by Andy with his reason stated (*"I'm the only person who can change anything in that repo"*), and a **third fault** found while doing it — `SUPABASE_DB_PASSWORD` was read by both deploy workflows and set by neither, so production would have authenticated `db push` with **staging's** password. Five secrets now environment-scoped; the deploy can authenticate for the first time. The four Edge Function values were sha256-compared against live production first and found identical, so nothing about live payment configuration changed. `E17-60` closed on a corrected premise — `graybag.in` was never ours, and `dig` cannot distinguish *misconfigured* from *not yours*; both store URLs now read `https://graybag.com`, **apex not `/support`**, because `/support` 404s and Apple rejects a Support URL that does not resolve. `E17-66` files the real support page |
| 12 | **Order the three items — `order_money`, then `E21-48`, then `E21-44`** | 2026-08-27 | **Interrupted by item 13 and resumed after it.** `E02-36` step 1 is PR #149 and `E21-48` is PR #147; **both are `CONFLICTING` against `main` as of 2026-08-28**, which is why their checks read stale — a `pull_request` workflow does not run on a conflicting PR. Both need rebasing before they can merge, and #147's migrations still need renumbering `0076`–`0079` → `0077`–`0080` because `order_money` took `0076` |
| 10 | **Meal packs on the parent side** | 2026-08-26 | **In progress, on `e17-60-no-orders-investigation` (PR #120).** Buying and balance surfaces built and gated; the cart redemption strip; the planner screen and its arithmetic; `0068`–`0073` including the concurrency guarantee, plan-level idempotency and the ledger. **Remaining: `E21-44`** (the planner's calendar and per-day item picker) and **`E21-48`** (buying a pack end to end, which needs `E21-22` — the ledger legs differ by tax point). Not merged: waiting on Maestro |
| 17 | **No-privilege accounts must not be able to log into the web back office at all** | 2026-09-02 | **Added 2026-09-02, and done the same day** (`E10-73`). Andy, from a screenshot of `/dashboard` signed in as an account holding nothing: *"They should not even see what sections are present if they have no access to it… if they have no privileges assigned — they should NOT be able to login into the web backend at all… Other employees (kitchen) can't know that we track reports, access, even revenue using this web dashboard."* The page was naming the four grants it was withholding and heading a section "Kitchen, right now". RLS had refused every read correctly — the leak was the **vocabulary**, not the data. Now: back-office access means *reaching at least one screen*, an account that reaches none is **signed out at the door** with a sentence that names nothing, a withheld panel is **absent** rather than explained (only a failed read still speaks), and the sidebar is **built** by the client instead of shipped hidden — `view-source` on any back-office page was previously a complete map of the back office with each link's required grants, readable without signing in. Decisions `AZ23`–`AZ29`. Proved in headless Chrome against a stubbed backend: nine scenarios, 27 assertions, no credentials, nothing that could reach production |

### Closed since this table was last accurate

- **Maestro in CI** (asked 2026-08-10) — green on 2026-08-16, `[Passed] cart (47s)`, run 31891879898.
- **Group and clarify the permissions** (2026-08-20) — `E10-45`. Five job bundles, still stored as
  individual grants, so `D3` holds and no role column entered the schema.
- **A registrations and growth report** (2026-08-20) — `E11-08`, `E11-15`.
- **An orders and revenue report** (2026-08-20) — `E11-10` through `E11-17`, plus `/admin/sales`.
- **Order alert emails** (2026-08-23) — `E08-16`. Built, deployed, and **configured**: Andy
  confirmed on 2026-08-26 that a recipient is set on production. Fully closed; it was previously
  listed as waiting on him, which it no longer is.
- **A growth and adoption dashboard** (2026-08-23) — `E11-08`, `E11-15`. Item 11 above is the
  follow-on change to it, not a re-do.
---

## Closed 2026-08-20 — navigation, and the cancellation that told nobody

**`E10-43` — a dashboard to land on, and navigation everywhere.** `nav.ts` had modelled this
correctly since `E10-12` and was imported by nothing; `/kitchen/sheet`, `/admin/allergens` and
`/admin/people` were reachable from no link in the app, and the route table pointed at
`/admin/orders`, which has never existed. Sign-in now lands on `/dashboard` rather than dumping a
reports-only account on the kitchen board. Sign-out existed on no page at all.

**`E09-38` — cancelling an order emails the parent, in the operator's own words.** Andy asked for
the customer's contact on the board; `0002` forbids that for kitchen scope in terms, and the real
gap was that **no cancellation email existed on either path**. The dialog now requires a typed
sentence and sends it verbatim. `E09-39` leaves the kitchen-staff-sees-the-customer question with
Andy, since it is now a preference rather than a blocker.

Both live on production: migrations `0064` and `0065` applied, web promoted, `kitchen-order-status`
deployed, and the new guards exercised against production with a real session and a non-existent
order id so nothing real was touched.

---

## Closed 2026-08-17 — the two live home-page bugs

Andy, on <https://graybag-web.netlify.app>: *"Nothing moves / transitions on the home page. 'Your
school gets its own menu' has bad contrast with background and can't be read. Make pages somewheat
dynamic / motion like grayspark.ai (not that color scheme - just motions)"*, then: *"Hope you
understood to change this page: https://graybag-web.netlify.app - not really sub-pages right now"*.

Both fixed, promoted to production and verified **on the live URL**, which is where they had to be
verified — the whole failure was that the feature worked locally and was blocked in production by a
CSP header a file server never sends. `E12-36`. Motion is on the home page only; no sub-page was
touched.

## Closed 2026-08-16 — Maestro in CI

Renamed from "Open — nothing" on 2026-08-26. It was a second `## Open` heading in a file whose
first one is the live queue, sitting inside the history and describing a state that stopped being
true within days — which is how the table above came to list Maestro as blocked while this said
the queue was empty.

`Maestro in CI` (asked 2026-08-10) closed on 2026-08-16: `[Passed] cart (47s)`, `1/1 Flow Passed`,
run 31891879898 — **the first time that job has ever been green**. Five causes in total, listed on
`E14-38`.

---

## Closed 2026-08-16 — the eight-item overnight run

Andy's list, in his order. All eight addressed; three carry a stated gap rather than a claim.

| # | Ask | Outcome |
|---|---|---|
| 1 | Standing rule: hand-applied migration → ledger, same operation | **Done.** Non-negotiable #8 in `CLAUDE.md`, with the two-command form and a verify-before-you-record clause |
| 2 | Confirm TestFlight build is *submitted for review* | **Done.** 4.0.0 `WAITING_FOR_REVIEW`, reviewSubmission `85684984…` submitted 15 Aug 12:22Z, build 12 VALID. Note `releaseType = MANUAL` — approval will not auto-release |
| 3 | EAS Update on production + one-line command | **Done.** `npm run ship:ota -- "what changed"`. Published `c4342c44`; manifest verified 200 for runtime 4.0.0 both platforms, 204 for 3.7.0 and 4.0.1. **Gap: not watched applying on a device** — no simulator or emulator on this machine |
| 4 | Prod sweep as a clean parent | **Done except the email.** Sign-in, add child, browse, cart, cutoff, price guard, order placed (`GB-APGY7Q`, ₹72.46), idempotent replay, Orders list, order detail — all correct. **Gap: the confirmation email needs a `paid` order and I would not forge a payment on the live ledger** (`D46`, `E08-15`) |
| 5 | Sentry live + PII guard | **Guard done, reporting blocked.** `E15-15` — nine tests, including one that reads the real schema and fails when a personal column is uncovered. **There is no Sentry in the repo at all**, and adding the native SDK would invalidate build 12 mid-review (`E15-16`, needs a DSN and a decision) |
| 6 | Play internal track | **Documented, not uploaded.** No Play service-account JSON exists here (`E17-51`). `docs/play-internal-track.md` — URL, package, version code, three steps |
| 7 | Force-update plan, do not set | **Written, nothing set.** Floor still `0.0.0`. **And it cannot do what the 19th needs**: 3.7.0 is the Bubble binary and never calls the RPC, so the gate would block nobody (`D42`) |
| 8 | Maestro, timeboxed to one run | **GREEN.** `[Passed] cart (47s)` — first time ever |

## Closed 2026-08-15 (night) — the production verification sweep

Andy, 2026-08-15: *"'prod auth is configured' so you can run your verification sweep."*

Run as `anuragdial+parent@gmail.com` — a genuinely clean parent, zero grants — never as the
granted account. That distinction found both of the bugs below; a granted account passes each of
these reads for the wrong reason.

| Item | Result |
|---|---|
| Sign-in / OTP | Works. OTP minted and exchanged for a session; the code-not-link fix holds |
| Default-deny | Holds on every sensitive table — 0 other users, 0 other children, 0 other orders, 0 other invoices |
| Menu browse | **BROKEN, fixed.** `E02-33` / `0061` — signing in emptied the menu. Applied to production, verified 119/119 |
| Add a child | Works. Consent gate refuses with 409 when consent is not granted; the child and its consent record are written together |
| Delete a child | **BROKEN, fixed.** `E20-56` / `0062` — erasure failed at COMMIT for everybody. Applied to production, verified end to end |
| Cart / checkout | Works. Order created, GST correct to the paise (per line, per component, half-up) |
| Cutoff | Works. A past service date is refused with `cutoff_passed`; a wrong total with `price_changed` |
| Cancellation | `E06-42` computed columns resolve from the order's own snapshot; `cancel-order` refuses an unpaid order with the right message |
| Policy acceptance | 3 published versions, none blocking — the gate is inert today, as designed |

Logged, not fixed: `E05-51` (nothing closes an abandoned unpaid order, and one blocks child
deletion for ever), `E05-52` (`order-calendar` 404s for every parent; no screen calls it yet),
`E16-54` (`owner:andy` — production has zero allergen data, so every dish reads as though it
contains nothing), `E20-57` (the pgTAP suite is blind to every deferred constraint).

## Closed 2026-08-15 (late) — the six-item production run

| # | Ask | Done |
|---|---|---|
| 1 | `food_type` null on all 79 dishes — fastest possible way to set it | Done. **Three** ways: a bulk bar on `/admin/menus` (select all → Veg → correct the exceptions; **one request**, not 79), `--export-dishes` for the spreadsheet route, and one at a time. `0059` guards the **offer** — a dish may exist unmarked, it may not be published unmarked — and does not touch the 83 rows already live. **Left untagged `(mvp)` and I think it should be tagged — your call** (`D-16L`) |
| 2 | Verify the whole admin path against prod | Done for the importer path: exported the real 79-dish catalogue, planned it back, created a school with config, proved the re-run is a clean no-op, edited the config, removed it. **The browser screens were not verified against prod** — that needs a signed-in back-office session (email OTP as you), and your own rule forbids substituting the service role. Three-minute checklist below |
| 3 | Enquiry form live, submissions land, you are notified | Done. It was **not deployed to prod at all** and `PUBLIC_ENQUIRY_ENDPOINT` was unset, so live enquiries were going to the dev mock and being lost. Deployed, wired, verified with two real submissions (deleted after). The notification now exists — **and its recipient chain was wrong on first deploy**, naming two variables prod does not have. **Not verified: that the mail arrived** — this CLI has no `functions logs` |
| 4 | Kitchen board against prod, one real order | **Blocked.** Prod has zero orders and no prod payment has been taken. Nothing to verify against |
| 5 | Promote, and the one-paragraph runbook | Done — and it exposed `E12-33`: **the Netlify site has no repository connected**, so the deploy gate has never run and PRs have never had previews. Production is live and current via the manual route. My runbook also could not be followed (it described a push to a protected branch) and the gate's own test was pinned to today's commit. Both fixed |
| 6 | Launch-readiness check | Done. `npm run check:launch`. It found a blocker nobody knew about: **Paragon and Gem have no break windows**, so under `P19` neither can take an order — only Amity can |

### What production says right now

**2 blockers**: 79 dishes unmarked and offered; Paragon and Gem have no break windows.
**2 warnings**: no service days on any school; Amity's break labels are its own time ranges.

### Still yours

- **`E12-33`** — connect the repository in Netlify, or the deploy gate stays decorative.
- **`E17-53`** — apply `0059` to production; it is the only migration of mine not there.
- **Sign in at <https://graybag-web.netlify.app/signin> and open `/admin/menus`** — three minutes,
  and it is the half of the admin path I could not verify unattended.
- **Confirm an enquiry notification arrived** at whatever `SUPPORT_ALERT_EMAIL` is.
- `E12-31`, `E20-52`, and the `(mvp)` tag on `E10-21`.

---

## Closed 2026-08-15 (evening) — the unattended run

Two lists, given back to back. The second reordered the first and added the 17 August import as
the hard deadline. Everything below is on `e09-31-filter-bar`, PR **#51**.

| # | Ask | Done |
|---|---|---|
| 1 | Renumber migration `0050` now payments has merged | Done. It was worse than stated — `main` had taken `0052`, `0053` and `0054`, so the enquiry migration collided at `0052` and `check-migrations` failed on `duplicate-version`. Renumbered to `0055`. **Second renumber of the same file in one day**, and the migration's header now records both rounds because the pattern is the useful part |
| 2 | `E10-06` per-school config with visible inheritance | Done. **Service days did not exist anywhere** — added in `0056`, inert on the day it applies, and `orderable_calendar` honours it in the same migration. The screen reads the three config rows separately and keeps the losing values, so "overridden for this school" is distinguishable from "platform default", and "remove override" states what it would revert to — which is **not** always the platform default |
| 3 | School onboarding | Done. `E10-01`, `/admin/schools` + the `admin-school` Edge Function. The list names *which* of the three ways a school can be invisible to parents applies to it |
| 4 | Bulk import for the 17th | Done. `tools/bulk-import`, dry run by default. `docs/import-format.md` documents every column with worked examples. **Running it three times against a real database found four bugs no unit test would have** |
| 5 | Dish and menu management screens | **Not built.** The importer covers the bulk path, which is what the 17th needs; the one-off case (change a single price without preparing a file) is `E10-20`, appended untagged |
| 6 | Reports — orders and revenue by school by month | Done. `E10-10`. Reads **no** recipient, class or section column — non-negotiable #4 |
| 7 | Netlify: PR previews on, production gated on approval | Done. `E12-30`. `docs/netlify-deploys.md` has the promotion procedure in one paragraph. `E12-31` is yours: the dashboard's auto-publish switch |
| 8 | Grievance route — Vivek in the website footer only | Done. `E20-53`. Mostly already true from `E20-51`; the footer had **no name at all**, and now carries it. The published privacy policy was **not** touched — that is `E20-52`, yours, and blocked on a lawyer |
| 9 | Point the web app at production | **BLOCKED and skipped.** `~/.graybag-secrets/prod.env` does not exist. Nothing guessed, `apps/web/.env` untouched, staging still works. `docs/production-cutover.md` has the whole procedure ready to run; filed as `E17-48` |

Every judgement call taken without asking is in `docs/decisions-16aug.md`, D-16A to D-16H.

**Still yours, and two of them are on the launch path:** `E12-31` (Netlify auto-publish switch),
`E17-48` (the production project and its `prod.env`), `E01-26` (the Maestro gate that has timed
out on every PR — it is why #51 has not merged), and `E20-52` (the DPDP named-officer question).

---

## Closed 2026-08-15 — the six-item list

Andy gave six items in order and all six are done. PRs #60 and #61.

| # | Ask | Done |
|---|---|---|
| 1 | Scope **"My Orders"** to the signed-in customer, asserting the count | **Already shipped** as `E06-43` before this session. Verified rather than redone: `my_orders_scope.test.sql` seeds three parents with 2/1/3 orders and asserts the count through an authenticated client, with a third party present |
| 2 | Sweep every parent-facing screen for the same assumption | **Already shipped** as `E06-44`. Verified: `fetchRecipients`, `fetchProfile` and both order reads scope explicitly; `fetchRecipientAllergens` was the one gap and now checks `guardian_link` first. **Every** table behind a "mine" screen carries a widening policy, so RLS narrows to "mine" for none of them |
| 3 | `E06-42` — cancellable resolved server-side from `config_snapshot` | Done. `0052`, two PostgREST computed columns. The snapshot, never `resolve_effective_config()` — the test edits the kitchen's config mid-run, which is the only assertion that can tell the two apart |
| 4 | Parent-initiated cancel before cutoff | Done. `E06-45`, `0053` + `cancel-order`. Records a pending refund and **posts nothing to the ledger** — the money has not moved |
| 5 | Refund awareness, deduped on refund id | Done. `E06-46`, `0054`. Dedupes on `provider_refund_id`; ledger reversal, order state, credit note, parent email. **Found that `reverse_ledger_transaction` could not reverse any real settlement** and never could have |
| 6 | Support address — `support@graybag.com`, no individual named | Done. `E20-51`. `GrievanceOfficer.name` removed from the type, not just the value. **The published privacy policy still names Vivek and I did not touch it** — that is a new notice version and a legal question, filed as `E20-52` |

**Not added to this queue, because they are Andy's:** `E20-52` (does DPDP require the grievance
officer to be a named natural person?) and the `E06-33` refund-timing figure, which item 4's
confirmation copy deliberately works around by promising no date.

---

## Closed

Kept so the queue shows movement rather than only what is left. Newest first.

| Ask | Asked | Done |
|---|---|---|
| **Cart to prototype** | 2026-08-10 | Compared element by element. Five states were built, tested and never wired — allergen warnings on every line, the offline band, the signed-out reassurance, Change, and the empty cart's only exit. `E05-45`; three real gaps filed as `E05-46`/`47`/`48` |
| **`P18` name capture (`E05-39`, `E05-41`)** | earlier session | Asked once on Order Confirmed, skippable, recorded server-side so it is never asked twice; settable from Account. The audit found nothing broken today and one landmine — `invoice.buyer_name_snapshot` is NOT NULL (`E07-22`) |
| **`E05-38` — self-ordering** | 2026-08-11 | "Order for myself" is first-class on Who you order for, and Add-someone asks who it is for before it shows a form. Bumped four times; done |
| **Gem and Paragon on Amity's break windows** | 2026-08-11 | `0029`, provisional and marked so in the data. Both schools open |
| **Dish-sheet pass (items 4–8)** | 2026-08-11 | Hero matches Home, allergen block quiet, For-block a line, calories shown, adding dismisses |
| **Kitchen note into the dish sheet** | 2026-08-11 | Full field on the sheet, compact tap-to-edit line in the cart |
| **Break-time selection at checkout** | 2026-08-11 | Built. Amity can order; Gem and Paragon are closed and say so. "Confirmed with the kitchen" deleted from every surface |
| **`E05-37` — edit and remove a child** | 2026-08-11 | Done. Removal erases, and the copy says so |
| Policy: lawyer baseline + three tracked changes as a new notice version | 2026-08-11 | `E20-45`, `C17` |
| `E20-44`/`E20-30` — build the recipient-scope erasure before `E05-37` | 2026-08-11 | `0026`, 18 pgTAP assertions |
| Confirm whether the app stores allergy data | 2026-08-11 | Answered: yes, whole path live |
| Hard rule — no telemetry may touch a child's record, failing a build | 2026-08-11 | `E20-42`, `C16` |
| `E17-36` — iPad, verified against App Store Connect | 2026-08-11 | Asserted with provenance |
| Pre-flight `submit.preview` before burning a TestFlight build | 2026-08-11 | `E17-37`/`E17-38` — caught the empty EAS environment |
| The exact Supabase auth settings, in one message | 2026-08-11 | Two, not four; `E00-22` corrected |
| Separate App Store Connect record for staging, wired to `submit.preview` | 2026-08-11 | `E17-32`, `R10` |
| Production version to `4.0.0`; version test asserts > 3.7.0 with provenance | 2026-08-11 | Committed |
| Audit the release config for other unverified assumptions | 2026-08-11 | `E17-33`…`E17-36` |
| `E20-11` policy acceptance gate mounted | 2026-08-11 | `E20-36` |
| `E20-12`/`13`/`14` — deletion route, policy links, support reachable | 2026-08-11 | `E20-37`/`38`/`39` |
| `E04-20` — "my school is not listed" | 2026-08-11 | Done, and offered before you search |
| Navigation dead ends — "Open the Menu", change school | 2026-08-11 | `E14-34` |

---

## Item 2 — resolved 2026-08-11, and what is still waiting

Checked before designing the picker, as asked.

**Already built:** `break_time` (`school_id`, `label`, `starts_at`, `ends_at`, `sort_order`),
plus `break_time_class` for per-class windows later. `create_checkout` **already accepts
`break_time_id` per line** and writes it onto the order; `CheckoutLine` already carries
`breakTimeId`. The write path is done.

**Missing:** a read in `api/`, the picker, and — the real constraint — **the windows
themselves**. The catalogue seeds two for Amity International School and **zero** for Gem Public
School and Paragon Senior Secondary. That was deliberate: the legacy option-set values
contradicted their labels, so the seed left them out rather than inventing them.

**Andy's decision, 2026-08-11 — option (a).** Required picker everywhere, real windows only,
nothing invented. Until the real times arrive, Gem and Paragon **must not reach checkout**, and
must say "we're still setting up ordering for this school" — never "we'll confirm with the
kitchen", which describes a manual step nobody can perform at volume. Amity is the only school
that can take an order today, and it is the biggest and launches first.

Labels are friendly — "Morning break", "Second break" — with the times underneath. A parent
should not have to read raw data to choose. Amity's `label` currently holds the time range
itself, so it needs renaming when the real windows land.

**Built 2026-08-11.** `0027` makes break windows readable signed out; `api.fetchBreakTimes`
reads them; `BreakTimePicker` offers them by name with the window underneath and nothing
preselected; the cart blocks Place order until one is chosen. A school with none shows "we're
still setting up ordering for this school" and a button reading "Not available at this school
yet" — deliberately not "Ordering has closed", which tells a parent to come back tomorrow.

**"Confirmed with the kitchen" is gone from every surface**, not only the cart: it was also on
Home's delivering-to band and on Order detail. Two tests that asserted it now assert its
absence.

**Still waiting on Andy:** start/end pairs for Gem and Paragon. Nothing is blocked on them —
those two schools simply stay closed until they arrive, which is what `P19` chose.
