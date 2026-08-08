# Decisions — Documentation

`DOC1` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

Made 2026-08-09, after `docs/decisions.md` reached 98 KB and was being read whole on every task
by `CLAUDE.md` and `scripts/nightly.sh`.

| # | Decision | Why |
|---|---|---|
| DOC1 | **The decision log is one index (`docs/decisions.md`) plus one file per area under `docs/decisions/`, and decision IDs never move between files.** Superseded entries and the build-log narrative go to `docs/decisions-archive.md`, which is never authoritative | The log had grown to 98 KB and two instructions told every task to read it whole. Measured: **86% of those bytes were 198 *live* decision rows**, not dead entries — so the obvious fix, archiving superseded and historical material, was tried first and returned **0.8%**. The size was never the problem; reading all of it to change one thing was. An index plus per-area files makes the common case cost ~4 KB of index plus ~5 KB of one area instead of 98 KB, without deleting a single word of reasoning. IDs stay permanent because ~40 citations across `docs/` and `planning/` name them bare (`SUB1`, `M2`, `PY3`) and would otherwise all need rewriting — the same instinct as never renumbering a backlog task |

**The rejected alternative, and why it is worth writing down.** Shortening the "Why" column would
have cut far more bytes than the split did. It was rejected outright: CLAUDE.md's first
documentation rule is *write the "why", not just the "what" — a decision without its reasoning
gets accidentally reversed later*. Optimising a context budget by deleting the reasoning would
trade a cost that is paid per-request for a failure that is paid once and permanently. The split
is the version that costs nothing.

**Consequence for anyone adding a decision.** Append it to the area file, add nothing to the
index unless you are adding a whole new area, and keep the ID series going — never renumber.
If an area file grows past roughly 15 KB, split the area rather than trimming reasoning.
