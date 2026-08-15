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

## D42

**The force-update gate cannot do what the 19th needs, and the plan says so.** Writing
`docs/force-update-plan.md` surfaced this: `min_supported_app_version` works by the app calling
`app_version_support` and obeying the answer, and `3.7.0` is the **Bubble** binary — it has never
heard of `VersionGate`, does not call the RPC, and does not talk to our Supabase project at all.
It asks nothing, so there is nothing to refuse.

Setting the floor to `4.0.0` on the 19th blocks **nobody**: `3.7.0` never asks, and `4.0.0` is not
below `4.0.0`. What actually moves parents off the old app is the Bubble freeze in the cutover
runbook — ordering and payments disabled there. A parent still on `3.7.0` after that sees
whatever *Bubble* shows, which is not a screen in this repository.

I have set nothing, as instructed. The recommendation in the plan is to keep setting nothing on
the 19th, and to arm the gate only if a released 4.0.x turns out to be harmful — with the hard
rule that the floor may never exceed a version that is actually downloadable, because a parent
blocked below a non-existent build has no recovery at all.

## D43

**`npm run ship:ota -- "message"` is the one line, and it lives in the root `package.json`.**
`eas update` has to run from `apps/mobile`, so the script is
`cd apps/mobile && npx eas update --branch production --message` — the trailing flag means
`npm run ship:ota -- "text"` appends the message rather than passing it as a positional, which
`eas` would ignore.

## D44

**The Account screen's build label now names the running JS, and that is how an OTA is
confirmed.** `gitSha` is stamped at build time and never moves when an update lands, so there was
no way to tell fresh JS from bundled JS on a device. The label now reads
`Production · 394dd2f · OTA 4625c38` or `… · bundled`.

Self-proving on build 12: that binary was compiled before the segment existed, so the segment can
only appear if an update replaced its JS.

The first shape was a `identity` prop for testability and `orphans.test.ts` refused it —
correctly, since nothing but a test would pass it. The logic moved into a pure `buildLabelText`.
I changed my code rather than the guard; `UpdateRequiredScreen` had already made the same call
for the same reason.
