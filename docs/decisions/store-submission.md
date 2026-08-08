# Decisions — Store submission

`SUB1`–`SUB3` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

Made in Q12 while writing `docs/store-submission.md`. Mechanism / presentation choices about the
App Privacy (Apple) and Data Safety (Google) declarations — honest and low-stakes, recorded so they
are not silently reversed at submission time.

| # | Decision | Why |
|---|---|---|
| SUB1 | **The store data-safety declarations are generated from the tier S/P/A model, and the privacy policy is the single source of truth they must match.** If policy and label ever disagree, the policy wins and the label is corrected, never the reverse | Same instinct as the `api/` module rule and the token-source rule: one source, derived outputs. Both stores require the declared collection to match the linked policy exactly, so the reconciliation is mandatory (`E17-19`) |
| SUB2 | **Declare conservatively: broad on "what", narrow on "why".** When a data type could honestly be declared collected or not, declare it collected; when a purpose could be read broadly or narrowly, declare it narrowly | Over-declaring collection is safe (the app looks slightly more data-hungry); under-declaring is a policy violation and a takedown risk. Over-declaring *purpose* (e.g. Analytics on contact data) invites scrutiny we do not need. `[SS-01]`, `[SS-02]` |
| SUB3 | **GrayBag declares NO tracking (Apple ATT) and NO advertising ID** — no cross-app/cross-site tracking, no ad SDK, no advertising identifier, so no ATT prompt is required | s.9 of DPDP forbids profiling a child (dpdp §3.3). Recorded because adding any analytics/attribution SDK later would flip this and require an ATT prompt + a label change — it must be a conscious decision, not a dependency someone quietly adds |
