# Decisions — Secret rotation and testing

`SR1`–`SR3` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

Made in Q13 while writing `docs/secret-rotation-policy.md` and `docs/testing-strategy.md`. The
cadence *numbers* and the coverage *number* are open (`[SEC-01]`, `[SEC-02]`, `[TEST-01]`); the
choices below are the mechanisms that hold at any number.

| # | Decision | Why |
|---|---|---|
| SR1 | **Provider secrets are stored only as Supabase Edge Function env vars / project settings, never in a committed `.env`; the service-role key never has a human copy** | The service-role key is the one credential that bypasses RLS (defeats non-negotiable #2). Concentrating it in the Edge Function tier — which the `api/` write rule (`A4`) already mandates — means exactly one place to rotate and one place to leak from |
| SR2 | **Coverage is a hard merge gate, but money and authorization correctness are gated by suite completeness (property tests + the exact-policy-set `set_eq`), not by a coverage percentage** | A percentage can be satisfied without asserting the thing that matters; an exact-policy-set assertion fails when a policy is *added* — the direction that leaks — which no coverage number would catch. `[TEST-01]`, `E01-12` |
| SR3 | **CI proves everything server-side and every signature/idempotency invariant offline; native UPI client behaviour is proven once by the `E19-01` spike, not by CI** | A CI stub cannot validate a native app-switch, and pretending it does hides the `E06-29` `<queries>` failure that only reproduces on a real Android 11+ device. The provider stub is testable but encodes assumptions until `E19-01` corrects it |
