# Decisions — Seed data

`SD1`–`SD5` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

Made in `E01-13` while writing `supabase/seed.sql`.

| # | Decision | Why |
|---|---|---|
| SD1 | **Fixture ids are fixed, readable UUIDs (`cc000000-…` kitchen, `50000000-…` school, …), never `gen_random_uuid()`** | Tests reference these rows directly, and a random fixture forces every assertion to look the row up by name first. The prefix means a failing test's output says what kind of row it was. Constraint learned the hard way: the prefix must be **hex** — `k1000000-…` is not a valid uuid |
| SD2 | **The seed stops at reference data and people. It creates no orders, payments, invoices or ledger entries** | Those have state machines and money invariants. A fixture that fakes one by direct insert teaches tests to expect a state the application itself can never produce, and the first real bug it hides is a ledger that does not balance. They arrive with the code that creates them (E05, E06, E07) |
| SD3 | **The fixture set is chosen for the states that are otherwise untestable, not for realism** — a guardian who may view but not order, a draft menu assigned to nothing, a migrated account never claimed, an adult ordering for themselves, an allergy that genuinely collides with a dish on that school's menu | Each of these is a paragraph in `docs/open-questions.md` ([AZ-05], [DM-11], [DM-08]) that would otherwise never be exercised. `supabase/tests/seed.test.sql` asserts each one, so the fixture cannot quietly stop covering it |
| SD4 | **`price_is_tax_inclusive` is left NULL in the seed** | `[DM-20]` is open. A fixture that picks a value is a guess about money that propagates into every invoice any test ever asserts, and it would look like a decision. The seed test asserts it stays null |
| SD5 | **The allergen table is seeded with four codes, not the twelve in the data model** | `[DM-13]` is open and `[MI-01]` says the source workbook is not in the repository, so there is no real allergen list to seed. Four codes make the JOINs work without the fixture masquerading as an answer |
