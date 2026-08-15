# Decisions — the run of 16–17 August

Andy, 2026-08-16: *"Do not ask me questions — decide, record in `docs/decisions-17aug.md`, keep
going. Blocked? Skip, note, next."*

Continues `docs/decisions-16aug.md` (D1–D40). Numbering continues from it rather than restarting,
because these are the same running record and a second `D1` would be unreadable in six weeks.

Permanent decisions still belong in `docs/decisions/<area>.md` with a real id — this file is the
narrative of an unattended run, not a substitute for the log.

## D41

**The ledger rule is a non-negotiable in `CLAUDE.md`, not an entry here.** Andy asked for it as a
standing rule, and standing rules that live in a dated decision file get read once. It is
non-negotiable #8: a migration applied to production by hand is recorded in the ledger in the
same operation, with the two-command form written out, and a "verify before you record" clause —
because the two directions of drift found on 16 August have opposite fixes, and recording a
migration you have not confirmed applied is how the first direction happens.
