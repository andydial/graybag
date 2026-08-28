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

### What "no test data in production" actually forbids — 2026-08-28

Andy, correcting me after I offered to ask before he created a meal pack offer on the screen built
for creating meal pack offers:

> *"Creating a meal pack offer through the admin UI is not test data — it's me using the product.
> The rule is about fabricated data: fixtures, fake parents, seeded orders. If I create an offer I
> intend to sell, that's real. Don't ask before I do something the screen exists for."*

| # | Decision | Why |
|---|---|---|
| SR4 | **The test is whether the data is *fabricated*, and who is acting — not which database it lands in.** Andy operating a back-office screen for its designed purpose is ordinary use and needs no permission from anybody. What still needs an explicit yes is **me** writing rows on production, and anything fabricated regardless of who asks | Non-negotiable #8 exists because three cancelled orders, two children, three consent records, a payment and three webhook events were created on production by hand. Every one of those was *invented*. An offer Andy intends to sell is a business record, and treating it as a risky write makes the guardrail noise — a rail that fires on normal work is one that gets ignored on the day it matters. The rule keeps all its force where it was aimed: fixtures, fake parents, seeded orders, webhook probes, and anything I write |
