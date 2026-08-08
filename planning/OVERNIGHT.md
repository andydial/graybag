# Running Claude Code overnight

## Before you start — 6 things

```bash
cd "/Volumes/Data/AD/Projects/Claude/Code/GrayBag/GrayBag-Rebuild"

# 1. Version control, so every overnight change is reversible.
#    No GitHub needed — a local repo is enough tonight.
git init
git add -A
git commit -m "baseline before overnight run"

# 2. Confirm Claude Code is installed and logged in
claude --version
claude -p "reply with OK"        # should print OK

# 3. Copy the design package in so the motion-system task can read it.
#    It is deliberately not in git (46 MB of binaries + licensed fonts) and is
#    gitignored here, so this copy stays local. See docs/decisions.md.
cp -R "../Legacy-Application-backup" ./Legacy-Application   # or adjust paths in overnight-queue.md Q05/Q08

# 4. Dry-run ONE task now and read the result before trusting the loop
STOP_AT=$(date -v+40M +%H:%M) npm run overnight

# 5. Read logs/ and the git diff. If Q01 came out well, schedule the real run.

# 6. Real run — waits until 8pm, stops starting new tasks after 11:30
START_AT=20:00 STOP_AT=11:30 npm run overnight
```

`START_AT` just sleeps until that local time, so you can kick it off now and walk away.
Leave the terminal tab open — closing it kills the run.

`STOP_AT` is local 24h time and stops it **starting** new tasks after that — a task already
running finishes. Ctrl-C also stops cleanly after the current task.

## What it does

Takes the first unticked item in `planning/overnight-queue.md`, hands it to Claude Code, writes the
output to `logs/`, git-commits the result with the task id, ticks the queue, moves on.
One commit per task means you can read `git log` in the morning and revert any single one.

Runs back-to-back by default. `GAP=1800` puts 30 minutes between tasks if you want to
spread it out, but there is no benefit — a task takes as long as it takes.

## What is in the queue — 15 tasks, ~8–12 hours

Design and specification work only. Nothing needing accounts, credentials or a deployed
service, and deliberately **no application code** — the repo, schema and CI do not exist
yet, so code written tonight would be rewritten tomorrow.

| | |
|---|---|
| Q01–Q04 | Target ERD, Postgres DDL, authorization matrix, RLS policies + pgTAP tests |
| Q05 | Motion system + design tokens from your brand package |
| Q06–Q07 | Order lifecycle state machine, Razorpay payments design |
| Q08 | Working Excel menu importer prototype, tested against your real file |
| Q09–Q11 | GST invoicing spec, DPDP compliance draft, privacy/terms/refund policies |
| Q12–Q14 | Store submission answers, secret + testing policy, cutover runbook |
| Q15 | Skeptical review of everything above, contradictions and gaps written up |

Q01 is the one that matters most. Everything downstream is built on it, so read that
diff properly in the morning even if you skim the rest.

## Guardrails already in place

- Runs with `--permission-mode acceptEdits` — it edits files but does not get blanket
  shell permission
- Instructed not to touch any `(owner:andy)` task, and `sync-state.mjs` refuses anyway
- Instructed to write open questions to `docs/open-questions.md` rather than invent answers
- Every task is its own commit, so anything bad is one `git revert` away

## What to expect

Unattended output is good but not finished. Expect to spend an hour tomorrow reading
`docs/overnight-review.md` (Q15) and the Q01 diff, correcting assumptions, and answering
whatever landed in `docs/open-questions.md`. That is the intended trade: it burns quota
overnight to save you daylight hours, not to skip the review.
