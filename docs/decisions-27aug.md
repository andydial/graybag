---
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

---

## 8. `E02-36`'s approved sequencing was wrong, and I did not ship against it

The plan Andy approved was: web ships the clients reading `order_money`, then the mobile thread
lands the DDL, then the test inverts. I wrote that plan, he endorsed it, and it does not work.

I went to start the client half tonight and checked the premise first:

```
GET /rest/v1/order_money  ->  404      the view does not exist
GET /rest/v1/order        ->  401      the table does, and wants a token
```

A client shipped against a view that does not exist **404s every money read on production** — the
revenue report, sales, the orders screen and the parent's own order page, all at once, the moment
it deploys. My original write-up caused this by treating the DDL as one indivisible step. It is
two, and only one is dangerous: `create view` is additive and breaks nothing, `revoke select` is
the one with a blast radius.

So the corrected order is four steps, and it is now in the proposal doc:

1. **Mobile: create the view only.** Additive, safe today, unblocks everything after it.
2. **Web: point the five clients at it.** Works before and after the revoke.
3. **Mobile: the revoke.** By now nothing reads money off the base table.
4. **Web: invert the kitchen-scope assertion**, closing `E02-36`.

**I have not shipped step 2**, because step 1 has not happened and there is nothing to point a
client at. That is the honest reason rather than a scheduling one, and the doc says so in those
words so the mobile thread reads it as a dependency rather than as web being slow.

Worth noting for its own sake: the plan was reviewed by two people and endorsed, and the thing
that caught it was one `curl` against staging. Checking the premise cost thirty seconds; not
checking it would have cost a production outage on the money screens.

---

## 9. Production checked by hand while the monitor was not running

The Actions outage takes the **Ops monitor** with it — it is a scheduled workflow, so the
15-minute reachability probe and the money-path escalation both stop when dispatch stops. That is
worth saying plainly, because the whole point of `E15-12` was *"know that production is healthy
before a parent tells me"*, and for the length of this outage that is not true.

To be accurate about the scale: dispatch stopped at about **14:03 UTC** and it is **14:27 UTC** as
I write this, so the monitor has missed one or two probes rather than a night's worth. I checked
by hand rather than assume, read-only:

```
https://graybag-web.netlify.app/          200   1.34s
https://graybag-web.netlify.app/reports   200   0.41s
https://bdamkuugbqjajbndjoxn.supabase.co/rest/v1/   401   0.44s
```

**Production is healthy.** The 401 is the right answer from an API that is up and wants a token —
a 000 or a 5xx there is what would matter.

I could not invoke `ops-heartbeat` itself, which is the deeper check: it needs a secret this shell
does not hold, and that is by design. So this is reachability, not the full probe. If the outage
runs long, the heartbeat is the thing to run manually, and the Actions workflow shows exactly how.

---

## 10. Built the menu write path, did not wire the buttons

Decision 6 said I would not write the menu-create/duplicate function tonight, on the grounds that
a duplicate inheriting its source's school assignments is an order-path consequence and I did not
want to decide that at 3am. Revisited, because on inspection **the decision was already clear** —
I had articulated it in the same breath as deferring it. A duplicate must never carry assignments,
for a reason that is checkable rather than a matter of taste: `create_checkout` resolves a school's
menu through `menu_assignment`, so two live rows for one school is an order path picking one of
them silently.

So the write path is built, with that rule enforced in three places — an explicit copied-field
list, a `copiedAssignments: 0` in the response, and a test that fails if any school or assignment
column joins the list.

Two smaller things settled themselves along the way:

- **A new menu is a draft**, which I had listed as a question for Andy. `menu.status` is `not null
  default 'draft'` in `0001` — the schema decided it in January. Neither path sends a status, so
  the column stays the only place that says so.
- **A failed item copy deletes its own menu.** Two PostgREST calls are not a transaction, and a
  half-copied menu that looks finished is worse than nothing. Deleting is safe here specifically
  because the row is seconds old, unassigned, and unreferenced by any order.

**The buttons are deliberately not wired.** The function has not been deployed, and cannot be
while Actions is down, so it has never run. A button that calls an undeployed function is precisely
the dead control `E10-50` was written to avoid — the prototype's own `alert('Prototype')`, with
extra steps. The task stays open for that last commit: deploy, exercise it on staging with a real
session, then add New menu and Duplicate to the screen.

---

## 11. Where things stand, and exactly what to do in the morning

Actions has been refusing to dispatch since ~14:03 UTC. Nothing has merged since `E11-22`. Five
pull requests are open, **all verified locally with the same commands CI runs** — `npm run smoke`
and `npm run check:a11y`, both green on the tip of the stack: 182 / 25 / 1030 / 455 tests, 20 pages
at WCAG 2.1 AA with 0 violations.

They are a **linear chain**, each branched from the one before and all rebased onto current `main`,
verified with `git merge-base --is-ancestor` end to end. Merge them in this order and each should
fast-forward with no conflict:

| # | Branch | What it is |
|---|---|---|
| **130** | `e05-dishes-workbench` | `E10-48` — problem chips with counts on the dish workbench |
| **131** | `e10-49-named-menus` | `E10-49` — Dishes moves to `/admin/dishes`, Menus is new |
| **132** | `e10-51-people-scope` | `E10-51` — "what each job can see", computed from the grants |
| **133** | `e02-36-sequencing-fix` | `E02-36` — corrected sequencing; **the mobile thread needs this one** |
| **134** | `e10-52-screen-review` | `E10-52`, `E10-53`, `E10-50` write path, `E11-24` |

If Actions is still dead, the fastest check is the repo's **Actions tab** rather than the API —
the API reports the runs that exist and cannot report a dispatch that never happened, which is why
this took a while to diagnose.

**Do not promote until at least #130–#132 are merged and green.** The production build gate keys on
a `[promote]` subject on `main`, and promoting a `main` that is missing half the stack ships the
Dishes/Menus split without the screens that make it make sense.

### What is done

All six prototype items, except the two things that are genuinely blocked:

- **Meal packs** — the schema and `packs.manage` belong to the mobile thread. Untouched, and no
  adjacent permission borrowed.
- **The menu New/Duplicate buttons** — the write path is built and tested; the function has never
  run because it cannot be deployed while Actions is down. `E10-50` stays open for that.

### What I would look at first if I were you

`E02-36` (#133). It is a docs-only change and it unblocks the other thread: `order_money` is a 404
today, so the sequencing everyone agreed to would have taken down every money screen on
production. Step 1 is additive and safe to land at any time.
