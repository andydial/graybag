---
title: WEB thread handover
status: Written 2026-08-15, at the end of a session. Assume the reader has only the repo.
covers: apps/web, and the parts of packages/shared and supabase/ this thread touched
---

# WEB thread — handover

You own `apps/web`: the marketing site, the back office (`/signin`, `/kitchen`, `/orders`) and
the policy pages. Another thread ("payments") owns `apps/mobile`, `supabase/` and most of
`packages/shared`. **Do not touch `apps/mobile`.** Touch `supabase/` only when Andy says so, and
say in your report exactly which files you touched.

Read `CLAUDE.md` first — it is the contract, and it is enforced by scripts, not by trust.

---

## 1. The one thing to look at

**<https://graybag-web.netlify.app>** — deployed, working against staging.

Sign in at `/signin` with `anuragdial@gmail.com` (email OTP, six digits, no password). Then
`/kitchen` shows a real day and `/orders` shows the same day with money.

The site is held out of search two ways — `robots.txt` defaults to `Disallow: /` unless
`PUBLIC_SITE_PUBLISHED=true`, and `X-Robots-Tag: noindex, nofollow` is set in `netlify.toml`.
**Both lines say in place when to delete them: the DNS cutover (`E12-10`), and not before.** The
marketing pages ride the same build and are not cleared to publish.

Andy was connecting continuous deploy himself. Until that exists, deploying is manual:

```bash
npm run build:web
cd apps/web && npx netlify deploy --prod --dir dist
```

---

## 2. State of the branch

**Everything is committed and pushed. Nothing is half-written on disk.**

`e09-31-filter-bar`, PR **#51**, and it is now **much** larger than when this was first written:
the admin dashboard, the config screen, reports, the import tooling and the deploy gate all
landed on it during the unattended run of 15 August. That is a known cost, taken deliberately —
`netlify.toml` and the enquiry migration both live on this branch, so the deploy work and the
import work had nowhere else to go until it merges.

`npm run smoke` exit 0 · `npm run check:a11y` 0 violations across **10** pages · **1069** unit
tests · **667** pgTAP assertions across 31 files, all passing.

**It has not merged, and the reason is not the code.** `Maestro (cart)` times out at the 45-minute
job limit on every pull request in this repository — it hit the payments thread's PRs too. `#43`
and `#48` were both merged around it with Andy's explicit permission, recorded as a PR comment
each time. **`E01-26` says do not do that a third time.** Read it before you merge #51: either the
gate is fixed, or Andy tells you again in writing.

### What is in those 12 commits

| Commit | What |
|---|---|
| `E09-31` | The filter bar collapsed behind one line. Screen showing orders 51% → 77% |
| `E09-32` | The board opened on **yesterday** until 05:30 IST every morning |
| `E10-08` | `/orders` — every kitchen, with money |
| `E12-09` | Netlify deploy |
| `E12-15` | The `enquiry` table and `enquiry-submit` Edge Function |
| `E17-47` | A web-only dependency was breaking every mobile build |
| `E12-22` | The drafting note was being published on the policy pages |
| `E12-24` | The placeholder register |
| `E12-25` | One source for the company identity |
| `E12-27` | Entity facts, liability cap removed, allergy clause rewritten |
| `E09-33` | Kitchen-visible allergy flags |
| — | The rebase: migration renumbered, a duplicate id dropped |

---

## 3. Things you cannot work out from the code

**The kitchen board is real, not a mock.** `PUBLIC_KITCHEN_TRANSPORT=live` in `apps/web/.env`
switches it from fixtures to staging. With any `?state=` parameter it uses fixtures instead —
that is how `check-a11y` audits the board rather than the sign-in redirect it would otherwise be
sent to.

**Staging has seeded days.** `2026-08-14` is the good one: two schools, 34 orders, 5 classes, 3
breaks, parent notes, and allergen flags on some children. `2026-08-13` is older and has a seed
bug — two lines of the same dish on some orders — which is fixed in the tool but cannot be fixed
in the data, because seeded orders are insert-only. Seed another day with:

```bash
set -a; . ./.secrets.staging.env; set +a
node tools/seed-kitchen-day/seed.mjs --date YYYY-MM-DD --school <uuid> --slot 0 --count 24
```

`--slot` namespaces ids so two schools can share a date. **Slot `0` reproduces the original
single-school scheme byte for byte**, so re-running an existing day changes nothing. Use a
different slot per school.

**`.secrets.staging.env` is gitignored, `chmod 600`, and is how you reach staging.** Everything
in this handover that says "verified against staging" was done by sourcing it. Never commit it.

**To drive the signed-in board without a browser session**, mint a token with the service role and
plant it in `sessionStorage` — but the session is written in **1536-byte numbered chunks** plus a
`.chunks` count, because `chunkedStore` in `packages/shared/src/api/session-storage.ts` wraps it.
A single whole-value key is invisible to the reader and the page bounces straight back to
`/signin`. That cost half an hour to work out.

**Sessions live in `sessionStorage`, not `localStorage`, deliberately** — a kitchen tablet is
shared and never locked, and a back-office session can read every child's name in the school.

**Migrations: staging drifts from the repo.** The enquiry table was applied to staging by hand as
`0050` on 2026-08-14 and is committed as `0057` — renumbered **three times** in one day, every time
because the payments thread merged while this branch was in flight. A `supabase db push` will need
`supabase migration repair` for the old version first. More generally, `Deploy to staging` has
**never once succeeded** — `E01-20`.

---

## 3a. What the unattended run of 15 August added

Read `docs/decisions-16aug.md` first — every judgement call taken without asking is in it, D-16A
to D-16H. The short version:

- **`0058_service_days.sql`.** Service days did not exist anywhere. Added on all three config
  tables with the usual NULL-means-inherit chain, platform default all seven days so the
  migration is inert, and `orderable_calendar` honours it in the same migration.
- **`/admin/config`, `/admin/schools`, `/reports`.** All three render fixtures under `?state=demo`
  and are in `check:a11y`. The config screen keeps the *losing* values from the chain, which is
  the whole of `E10-06` — an override is distinguishable from a default, and "remove override"
  states what it would revert to, which is not always the platform value.
- **`supabase/functions/admin-school/`.** The first admin write path. Andy approved new admin
  Edge Functions (D-16A); the payments functions were not touched.
- **`tools/bulk-import`.** Schools, dishes and menus from CSV or JSON, dry run by default.
  `docs/import-format.md` is written for Andy to prepare files unaided on the 17th.
- **`E12-30` deploy gating.** Production does not publish on its own. `docs/netlify-deploys.md`.

### Two traps this run hit

**`create or replace` on a function in this schema — read the live definition first.** The first
draft of `0058` copied `resolve_effective_config`'s body from `0001`, which is **three
replacements out of date**: `0037` appended the payment-timing settings. It would have silently
deleted all three from the resolver while leaving them on the tables. It was caught only because
appending a 24th field to a 20-field `row(...)` failed the cast — had `service_days` been an
integer it would have type-checked and shipped. `grep` returns eleven files for that function
name and one of them is current.

**A pgTAP file can contribute zero assertions and report no failure.**
`kitchen_allergen_flags.test.sql` had been doing exactly that: it aborted on its first insert and
every later statement returned "current transaction is aborted", which contains no `not ok`.
Behind that were six more errors. `scripts/test-db.sh` documents this in its header and counts
`ok` lines for precisely this reason — **`npm run smoke` does not run the database suite**, so a
suite can rot for days. Run `npm run test:all` before believing anything about the database.

---

## 4. Open tickets

Mine, and unblocked — you can start any of these:

| Id | One line |
|---|---|
| `E10-19` | Edit an override from `/admin/config`. The endpoint already accepts the patch and is tested; this is the screen |
| `E10-20` | Dish and menu management screens. Off the launch path while `tools/bulk-import` covers the bulk case |
| `E12-26` | Make `gst-invoicing.md`'s placeholders block a build once `E07` renders invoices from it |
| `E12-23` | Internal task ids still appear in the published policy change logs — Andy decides per line |

Mine, and blocked on another thread:

| Id | Blocked on |
|---|---|
| `E09-24` | A migration: two reverse lifecycle tuples + `event_kind`, so a mis-tap can be corrected. Spec is `docs/kitchen-write-contract.md` §1 |
| `E09-27` | A migration: free text on a cancellation has nowhere to go — `order_event` is append-only and refuses UPDATE |
| `E10-18` | The refund endpoint. `/orders` says so at the foot rather than drawing a dead button |
| `E12-20` | `E08` transactional mail, for the enquiry notification |

Andy's, and worth chasing because they block real things:

| Id | One line |
|---|---|
| `E12-21` | Set `PUBLIC_ENQUIRY_ENDPOINT` in Netlify — until then live enquiries go to the dev mock |
| `E01-20` | One stale GitHub secret. CI has never deployed to staging |
| `E01-26` | The Maestro gate that times out on every PR |
| `E00-22` | Staging Site URL and redirect allow-list |
| `E12-29` | The GSTIN's state code is Punjab, the registered address is Chandigarh. **Internal only** — Andy was explicit: do not surface it anywhere a parent, school or auditor sees, and do not leave a build warning on it. Place-of-supply logic stays keyed off the GSTIN |
| `E20-25` | The allergy-liability wording. See §5 |

---

## 5. Decisions that will look wrong without their reason

**The liability cap is deliberately absent from the terms.** Not a missing token — Andy decided on
2026-08-14 to publish without one, so our liability is whatever the law gives rather than a number
nobody reviewed. Do not "fix" it by adding a cap.

**The allergy clause is a description of the system, not a disclaimer.** Andy: *"No warranty
language, no disclaimers dressed as facts."* Every sentence in it was checked against the code
before it was written. **If you change how allergies work, that clause becomes false and must
change in the same PR** — that rule already caught us once, when kitchen flags shipped and the
clause still said the kitchen sees nothing.

**Allergen badges show codes only.** No parent note, no severity, no medical detail. Codes are
shortened but never renamed — `tree_nut` renders `TREE NUT`, not `NUT`. Renaming would create a
second vocabulary to keep in step with the first. A child with no record renders **"No allergies
provided"**, and so does one whose record is unreadable: both mean *you have not been told*, and a
permissions failure must never look like a clean bill of health.

**The kitchen filter chips are collapsed even when nothing is filtered.** Andy's brief said to show
them when unfiltered; I deviated because the unfiltered state is the default and two chip rows put
the 75%-of-screen target out of reach. He agreed after the fact. Do not "restore" it.

**`is_active` is `false` on Alpha, Bravo and Chandra on purpose.** `supabase/seeds/catalogue.sql`
deactivates the synthetic schools so they cannot appear beside real ones in the parent-facing
picker. The kitchen's school filter therefore shows **active schools ∪ schools with orders that
day** — neither half works alone.

**The undo window defers the write rather than reversing it.** Gmail's "Undo Send" does not recall
a mail; it holds the send. The lifecycle has no reverse tuple, so a write that has happened cannot
be taken back — one that has not been sent needs no tuple. It flushes on `visibilitychange`,
`pagehide` and before any reload; **a deferred write that never happens is the silent no-op the
whole screen is built to avoid.**

---

## 6. Traps this thread fell into

**`toISOString().slice(0, 10)` is UTC.** IST is UTC+5:30, so before 05:30 it returns yesterday.
That shipped, and was found by reading a screenshot's header. Use `serviceDateToday` in
`apps/web/src/lib/kitchen/view.ts`, take the instant as an argument so it is testable, and pass
`timeZone` explicitly whenever you format. `docs/learnings.md` has the full rule.

**An Edge Function can be correct and unreachable.** React Native sends no CORS preflight, so
every function was fine for the app and 405 from a browser. Use `supabase/functions/_shared/cors.ts`
and answer `preflight` **before** authenticating — `packages/shared/src/payments/cors.test.ts`
enumerates every function and fails until a new one is classified.

**The rebase resolver will stage files it cannot resolve if you let it.** It has been hardened to
exit non-zero, but a hand-rolled loop around it will reintroduce the bug — I did exactly that on
2026-08-15 and committed conflict markers again. **After any scripted rebase, run
`grep -rln '^<<<<<<< ' .`** across the whole tree. Markdown and JSON compile fine with markers in
them; a green build proves nothing about those files.

**A test that pins today's data breaks tomorrow.** Two of mine asserted specific tokens were
unanswered and failed the moment Andy answered them. Assert the behaviour — "whatever is currently
unanswered passes through untouched" — not the contents.

**Static source scans match their own documentation.** A test forbidding Sentry failed on a comment
saying "never sent to Sentry". Strip comments before scanning.

**`npm run build:web` from `apps/web` silently builds nothing.** It is a root script. Run it from
the repository root.

**`supabase db reset` applied `0056` and then lost it.** Observed twice on 15 August: the reset
logs "Applying migration 0056_service_days.sql", the suite passes against it, and afterwards the
column is gone — while `schema_migrations` still records `0056` as applied. Applying the file by
hand with `psql` persists correctly. It is the CLI's post-reset container restart, not the
migration; the local Postgres container also crashed and restarted with a fresh volume during the
same session. If a PostgREST read fails with "column ... does not exist" for something you know
you added, check the column directly before you go looking in your own code.

**After a rebase, `npm install`.** The payments thread adds dependencies; a stale `node_modules`
fails as a whole suite refusing to load, which looks exactly like a real break.

---

## 7. Where the specs are

- `docs/kitchen-write-contract.md` — correction and cancellation, written for the `supabase/` thread
- `docs/enquiry-submission-contract.md` — the enquiry endpoint, built to it
- `docs/placeholder-register.md` — every unresolved `«…-PENDING-…»` on a published surface, with
  `npm run check:placeholders`. **One token blocks a production build**: the invoice signature
  treatment, which is the accountant's and which Andy has said not to block on
- `docs/learnings.md` — read the last few entries. They are where the traps above came from
- `planning/build-order.md` — what to do next, if Andy has not said

**Never run `node scripts/build-backlog.mjs` just to record a tick.** `sync-state.mjs` does that,
and `pull` overwrites markdown from the state file — run `pull` **before** you tick, not after. I
lost ticks twice by getting that order wrong.
