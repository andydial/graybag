# Overnight queue

Ordered list of work that needs **no credentials, no accounts and no repo** — so it can run
unattended tonight and be reviewed tomorrow. `scripts/overnight.sh` takes the first unticked
item, hands it to Claude Code, commits the result, and moves on.

Every item produces a **file you can read and correct**, not production code. Writing app
code before the schema is reviewed and CI exists would be waste.

Do not hand-edit the ticks here — the script manages them.

## Queue

- [x] `Q01` Draft the full target ERD as `docs/data-model.md` — every entity, field, type, relationship and index for E02-02 through E02-06. Include the grant/permission model (E02-07), the resolution-chain tables (E02-06), the ledger (E02-05), and policy/consent tables (E02-15, E02-16). Mark every open question inline rather than guessing. This is the single most important artefact in the project — take the time.
- [x] `Q02` Write the actual Postgres DDL for that model as `supabase/migrations/0001_initial_schema.sql`. Integer paise for all money. Include comments explaining non-obvious choices. Do not invent anything not in `docs/data-model.md`.
- [x] `Q03` Write `docs/authorization-model.md` — for every table, exactly who can read/write what, expressed as RLS policies. Default deny. Include the full matrix: Customer, KitchenOperator, SchoolViewer, PlatformAdmin, anonymous.
- [x] `Q04` Write the RLS policies as `supabase/migrations/0002_rls_policies.sql`, and a companion `supabase/tests/authorization.test.sql` (pgTAP) asserting every allow AND every deny in the matrix from Q03.
- [x] `Q05` Write `docs/motion-system.md` from `Legacy-Application/Graybag_Design Package` — duration scale, three easing curves, the closed motion catalogue, rules of restraint, and where each pattern is allowed. Also extract design tokens (colour, type, spacing, radius) into `docs/design-tokens.md`. Reference the actual brand palette: primary #00af52, secondary #145f48 / #ffbb39, accent #b3cf3f / #e5ea98.
- [x] `Q06` Write `docs/order-lifecycle.md` — the complete order state machine, legal transitions, what happens on payment failure, app-kill-mid-payment, duplicate payment, and cutoff edge cases. This is the spec E05 and E06 are built from.
- [x] `Q07` Write `docs/payments-design.md` — Razorpay integration design: checkout flow with native UPI intent, webhook signature verification, idempotency strategy, the reconciliation job, and refund handling (full and per-line). Flag anything that must wait on the E19-01 spike.
- [x] `Q08` Build a prototype Excel menu importer as `tools/menu-import/` — parse `Legacy-Application/.../GrayBag_School_Menu 1 1.xlsx`, produce validated JSON, split the Allergens column into structured tags, and report every row that fails validation. Include tests. This proves the format before E04-04 is built.
- [x] `Q09` Write `docs/gst-invoicing.md` — invoice field list, the gapless-numbering design, the CGST/SGST rounding rule with worked examples, and a sample invoice layout. Leave GSTIN and SAC as clearly marked placeholders pending E00-10.
- [ ] `Q10` Draft `docs/dpdp-compliance.md` — consent flow for a child's data, the consent record shape, retention policy, purpose limitation, grievance officer template, and a breach-notification runbook. Mark clearly that E20-01 legal review must confirm all of it.
- [ ] `Q11` Draft `docs/privacy-policy.md`, `docs/terms.md` and `docs/refund-policy.md` for the app and website, written for GrayBag's actual practice (Razorpay, SMS provider, Sentry, Supabase Mumbai) — not boilerplate.
- [ ] `Q12` Pre-fill `docs/store-submission.md` — proposed answers to Apple's App Privacy questionnaire and Google's Data Safety form, plus draft store listing copy and a screenshot shot-list. Andy submits these; you only prepare them.
- [ ] `Q13` Write `docs/secret-rotation-policy.md` (task E00-17) and `docs/testing-strategy.md` — what is unit vs integration vs E2E, what the coverage threshold should be, what gates a merge, and how payment paths get tested without live keys.
- [ ] `Q14` Write `docs/cutover-runbook.md` — the timed step-by-step for the cutover weekend, with named go/no-go checks, the rollback plan, and draft customer comms for the one-time OTP re-login (task E17-11).
- [ ] `Q15` Review everything produced in Q01–Q14 as a skeptical senior engineer. Write `docs/overnight-review.md` listing contradictions between documents, gaps, and anything that contradicts `docs/decisions.md`. Then append genuinely new work to the backlog epics and run `node scripts/build-backlog.mjs`.
