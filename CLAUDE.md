# Instructions for Claude Code

## Keeping the backlog current

`planning/backlog/*.md` holds the **task definitions**. `planning/backlog-state.json` holds
**what is done**. `planning/backlog.html` is a generated view that saves Andy's ticks straight
to that file.

**Andy must never have to tell you what is done, and you must never make him regenerate a file.**

### When you finish a task

In the same commit as the work:

```bash
node scripts/sync-state.mjs pull   # picks up anything Andy ticked in the browser
# ...mark your finished task ids in backlog-state.json (or tick them in the .md)
node scripts/sync-state.mjs        # reconciles both directions
```

Only run `node scripts/build-backlog.mjs` when the task **list** changes — new tasks, new
epics, edited wording. Never just to record a tick.

### When you find new work

Append it to the most relevant epic in the same PR that discovered it. **Never renumber**
existing tasks — always append (`E06-15`, `E06-16`, …). Task IDs are permanent. If it fits
no epic, create a new epic file following the format in `planning/README.md`.

### Task format

```
- [ ] `E06-03` (risk:critical) (owner:andy) Description of the task
```

- `(risk:…)` — `critical`, `high`, `medium`. Omit for routine work.
- `(owner:andy)` — **only** for things Andy must do himself. Three kinds, nothing else:
  **decisions** (subscriptions, delivery mode, support model), **validations**
  (font licence, is the price GST-inclusive, review the motion spec), and **credentialed
  actions** only he can perform (Bubble editor, Razorpay dashboard, accountant, lawyer,
  telco, app-store consoles, DNS registrar). Everything else is unowned build work.
- Every epic file needs a `## Tasks` heading. The build script fails without it.

### Hard rule: never close an `owner:andy` task

You must not do, complete, or tick a task tagged `(owner:andy)`. `scripts/sync-state.mjs`
enforces this and will refuse, listing what it blocked. Only re-run it with `--andy` when
Andy has explicitly said in conversation that he did those specific tasks.

You *may* and should **prepare** for them — draft the policy, write the store listing copy,
pre-fill the privacy questionnaire answers, lay out the options for a decision with a
recommendation. Then hand it over. Preparation work belongs in its own unowned task, not
in Andy's.

If you find yourself blocked on an `owner:andy` task, say so plainly and move to work that
is not blocked. Do not invent an answer and proceed.

Whenever you add a new `(owner:andy)` task, ask whether it is genuinely a decision, a
validation, or a credentialed action. If it is not one of those three, it is your work.

## Andy's queue — `planning/andy-queue.md`

Everything Andy has asked for that is not yet done, **in the order it will be done**, with the
date he asked. It is not the backlog; it is only work he asked for directly and that is mine to
do.

- **Update it in every report.** If it is not on there, it is not queued.
- **Clear it in order.** Take no new work until it is empty.
- **New asks go to the bottom**, and the report says explicitly that they were added.

It exists because `E05-38` was bumped four times by feedback arriving after it. Each bump was
individually reasonable; the cumulative effect was invisible, because the queue only ever
existed in conversation.

## Recording decisions and learnings — do this continuously

Three files, three purposes. Keep all of them current as you work; they are how you and
Andy stay oriented across sessions.

| File | What goes in it | When to write |
|---|---|---|
| `docs/decisions.md` | **Index** of the decision log. Decisions live one file per area in `docs/decisions/` | Any time you make a non-obvious choice, or change an existing one |
| `docs/learnings.md` | What broke and why, approaches that did not work, non-obvious constraints, gotchas in Supabase / Razorpay / Expo / the stores | Immediately after debugging anything that took more than ~20 minutes |
| `docs/open-questions.md` | What is undecided and who unblocks it | When you hit a question you cannot answer — flag it, do not guess |

Rules:

- **Write the "why", not just the "what".** A decision without its reasoning gets
  accidentally reversed later.
- **Record dead ends.** "We tried X, it failed because Y" is worth as much as the fix, and
  it stops the same hour being spent twice.
- **Update rather than append when something turns out to be wrong.** Strike the old entry
  and say what replaced it — do not leave two contradictory records.
- **Read `docs/decisions.md` before changing anything architectural — it is an index — then
  open only the `docs/decisions/<area>.md` files covering what you are touching.** Never read
  the whole log; that is what `DOC1` exists to prevent. If a decision needs to change, change
  it in its area file in the same PR. Never silently diverge in code.
- **Decision IDs are permanent and never move between files** (`DOC1`), exactly like task IDs.
  Cite them bare — `SUB1`, `M2`, `PY3` — never as a path. Add a new decision by appending to
  its area file; only a whole new area touches the index.
- **`docs/decisions-archive.md` is history, not context. Do not read it by default** — only
  when you need to know why a decision was reversed. It is never authoritative: if it
  disagrees with an area file, the area file wins. When you supersede a decision, move the old
  entry there with a line saying what replaced it.
- Convert relative dates to absolute ("by end of next week" → an actual date).

## Repository layout

Keep the root clean — only `README.md`, `CLAUDE.md`, `package.json` and dotfiles belong
there. Everything else goes in its directory:

| Path | For |
|---|---|
| `apps/mobile/` | React Native + Expo app |
| `apps/web/` | Marketing site + admin + kitchen ops + school reports |
| `packages/shared/` | Types, validation, the `api/` client module |
| `supabase/migrations/`, `supabase/tests/` | Schema migrations and the pgTAP auth suite |
| `tools/` | One-off utilities (menu importer, migration scripts) |
| `docs/` | Decisions, learnings, open questions, specs |
| `planning/` | Backlog markdown, dashboard, TODO, overnight queue |
| `scripts/` | Repo tooling |

If you are about to create a file at the root, you are almost certainly in the wrong place.


## Build rhythm

Work **one block at a time** from `planning/build-order.md`.

- Within a block, complete **one task at a time and commit each separately**. Never batch
  several tasks into one commit — a bad task must be revertable on its own.
- **Push after every commit.** A `.git/hooks/post-commit` hook does this automatically; if
  it is ever missing or the push failed, run `git push` yourself. Work that exists only on
  Andy's laptop is one disk failure from gone. Never end a block with unpushed commits.
- **`main` is protected — branch, PR, and then merge it yourself.** Direct pushes to `main`
  are rejected (`GH013`), so work goes on a branch and opens a PR. **Once both required
  checks pass, merge your own PR** — do not leave it sitting for Andy:

  ```bash
  gh pr checks <n>                          # both must pass
  gh pr merge <n> --rebase --delete-branch
  git checkout main && git pull --ff-only
  ```

  Waiting for Andy to merge a green PR just parks finished work behind a person who has
  nothing left to decide. If a check **fails**, fix it — never merge red, and never reach
  for `--admin` or force-merge to get around a failing check.
- At the end of every block: run `npm run test:all`, fix everything that fails, commit and
  push the fixes, then **STOP and report**. State in the report that everything is pushed.
- **Do not start the next block without being told.** This is the rule that keeps Andy in
  control of when tokens get spent. Treat it as absolute.

Never weaken, skip or delete a test to make the suite pass. If a test is genuinely wrong,
fix it and say plainly in your summary that you changed a test and why.

## Scope discipline — read before adding anything

`docs/mvp-scope.md` defines v1: **173 tasks, listed explicitly in `scripts/tag-mvp.mjs`.**
Anything not in that list is fast-follow, including anything you add later.

- **Never add an id to the MVP list yourself.** If you believe something must be in v1, say
  so and let Andy decide. The backlog grew from 161 to 288 because new work quietly defaulted
  into scope; that must not happen again.
- **Build only what the current block calls for** (`planning/build-order.md`). Finish it
  green before starting the next.
- When a fix or review surfaces new work, append it to the epic **untagged**. It is
  fast-follow until Andy says otherwise.
- Prefer folding a small correction into the task it corrects over creating a new task.

### v1 scope facts you must not drift from

- **Mohali only** (confirmed 2026-08-07). One state, so GST is a flat 5% shown as
  CGST 2.5% + SGST 2.5%. Do not build IGST, place-of-supply derivation or multi-state logic.
- **Menu prices are GST-EXCLUSIVE** (confirmed 2026-08-07). 5% is added on top at checkout,
  as the current Bubble cart does. The cart, checkout and invoice pricing paths must all
  assume exclusive.
- **Onboarding and first-order conversion is a primary goal, not a nice-to-have.** Signup to
  first order must be as close to frictionless as we can make it: Google one-tap, no
  email/password, no separate email-verification step, no unnecessary fields, no blocking step
  that can be deferred — and **adding a child must not be a wall in front of browsing the menu**.
  Any task that adds a step to that path needs an explicit justification recorded with it. See
  `docs/mvp-scope.md` and decision `AR7`.
- **No passwords.** Google Sign-In, Sign in with Apple, email OTP. No phone OTP in v1.
- **No push notifications** in v1. Email only.
- **Compliance in v1 is six tasks** — consent at child creation, the policy-version
  acceptance gate, published privacy/terms/refund, grievance officer contact, account
  deletion, and no PII in logs or Sentry. Nothing more.

## Testing rhythm

- **Every push:** a smoke test of roughly 60 seconds — typecheck, lint, unit tests. That is
  all CI runs. It exists so the nightly run is not debugging a typo across eight hours of
  work.
- **Every night:** `scripts/nightly.sh` runs the full suite and hands failures back to you
  to fix, up to three rounds.
- **Never** weaken, skip or delete a test to make the suite pass. If a test is genuinely
  wrong, fix it and say plainly in your summary that you changed a test and why.

## Non-negotiables

1. **The `api/` module rule.** Every backend call from the mobile app goes through one
   `api/` module. Reads may use the Supabase client; **writes always go through Edge
   Functions.** Enforced by lint. This keeps "add a dedicated API server later" a config
   change rather than a rewrite.
2. **Authorization is default-deny**, enforced server-side, covered by a test suite that
   fails loudly if a policy is removed. The legacy Bubble app exposed every order and every
   child record publicly. This must be impossible to regress.
3. **All money is integer paise.** Never floats, anywhere.
4. **Children's data is regulated** under India's DPDP Act — names, class, section,
   allergies. Never log it, never send it to Sentry or analytics, never put it in school
   reports.
5. **Never commit the `.bubble` export.** It contains live secrets.
6. **Nothing merges without the smoke test green.** The full suite runs nightly.
7. **Mohali-only, 5% flat GST, no passwords, no push, six compliance tasks.** Do not drift.

## Performance priorities

The real constraint is **network**, not device CPU — the audience is private schools in
tier-1 Indian cities on mid-range Androids over unreliable connections. Optimise in this
order: cached menu with version checks, skeleton screens, optimistic UI, correctly sized
images, read-only offline. Do not over-index on bottom-tier handsets.

## Testing

Every feature ships with tests. A task is not done when the code works — it is done when
the tests prove it works and CI is green.
