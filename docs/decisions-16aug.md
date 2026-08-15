---
title: Decisions taken unattended, 15–16 August 2026
status: Written by the WEB thread during an unattended run. Andy's instruction was "do not ask
  me questions — decide, record it here, continue."
---

# Decisions taken without asking

Context: production is live **19 August**. Andy imports school, dish and menu data from Bubble on
the **17th**. This run was told not to stop for questions, so every judgement call that would
normally have been a question is written down here instead, with what it cost and how to reverse
it.

These are working decisions, not `docs/decisions/` entries. Anything that survives contact with
the 17th should be promoted into its area file with a real id.

---

## D-16A — New admin Edge Functions are in scope; the payments functions are not touched

**The question.** Non-negotiable #1 and `A4` require every write to go through an Edge Function,
and ESLint fails the build on a direct `.insert()`. The standing instruction was not to touch
"the payments/edge-function code". Read strictly, that makes the whole admin dashboard read-only.

**Decided.** The instruction means *the payments thread's functions*. New admin functions are
fair game; `checkout`, `payments-*`, `settle_*` and the webhook are not opened.

**Cost if wrong.** New server surface Andy has not read. Contained: every new function is its own
file under `supabase/functions/admin-*`, and deleting the directory reverts it.

---

## D-16B — `service_days` is a new column, not a reuse of `menu_item.available_days`

`E10-06` asks for cutoffs, break times and service days. The first two existed. The third did not
exist anywhere.

`menu_item.available_days` is per-item on a menu that `menu_assignment` may point several schools
at (`D4`), so two schools sharing a menu could not have different service days — which is exactly
the position Amity, Gem and Paragon are in. Not being served on a Saturday is a property of the
school, not of the food.

Added in `0056` on all three config tables with the usual NULL-means-inherit chain, platform
default all seven days, so the migration is **inert on the day it applies**. `orderable_calendar`
honours it in the same migration, because a setting nothing enforces is worse than no setting.

---

## D-16C — Bulk import is a CLI in `tools/`, not a screen and not an Edge Function

**Decided.** `tools/bulk-import`, run by Andy from his laptop against the service role, following
the shape `tools/menu-import` and `tools/seed-kitchen-day` already set.

**Why not the admin UI.** The 17th is a bulk data-entry day against files exported from Bubble.
A browser form is the wrong instrument for a few hundred rows, and a half-finished upload in a
browser tab has no resumable state. A file plus a command has both.

**Why not an Edge Function.** Import needs to read the whole existing catalogue to diff against
it, write across five tables in one pass, and be re-runnable. That is a batch job. Doing it
through a function would mean either one enormous request or an orchestration layer, and it would
put the service role behind an HTTP endpoint that exists only for one day's work.

**The lint rule permits it.** `config/eslint-api-module.js` scopes the api-module ban to
`apps/**` and `packages/**`. `tools/**` is deliberately outside it, which is how `menu-import`
and `seed-kitchen-day` already work.

**Dry run is the default, not a flag.** `--apply` is required to write anything. `menu-import`'s
CLI header makes the same choice and says why: a plan a human reads, applied as a separate act.
Andy is doing this two days before go-live, alone, against real data.

---

## D-16D — Import matches on natural keys and never deletes

Schools match on `school.code`, dishes on `(kitchen_id, lower(name))` — which is already a unique
index — and menus on `(kitchen_id, name)`.

A row absent from the file is **left alone**, never deactivated. A partial file is the ordinary
case on an import day, and treating absence as deletion turns one wrong export into an emptied
menu. `menu-import` reached the same conclusion and put it behind `--deactivate-missing`; this
tool does not offer the flag at all, because the 17th is not the day to discover it.

---

## D-16E — Reports are the narrow version Andy asked for, and are not tagged MVP

Orders and revenue, by school, by month. Nothing else — no platform-wide analytics, no cohort
retention, no revenue-share payout view. `E10-10` and `E10-17` stay untagged in the backlog:
`CLAUDE.md` forbids this thread adding ids to the MVP list, and a direct instruction to build
something is not the same as a decision to put it in v1. Andy decides that.

---

## D-16F — Pointing the web app at production is BLOCKED and was skipped

`~/.graybag-secrets/prod.env` does not exist — the directory holds only the upload keystore. The
payments thread has not stood the project up, or has not written the file.

Nothing was guessed and nothing in `apps/web/.env` was touched, so **staging is unchanged and
still works**. What is needed is in `docs/production-cutover.md`, written during this run: the
two variables, where they go, and the one command to verify the switch. It is a five-minute job
once the file exists.

---

## D-16G — Fixing tests that were never running counted as in scope

`npm run test:all` surfaced two pgTAP suites failing, both pre-existing on this branch.
`kitchen_allergen_flags.test.sql` was contributing **zero assertions while reporting no failure** —
it aborted on its first insert and every later statement returned "current transaction is
aborted", which contains no `not ok`.

That suite is the proof that a kitchen operator at school A cannot read school B's allergy flags.
Andy made that proof the condition of shipping the feature. Leaving it broken to save time would
have meant shipping the condition unmet, so it was fixed rather than noted.

---

## D-16H — The grievance route: the name is in the website footer and nowhere else

Andy, 15 August: *"Vivek's name stays in the website footer only. Everywhere else — app-adjacent
pages, order/support copy — route to `support@graybag.com`."*

**What was already true.** `E20-51` had removed the name from the app on 15 August, and removed
`GrievanceOfficer.name` from the *type* rather than leaving it optional. `apps/web` contained no
individual's mailbox anywhere. So most of this instruction was already satisfied.

**What actually changed.** One thing: the website footer had **no name at all** — it published
the role and `grievance@graybag.com`. Andy's instruction is that this one surface carries the
name, so it now does.

**Why the split is not inconsistency.** Two real requirements pull in opposite directions. The
DPDP Act requires a Data Fiduciary to *publish* the contact details of a named person, and
`E20-52` records that notice version 2 added the name specifically because a general `info@`
alias does not satisfy that. `E20-51` records why the same name is wrong inside the app: a
personal mailbox behind a support route is unanswerable when that person is away, unchangeable
without every shipped build pointing at the wrong place, and it makes one individual the public
face of every complaint in an app-store listing. One published page carries the statutory name;
nothing a parent taps does.

**The address stays a role, not a mailbox.** `grievance@graybag.com`, not `vivek@graybag.com`,
even with the name beside it. Naming the officer is what the Act asks for; routing every complaint
into one person's inbox is the failure `E20-51` identified, and the two are separable. It also
stays distinct from `support@` — `E20-51` kept them apart so a DPDP matter is filterable out of
the order-query pile, and those run against a statutory clock.

**`docs/privacy-policy.md` §7A was NOT touched**, and that is deliberate. It names
`vivek@graybag.com`, and that is `E20-52`: `owner:andy`, risk:high, blocked on a lawyer's answer
to one question — does the DPDP grievance contact have to name a natural person, or does a titled
role with a monitored address satisfy it? The task says in as many words: *do not edit the
published wording*. A `policy_version` row is immutable once published, so changing §7A is a new
notice version that re-triggers the acceptance gate for every existing parent. `CLAUDE.md` also
forbids this thread completing an `owner:andy` task.

So `E20-52` remains open and remains Andy's. Nothing here pre-empts whichever way the lawyer
answers.
