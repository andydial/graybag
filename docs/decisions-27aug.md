# Decisions taken overnight, 2026-08-27

> **Two threads wrote this file on the same night.** The mobile thread's calls are `D1`–`D10`
> below; the web thread's are numbered `1.`–`4.` in their own section at the end. The numbering
> did not collide by luck rather than by agreement — worth fixing before the next overnight run,
> and recorded as `E16-64`.

Andy, 2026-08-26: *"Work continuously overnight. Don't stop to ask me anything — decide, record it
in docs/decisions-27aug.md with your reasoning, and keep going… I'd rather read a decision I
disagree with in the morning than find you waiting since 1am."*

Every entry below is a call I made without asking. Each says what I chose, what I rejected, and
what would change my mind — so disagreeing with one costs a sentence rather than an excavation.

Anything I could not decide safely is in **§ Skipped and why** at the bottom, not silently
dropped.

---

## `D1` — The pack entry point lives on Account, not the tab bar or Home

**Chosen.** `Your meal packs` sits in the Account list, exactly where the prototype puts it, and
nothing appears on Home, the Menu tab or the tab bar.

The prototype has a Home card (`f.haspack ? 'Your meal pack' : 'Buy meals in advance'`), and I am
deliberately not building it yet. Reason: Home is the first screen after sign-in and the one
surface where a wrongly-rendered pack prompt is most visible, and the gate is a network read that
resolves *after* first paint. A card that appears a beat late on Home reads as a glitch; a row
that appears a beat late in a list nobody has scrolled to does not.

**Rejected:** a fifth tab. The mock has four, `E05-04` fixed that count, and a tab is the least
reversible placement in the app.

**What would change my mind:** Andy wanting the Home card for conversion. It is a small addition
once the gate is proven — the read is already cached by then.

---

## `D2` — The surface gate is fetched once per school change and cached, never per screen

**Chosen.** `MealPackSurfaceContext` holds `{ canBuy, hasBalance }`, refetched when the selected
school changes or the session changes, and every pack surface reads from it.

Each screen calling `fetchMealPackSurface` for itself would be simpler to write and wrong in a way
that matters: the answer would arrive at different times on different screens, so a parent could
see the Account row disappear while standing on the balance screen. One answer, one moment.

**Rejected:** deriving `hasBalance` client-side from a fetched pack list. That would make the app
the authority on whether a balance exists, and `E21-31` is precisely about the server owning that.

---

## `D3` — Pack screens are stack routes, and none of them is reachable when the gate is off

**Chosen.** `Packs`, `PackDetail`, `MyPacks` and `PackPlan` are `Stack.Screen`s registered
unconditionally, but **nothing navigates to them** unless the gate says so, and each renders the
prototype's fallback if reached anyway.

Registering them conditionally would have been the stricter reading of *"no such concept"*, and I
rejected it: a route that appears and disappears from the navigator makes `linking` and deep links
behave differently depending on a network read, and a parent following a stale link would get a
"screen doesn't exist" crash rather than the designed fallback. Andy's amendment — *"the
prototype's screen survives as a fallback"* — is exactly this case.

**The rule that is enforced instead:** no *entry point* renders. `meal-pack-surface.test.tsx`
asserts the Account row, the cart strip and every navigation call are absent when the gate is off.

---

## `D4` — `screen_viewed` names the pack screens; no pack event carries a price

**Chosen.** Four new screen names (`packs`, `pack_detail`, `my_packs`, `pack_plan`) and three tap
events (`pack_offer_opened`, `pack_purchase_started`, `pack_plan_confirmed`). None carries an
amount, a meals count, an offer id, a child, or a dish.

`pack_plan_confirmed` was the tempting one — knowing how many days a parent plans at once is a
genuinely useful product number. But a plan is a set of children and dates, and the count is one
join away from *which child eats on which days*, which is the food profile `s.9(3)` forbids
building. Revenue lives in the ledger, which does not leave the country.

**What is knowable from these:** how many parents reach the offers screen, how many open one, how
many start a purchase, how many confirm a plan. That is the funnel; the amounts are in the
database.

---

## `D5` — the orphan guard learned "read-only context" rather than being given an exemption

**Chosen.** `MealPackSurfaceContext` exposes `{ canBuy, hasBalance, loading }` and **no setter**,
which broke `orphans.test.ts` twice: its vacuity check refuses a context whose shape it cannot
parse, and its writer check requires something outside the file to call an action.

The easy fix was a `KNOWN_ORPHANS` entry. I rejected it: an exemption says *this one is allowed to
be broken*, and this context is not broken — it is a different, deliberate shape. The server owns
both flags, and `hasBalance` is a **debt**, so letting any screen set it would be the app deciding
what it is owed.

So the scan now recognises a context with zero actions, and the writer test **asserts positively**
that such a context still has a hook and a provider rather than skipping silently. The exemption
was added and then removed once the scan understood the shape.

**Verified rather than assumed:** adding an unwired action named `zzzUnwiredPackAction` fails the
writer check, so the read-only path does not mask the real guard.

### A weakness in that guard, found on the way and worth fixing separately

`callsTo(action)` matches by **bare name**. An unwired action called `refresh` passes, because
something else in the app calls something called `refresh`. I confirmed this: the same mutation
passes as `refresh` and fails as `zzzUnwiredPackAction`.

That means the guard is weakest precisely for the names people actually choose — `refresh`,
`load`, `reset`, `clear`. Filed as `E21-38` rather than fixed here, because tightening it will
surface existing collisions across the app and that is its own piece of work with its own review.

---

## `D6` — the balance is ONE pack, not a sum across packs

**Chosen.** `meal_pack_balance` returns the pack the next order will draw from — spendable and
oldest-expiring first, the same order `spend_meal_pack_meals` takes them in — and carries
`meals_across_all_packs` alongside for any surface that wants the total.

A parent may hold several packs. Summing them gives "17 meals left", which is true and useless,
because it cannot answer *when do I lose these*: the two packs expire on different dates and the
number hides which meals are about to go. The prototype shows one balance with one expiry, and
that is right rather than a simplification.

**Rejected:** returning a list and letting the app choose. That would put the oldest-first rule in
two places, and the app's copy would be the one that drifts.

---

## `D7` — the balance carries the offer's meal rule, and `dishInfo` gained `categoryId`

**Chosen.** `meal_pack_balance` returns `items_per_meal` and `required_category_id` with the
numbers, and the navigator's `dishInfo` map now copies `categoryId` from the menu payload.

Without both, the cart cannot tell a parent *why* their cart will not take a meal until after they
tap and the server refuses. The payload has always carried `categoryId`; only that map dropped it,
so this was one line rather than a new read.

**The rule travels with the pack, not the app.** A three-item pack, or one requiring fruit rather
than a drink, changes nothing in the client — `pack-eligibility.test.ts` covers both, because a
rule hardcoded to "two items, one drink" would silently mis-advise every parent the day Andy
creates a different pack.

**Still true:** the server decides. The app's copy only picks which sentence to show.

---

## `D8` — the orphan ratchet talked me out of shipping a prop early

**Chosen.** `PackPlanScreen` has **no `confirming` prop**, and its double-tap test is gone with it,
until `E21-45` builds the Edge Function call that spends the balance.

I had written both. `orphans.test.ts` flagged `confirming` as passed only by tests, and my first
move was a `KNOWN_ORPHANS` entry naming `E21-45` — which is what that registry is for, and unlike
`D5` this genuinely *was* a missing wire rather than an unfamiliar shape.

Then the count assertion rejected it: the list is a hard-coded 11 and every comment above it
records a step *down* — 15 → 14 → 13 → 12 → 11. It is a ratchet, and going up is the exact thing
it is built to make uncomfortable.

It was right to be uncomfortable. A prop only tests pass is the failure this repo keeps meeting,
and I would have been carrying the shape of a feature that does not exist. The guard cost me a
test I liked and was correct to.

**What would change my mind:** nothing. `E21-45` adds the prop, its wire and the test together.

---

## `D9` — CI had not stalled. The PR was CONFLICTING, and I diagnosed it wrong twice

**Corrected.** My first reading was "GitHub Actions has stopped scheduling again", because that
had happened earlier in the week and the symptom matched: five commits, no runs. I acted on it —
closed and reopened PR #120, then pushed an empty commit. Neither did anything, which was the
first sign the diagnosis was wrong.

The actual cause: `gh pr view 120 --json mergeable` reports **`CONFLICTING`**. The web thread
merged Reports to `main` at 13:59, `ci.yml` triggers on `pull_request`, and **GitHub does not run
`pull_request` workflows on a PR whose merge commit cannot be computed.** Nothing was stalled.
Actions was running normally on `main` and on `e11-22-growth-acquisition` the whole time, which I
could have checked in one command before touching the PR.

**What I did wrong, precisely:** I matched a symptom to a remembered cause and acted before
testing it. The cheap discriminating check — *is Actions running anywhere else?* — takes one
command and would have ruled the stall out immediately.

**Resolved by merging `main`.** Two conflicts, both additive: `docs/learnings.md` (both threads
appended sections — kept both) and `planning/backlog-state.json` (both appended ticks — a union of
302 and 289 giving 311, after asserting the two sides disagree about **no** id, since taking
either side would have dropped the other thread's completed work). No task-id collision and **no
migration collision**: the web thread wrote none, which is the ownership agreement holding.

Grepped the tree for conflict markers afterwards, per `docs/learnings.md`.

---

## `D10` — CI is failing to start, on GitHub's side. Nothing merged

**Observed from ~03:30.** After the merge fixed the `CONFLICTING` problem (`D9`), CI ran properly
and passed twice — Smoke green, `Migrations, seed and authorization suite` green in 4m6s. Then:

1. All four checks on `7ebaba5` reported failure at **exactly `15m01s`** — including
   `Supabase project config (staging)`, which normally finishes in 7 seconds. The job conclusion
   is `cancelled`, not `failure`; `gh pr checks` renders both as "fail", which is worth knowing.
   Workflow timeouts are 25 and 75 minutes, so a timeout does not explain it.
2. `gh run rerun --failed` produced **`startup_failure`** on both workflows. Twice.
3. Other runs across the repo are sitting `queued`.

Uniform cancellation, jobs that will not start, and a queue backlog together point at GitHub
capacity or an incident rather than anything in this branch.

**Chosen:** stop re-running and hand it over. `CLAUDE.md` says never merge red and never reach for
`--admin`, and a check that cannot start is not a green one. The branch is pushed; nothing is
merged.

**What I can say instead**, run locally on the merged tree at every commit: 1038 mobile tests, 41
pgTAP files, 8 eligibility-agreement cases, 4 concurrency races, 73 migrations reversible,
`check:mvp`, `check-unqualified-writes` and `check-test-fixtures` all clean. That is not a
substitute for CI — Maestro drives a real Android build this machine cannot — and I am not
treating it as one.

**To pick it up:** `gh run rerun <id>` on PR #120, or push any commit once Actions is healthy.

---

## Skipped and why

**The planner's SCREEN.** Reversed in part: I skipped it, then had budget left and built its
**arithmetic** — `pack-plan.ts`, 22 tests, both mutations caught — because that is the half where
an over-spend would hide and it is testable without a component. The screen itself is still
`E21-41`. Splitting it this way was the right call rather than a compromise: the footer's counting
rule is the thing that protects a parent's afternoon, and it is now proven independently of any
rendering.

**Buying a pack end to end.** `PackDetail` and the purchase itself need an Edge Function that
creates a `meal_pack_purchase` order group, takes payment through the existing Razorpay path, and
writes the pack and its ledger legs in one transaction. That is money-moving code and it needs the
tax-point answer (`E21-22`) before it can be finished honestly, since the ledger legs differ. The
buy button therefore does not exist yet — deliberately, rather than as a stub that looks like it
works.

**A cross-check that the app's eligibility rule agrees with the server's.** Both are tested
separately and I believe they agree, but the assertion I actually want — same inputs, same verdict,
run against both implementations — needs order rows in the database per case. Worth doing;
`E21-42`.


---

# The web thread's decisions, same night

*Merged verbatim from their side of `main`. Their numbering, their reasoning.*

title: "Decisions taken overnight, 26–27 August 2026"
---

# Decisions taken overnight, 26–27 August 2026

Andy, 2026-08-26, close to midnight:

> *"Work continuously overnight. Don't stop to ask me anything — decide, record it here with your
> reasoning, and keep going. If something genuinely blocks you, skip it, note it, and move to the
> next item. I'd rather read a decision I disagree with in the morning than find you waiting since
> 1am."*

So this is a running log, newest last, of every judgement call made without him. **It is not the
decision log.** `docs/decisions.md` and its area files remain the permanent record (`DOC1`), and
anything here that turns out to be architectural is written there too and cited by its id — this
file says *what was decided at 2am and why*, which is a different question from *what is true of
the system*.

Read it as a queue of things to overrule. Each entry states the call, the reasoning, and — where
there is one — the cheaper thing I would have done had he been awake to ask.

---

## 1. This file, rather than the area files, for tonight's calls

Andy named `docs/decisions-27aug.md` explicitly, and the repo convention is one file per area
under `docs/decisions/` with permanent ids. Both, rather than either: durable decisions still go
to their area file and get an id, and this file carries the overnight narrative and links to them.

The convention exists so that a decision can be found by the person changing the code that
depends on it, and a dated scratch file cannot do that job — in a month nobody will think to open
`decisions-27aug.md` before editing the dishes screen. But a dated file is exactly right for
"what did it do while I was asleep", which is the question Andy will actually have at breakfast.

---

## 2. Order of work for the night

The remaining prototype items are meal packs, the dishes workbench, named menus, and the People &
access role-scope panel. Taking them in Andy's stated order except that **meal packs is skipped**:
the pack schema and the `packs.manage` permission belong to the mobile thread, Andy told them so
on 2026-08-26, and he was explicit that I should not borrow an adjacent permission because
*"borrowing an adjacent permission because the right one doesn't exist yet is how permissions
quietly stop meaning what they say."* Nothing about that is unblocked by working at night.

So: dishes workbench → named menus → People & access → promote. Anything left over at the end
goes to the backlog untagged, as fast-follow.

---

## 3. The dishes workbench was already built; only its toolbar was missing

`/admin/menus` already carries a dishes workbench that is in several respects **better** than the
prototype: the query lives in the URL so a filtered view can be sent to somebody, there is a
drawer with image upload, and `facets()` already computed every count the prototype's chips show.

So this was not a rebuild. The one real gap was that those counts were rendered as five
`<select>` elements, and a dropdown hides its numbers until you open it. The prototype's chips
answer *"how much is left to do"* without a click, which is the question a workbench exists for.

**Kept the selects rather than replacing them**, which is a departure from the prototype. They
express things a chip row cannot — a *specific* menu, "allergens declared none" as distinct from
"not checked" — and they are already tested. Both render from one `query` object, so they cannot
disagree; a browser check confirms toggling a chip off returns its select to "any". Had Andy been
awake I would have asked whether he wants the selects gone for tidiness; the reversible half of
that choice is deleting them later, which is cheap, where re-deriving them is not.

**`E10-48` rather than a new epic.** The workbench is an admin surface and `E10` is the admin
dashboard epic.

---

## 4. Renaming `/admin/menus` is deferred, not done

The page at `/admin/menus` is titled **Dishes**, and the prototype has Dishes and Menus as two
separate screens. Once named menus exists (next), that URL will be actively misleading.

Not renaming it tonight, because a URL change is the kind of thing that breaks a bookmark Andy
actually uses, and doing it at 2am with no way to ask is the wrong trade for a cosmetic gain. The
named-menus screen will take a **new** path and the rename gets its own task, so both screens are
reachable and nothing that works today stops working.

---

## 5. Reversing decision 4: the dishes screen *did* move to `/admin/dishes`

Two hours ago I decided not to rename `/admin/menus` because a URL change can break a bookmark
and there was nobody to ask. Building the menus screen changed the arithmetic, so the decision
changes with it.

The alternative to renaming was giving the **new** screen an awkward path forever — `/admin/menu-list`
or similar — to protect a URL whose title already said "Dishes". That trades a permanent wart for
a temporary inconvenience, which is the wrong way round. And the redirect I had in mind does not
help: the old path is the one the new screen wants, so it cannot both redirect away and be served.

So: Dishes is at `/admin/dishes`, Menus is at `/admin/menus`. A stale bookmark lands on Menus —
a related, working admin screen with a link to Dishes one row above it in the nav — rather than a
404. The one real cost is a bookmarked *filtered* dish view (`?type=unset`), which will land on
Menus with a query it ignores. I judged that acceptable at two schools and one operator.

Both are in the nav, both are in the a11y sweep, and `nav.test.ts` asserts both paths.

---

## 6. The menus screen ships read-only

The prototype has **New menu** and **Duplicate a menu**. Both are `alert('Prototype')` in it, so
this is not a regression against the acceptance criteria — but it is a gap against what Andy will
want, and I want it stated rather than discovered.

Writes go through Edge Functions (`A4`, non-negotiable #1) and there is no menu-write function.
I could have written one tonight; I chose not to, for a reason specific to duplication rather
than to the hour: **a duplicated menu must not inherit its source's school assignments**, or
copying "Term 1, serving Amity from January" quietly starts serving a second menu to a school
already being fed. That is an order-path consequence, on a product taking real money, decided at
3am with nobody to check it against. The read-only screen is worth shipping now and loses nothing.

`E10-50` carries it, and flags the one question I would ask: should a duplicate default to
`draft`? The prototype shows a draft status and nothing in the system currently sets one.

---

## 7. BLOCKED — GitHub Actions stopped dispatching runs at about 14:05 UTC

**Nothing has merged since `E11-22` (PR #129).** Two finished, tested pull requests are open and
green locally but cannot be merged, because CI has not run on them and `main` does not take work
without the smoke test green (non-negotiable #6). I am not merging past that, and I am not
reaching for `--admin`.

What I checked, so nobody repeats it:

| | |
|---|---|
| Branches pushed? | Yes — both refs exist on origin at the right SHAs |
| Workflows enabled? | All six `active` |
| Runs queued or stuck? | `queued: 0`, `in_progress: 0` |
| Actions minutes exhausted? | No — the repo is **public**, so Actions are free |
| GitHub incident? | Status page reports "All Systems Operational" |
| Check-suites on the commit | `netlify` completed, `claude` and `expo` queued — **no `github-actions` suite exists at all** |

That last row is the finding: Actions is not creating a check suite for these commits, so this is
a dispatch failure rather than a queue or a budget. Netlify's own checks run fine on the same
commits, which is why the PR does not look obviously broken at a glance.

Tried, and did not work: closing and reopening PR #130 (fires `pull_request: reopened`), and
pushing an empty commit to fire `push`. Neither produced a run.

**What Andy needs to do:** probably nothing but wait — a dispatch outage that the status page has
not picked up usually clears itself. If it has not by morning, the Actions tab on the repo will
say more than the API does, and re-running the last successful workflow manually is the next
thing to try.

**What I am doing:** continuing to build, committing and pushing, and leaving the PRs stacked in
order. Every one is smoke-green and a11y-green locally, verified by the same commands CI runs.
When Actions returns they should merge in number order with no further work. I will re-check
periodically and merge anything that goes green.

Stacked and waiting, oldest first:

- **#130** — `E10-48`, dish workbench problem chips
- **#131** — `E10-49`, Dishes/Menus split and the new Menus screen
