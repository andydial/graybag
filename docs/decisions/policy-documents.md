# Decisions — Policy documents

`PP1`–`PP4` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

Made in Q11 while drafting `docs/{privacy-policy,terms,refund-policy}.md` as lawyer templates. None
override an existing entry; these are choices about how the three documents are structured. The *law*
in them is provisional on `E20-01`, exactly as with the DPDP machinery — every unresolved value is a
`«…-PENDING-…»` token guarded by `G3`/`E20-22`.

| # | Decision | Why |
|---|---|---|
| PP1 | **The three policies cross-reference rather than duplicate.** Refund detail lives only in `refund-policy.md`; Terms §6 summarises and links; the privacy notice does not restate refund mechanics. The refund policy is declared "part of the Terms" so it is contractually binding | Same instinct as the `api/` module rule (`A4`) and the token source (`S8`): one source per fact, so a change to the cancellation window edits one document, not three |
| PP2 | **Retention numbers in the privacy notice are written as the §6.2 *proposals* with tokens, never as decided values.** The parent-facing table quotes the proposed number in prose ("proposed: 8 years") next to the token | Consistent with `C6` and `[DP-02]`: inventing a number in a published policy would be inventing the law. Quoting the proposal means the lawyer edits a number rather than a blank |
| PP3 | **The allergy disclaimer is stated in both the Terms (§8) and the privacy notice, and flagged as the top launch risk** | A food business serving children that shows allergy warnings has a duty-of-care surface these documents must address head-on. `[PP-03]` BLOCKS launch — the wording is health-and-safety language that must be lawyer-reviewed (`E20-25`) |
| PP4 | **Cross-border wording distinguishes adult data (may leave India via Sentry/Expo/email) from child data (never leaves India by design)** | Mirrors `[DP-05]` and the §5.3 egress rules exactly, so the notice does not over-claim "all your data stays in India" — which would be false for Sentry and Expo, and a false privacy claim is itself a problem |
