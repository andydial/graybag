# How the backlog works

## Format

Each file in `planning/backlog/` is one epic:

```markdown
---
id: E06
title: Payments — Razorpay & Ledger
phase: 4
risk: critical
status: not-started
depends_on: [E02, E05]
summary: One line, shown on the dashboard card.
---

## Why this is the riskiest epic
Free prose. Anything above `## Tasks` renders as context on the dashboard.

## Tasks

- [ ] `E06-01` (risk:critical) Spike Razorpay Standard Checkout in test mode
- [ ] `E06-03` (owner:andy) Something only Andy can do
- [x] `E06-02` Something already done
```

## Rules

- Task IDs are stable. Never renumber; add new ones at the end (`E06-15`, `E06-16`…).
- `(risk:critical)` / `(risk:high)` / `(risk:medium)` are optional per-task overrides. The epic's own `risk` is separate.
- `(owner:andy)` marks tasks **only Andy can do**, and only three kinds qualify: **decisions**, **validations**, and **credentialed actions** (Bubble, Razorpay, accountant, lawyer, telco, app-store consoles, DNS). Everything else is unowned build work and needs no tag. Claude Code is mechanically blocked from ticking these — see `CLAUDE.md`.
- Phases are execution order, not deadlines. Riskiest work is deliberately early.
- Discovered work gets appended to the relevant epic in the same PR that discovered it.

## Phases

| Phase | Meaning |
|---|---|
| 0 | Now — security exposure and external lead time (no code) |
| 1 | Foundations — repo, CI, environments, test harness |
| 2 | Risk-first — data model, authorization, auth, observability, design system |
| 3 | Core domain — menu, ordering, app shell |
| 4 | Payments |
| 5 | Back office — kitchen ops, admin, invoicing, notifications |
| 6 | Reporting + marketing website |
| 7 | Data migration from Bubble |
| 8 | Beta, cutover, phased store release |
| 9 | Deferred — explicitly post-launch |

## Finding your own tasks

Open `backlog.html` and set the owner filter to **Only mine (Andy)** and state to
**Open only**. Or bookmark `backlog.html#mine`, which opens straight to that view.
The KPI row shows a live **Yours to do** count.

## Marking things done

Run `node scripts/serve-backlog.mjs` and open <http://localhost:4321/backlog.html>.
Tick boxes; every click writes `backlog-state.json` immediately, plus a timestamped copy
into `.backlog-history/` (last 60 kept). Nothing to click to enable it, nothing to lose.

Opened as a plain file instead, ticks save only in that browser — usable, but they will
not reach Claude Code. The status bar tells you which mode you are in.

`node scripts/sync-state.mjs` reconciles `backlog-state.json` with the markdown
checkboxes in both directions. Commit both and git is your permanent audit trail.

## Scope tags

`(mvp)` marks a v1 task. The list is explicit in `scripts/tag-mvp.mjs` — **an id must be
added there deliberately**. Everything else, including anything added later, is fast-follow.
Re-run `node scripts/tag-mvp.mjs` after a batch of new tasks; it warns about ids in the list
that no longer exist.

## Regenerating

```bash
npm run backlog
```

CI does this automatically on push to `main` (see `.github/workflows/backlog.yml`).
