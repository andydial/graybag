# GrayBag

Migration of the GrayBag school/college food-ordering app off Bubble onto an owned stack.

## Layout

```
apps/mobile/        React Native + Expo app
apps/web/           Marketing site + admin + kitchen ops + school reports (one app)
packages/shared/    Types, validation, the api/ client module — shared by both
supabase/           migrations/ and tests/ (pgTAP authorization suite)
tools/              One-off utilities (menu importer, migration scripts)
docs/               Decisions, learnings, open questions, legacy schema map
planning/           The backlog: epic markdown, dashboard, TODO, overnight queue
scripts/            Backlog tooling and the unattended runner
```

Only `README.md`, `CLAUDE.md`, `package.json` and dotfiles live at the root.

## Read first

| File | What it is |
|---|---|
| `CLAUDE.md` | Conventions Claude Code must follow. Read before changing anything |
| `docs/decisions.md` | Every architectural and product decision, with the reasoning |
| `docs/open-questions.md` | What is undecided and who unblocks it |
| `docs/learnings.md` | What broke, what didn't work, non-obvious constraints |
| `planning/README.md` | How the backlog works |
| `planning/TODO.md` | Andy's tasks only (generated — read, don't edit) |

## Scope

**v1 is 173 tasks** — see `docs/mvp-scope.md`. Mohali only, flat 5% GST, Google/Apple/email
login, no push notifications, six compliance tasks. Everything else is fast-follow and stays
in the backlog untagged.

`planning/build-order.md` is the sequence: one block at a time, green before moving on.

## The backlog

```bash
npm run backlog:serve     # then open http://localhost:4321/backlog.html#mine
npm run backlog           # regenerate the dashboard (only when the task LIST changes)
npm run backlog:sync      # reconcile backlog-state.json <-> markdown checkboxes
```

Ticking a box writes `planning/backlog-state.json` to disk immediately, with a timestamped
copy in `planning/.backlog-history/`. Idle cost of the server: ~6 MB RAM, 0% CPU.

## Unattended runs

```bash
START_AT=20:00 STOP_AT=11:30 npm run overnight
```

See `planning/OVERNIGHT.md`.

## Target stack

- **Mobile** React Native + Expo (TypeScript), Reanimated + Skia
- **Backend** Supabase — Postgres, Auth, Storage, Edge Functions — Mumbai `ap-south-1`
- **Web** one app on Netlify
- **Payments** Razorpay only
- **Monitoring** Sentry + Better Stack, both reachable from Claude Code via MCP

## Non-negotiables

1. Every backend call from the app goes through one `api/` module. Reads may use the
   Supabase client; **writes always go through Edge Functions.**
2. Authorization is **default-deny**, server-side, with a test suite that fails loudly if a
   policy is removed.
3. All money is **integer paise**. Never floats.
4. Children's data is regulated under India's DPDP Act. Never logged, never in analytics.
5. Never commit the `.bubble` export.
6. Nothing merges without CI green.
