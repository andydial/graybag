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

## Recording decisions and learnings — do this continuously

Three files, three purposes. Keep all of them current as you work; they are how you and
Andy stay oriented across sessions.

| File | What goes in it | When to write |
|---|---|---|
| `docs/decisions.md` | Architectural and product decisions, each with **why** | Any time you make a non-obvious choice, or change an existing one |
| `docs/learnings.md` | What broke and why, approaches that did not work, non-obvious constraints, gotchas in Supabase / Razorpay / Expo / the stores | Immediately after debugging anything that took more than ~20 minutes |
| `docs/open-questions.md` | What is undecided and who unblocks it | When you hit a question you cannot answer — flag it, do not guess |

Rules:

- **Write the "why", not just the "what".** A decision without its reasoning gets
  accidentally reversed later.
- **Record dead ends.** "We tried X, it failed because Y" is worth as much as the fix, and
  it stops the same hour being spent twice.
- **Update rather than append when something turns out to be wrong.** Strike the old entry
  and say what replaced it — do not leave two contradictory records.
- **Read `docs/decisions.md` before changing anything architectural.** If a decision needs
  to change, change it in that file in the same PR. Never silently diverge in code.
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

- **Mohali only.** One state, so GST is a flat 5% shown as CGST 2.5% + SGST 2.5%. Do not
  build IGST, place-of-supply derivation or multi-state logic.
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
