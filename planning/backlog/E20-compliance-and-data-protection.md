---
id: E20
title: Compliance & Data Protection
phase: 1
risk: critical
status: not-started
depends_on: [E02]
summary: India's DPDP Act, children's data, consent records and policy versioning. The system stores minors' names, class, section and allergies (health data), so this is not an app-store checkbox.
---

## Why this is critical

GrayBag stores personal data about **children**, including **allergies**, which is health
data. India's Digital Personal Data Protection Act 2023 requires verifiable parental
consent for a child's data, a stated purpose, a grievance officer, and breach
notification to the Data Protection Board. The legacy Bubble app had none of this and
also exposed the data publicly.

## Tasks

- [ ] `E20-01` (risk:critical) (owner:andy) Confirm DPDP obligations that apply to GrayBag with a lawyer or the accountant — children's data, verifiable parental consent, grievance officer, breach reporting timelines
- [x] `E20-02` (risk:critical) (mvp) **Consent capture** at dependent creation: explicit, purpose-scoped, recorded with timestamp and policy version
- [ ] `E20-03` (risk:critical) (mvp) `policy_version` and `user_policy_acceptance` tables — store which version each user accepted and when. Ordering is blocked until the current version is accepted
- [ ] `E20-04` (mvp) Consent withdrawal and data deletion flow, honouring both DPDP and app-store account-deletion requirements (pairs with `E03-08`)
- [ ] `E20-05` Data retention policy: how long orders, invoices (statutory minimum), children's records and logs are kept, and automated purge for anything past it
- [ ] `E20-06` (mvp) Privacy notice written for actual practice, not boilerplate — what is collected, why, who it is shared with (Razorpay, SMS provider, Sentry), and for how long
- [ ] `E20-07` (mvp) Named **grievance officer** with contact details published on the website and in the app
- [ ] `E20-08` (risk:high) **Breach notification runbook** — who is told, in what order, within what deadline
- [ ] `E20-09` Purpose limitation enforced in code: kitchen staff see what they need to prepare and deliver, never more; school reports carry aggregates only
- [ ] `E20-10` (mvp) Exclude children's data and PII from product analytics and from Sentry payloads (scrubbing rules, verified by test)
- [ ] `E20-11` Data-processing review of every third party touching personal data (Supabase, Razorpay, SMS provider, Sentry, Netlify, Expo) — where the data sits and what the contract says

Appended by `Q10` (`docs/dpdp-compliance.md`). The specification for `E20-02`…`E20-11` is that
document; the tasks below are the gaps it found. `E20-13`, `E20-14` and `E20-15` are all `0003`
migration work and are cheap now.

- [ ] `E20-12` (risk:critical) Seed `policy_document`, `policy_version` and `consent_purpose` with the **approved** wording once `E20-01` returns. Deliberately unseeded in `0001` — a consent record pointing at wording nobody approved is evidence of the wrong thing
- [ ] `E20-13` `0003`: add `'retain'` to `retention_policy.action` and make `retention_days` nullable for it, so "kept indefinitely, by law, and here is the basis" is recordable. Today the table can only express purging
- [ ] `E20-14` `0003`: add `dsr_ack_days`, `dsr_response_days`, `breach_board_hours` and `breach_cert_in_hours` to `platform_config`, so every statutory deadline is one config value quoted in one place. `data_subject_request.due_at` is `not null` with no default and currently has no legal number to compute from
- [ ] `E20-15` (risk:high) `0003`: split `consent_record_insert_self` on `action`. A `granted` row keeps the `auth_can_manage_recipient()` requirement; a `withdrawn` row is permitted where the caller is the `user_id` of an existing grant. Today a co-guardian with `can_manage = false`, or one whose link was revoked, **cannot withdraw the consent they gave** (`[DP-07]`)
- [ ] `E20-16` (risk:high) Removing a dependent writes the `withdrawn` `consent_record` rows in the **same transaction** that sets `deleted_at` — after which no customer-facing path can write them at all. Test: no `granted` row survives in `current_consent` for a removed dependent
- [ ] `E20-17` Overdue-DSR alerting: warn at 50% of the window, **page** the moment any `data_subject_request` passes `due_at`, and list open requests with days remaining in the daily digest. Nothing errors when a date passes
- [ ] `E20-18` (risk:high) The erasure pipeline as one Edge Function running the fixed order in `docs/dpdp-compliance.md` §6.5, with a pgTAP test asserting tier-S rows are gone, tier-P snapshots nulled, `invoice.buyer_*_snapshot` intact and `consent_record` retained
- [ ] `E20-19` Purge job: dry run first with a volume tripwire, `purge_run` evidence on every run including dry runs, and a **coverage assertion** that every table holding tier S/P/A data has a `retention_policy` row. A table with no row alerts rather than defaulting to "keep forever"
- [ ] `E20-20` (risk:high) **Breach drill** — run the runbook end to end against a simulated exposure, once before launch and annually. An untested runbook is a document, not a control
- [ ] `E20-21` (owner:andy) Decide and supply the **named grievance officer**: name, designation, email and published address. `E20-07` cannot publish a placeholder, and the four `«…-PENDING-E20-21»` tokens in `docs/dpdp-compliance.md` §7.2 block launch
- [ ] `E20-22` Placeholder guard: CI fails if any `«…-PENDING-…»` token reaches a production build of the app or the website. Same control as `G3` does for the invoice GSTIN
- [ ] `E20-23` Prepare the **legacy-exposure incident pack** for `E20-01` to assess: what `Order`, `Child`, `Dish_In_Order` and `Temp` exposed, since when, how many records, and whether the Data API was public (`E00-04`, `E00-05`). Facts only — whether it is a notifiable breach is the lawyer's call (`[DP-03]`)
- [ ] `E20-24` Draft **privacy policy, terms and refund policy** delivered as `docs/{privacy-policy,terms,refund-policy}.md` (Q11), as lawyer templates grounded in `docs/dpdp-compliance.md` and `docs/payments-design.md`, every unresolved value a `«…-PENDING-…»` token. Legal review of all three is `E20-01`; this is the drafting
- [ ] `E20-25` (risk:high) (owner:andy) Lawyer to review and approve the **allergy liability** (`[PP-03]`) and **liability cap** (`[PP-04]`) wording in `docs/terms.md` §8 and §10 — health-and-safety language, must not ship unreviewed. Rides with `E20-01`
- [ ] `E20-26` Wire the three policy documents into the app **policy gate** (`E20-03`) and the website footer / app Settings → Privacy, rendered from the static build not a public table read (`[AZ-03]`). The grievance block (`§7.2`) must be reachable without an account
- [ ] `E20-27` Extend the `E20-22` placeholder guard to scan `docs/privacy-policy.md`, `docs/terms.md` and `docs/refund-policy.md` for `«…-PENDING-…»` tokens in any production/published build
- [ ] `E20-28` Confirm the third-party-recipient list declared in the store **Data Safety** form (Razorpay, Supabase, SMS provider, Sentry, push) matches the processor register in `docs/dpdp-compliance.md` §9 and the `E20-11` review, so the label, the policy and the DPA register cannot drift apart (`[SS-02]`)
- [ ] `E20-29` (risk:high) **Push/notification bodies must not contain tier-P/S data.** A body like "Aarav's lunch has been delivered" is a child's name on a lock screen and in transit to Expo/EAS. The rule now lives in `dpdp-compliance.md` §9; build the same sentinel-name test as `E20-10` over the `E08` templates (`E08-03`, `E08-05`) and the Expo push payload. Copy decision is `[DP-08]` (review finding #7)
- [ ] `E20-30` (risk:critical) **Scoped erasure Edge Function (`recipient` vs `account`).** `dpdp-compliance.md` §6.5 now takes a `scope` param so a single child's consent withdrawal no longer anonymises the parent or deletes siblings; `E20-18` must honour it. Build the function and a test that a `recipient`-scope run leaves the parent `app_user` and sibling `recipient` rows byte-for-byte unchanged (review finding #4)
- [ ] `E20-31` **Tier-classification coverage assertion.** `data-model.md` §13.3 is now the complete normative source (added `order_line.allergen_codes_snapshot`=S, `invoice_line.description`=P) and `dpdp-compliance.md` §2.2 defers to it. Implement §6.4's assertion that every tier-S/P/A table has a `retention_policy` row, keyed off §13.3 (review finding #13)
- [ ] `E20-32` (risk:high) **`migration.migration_review` and `migration.legacy_id_map` hold tier-A/P data (phone/name in `detail`/`legacy_id`) with no retention row and no place in erasure.** Add their retention rows to `dpdp-compliance.md` §6.2 and a teardown after `E17-22`/the review queue is worked; §6.4's coverage assertion should fail until they are classified (review finding #18)
- [ ] `E20-33` **Build an owned `otp_attempt` table for `E03-10`'s throttle counting, with a real retention row.** Today OTP state lives only in Supabase's managed `auth`/GoTrue schema; the published policy line was corrected to say so. `E03-10` needs a table to count against (review finding #17)
- [ ] `E20-34` **Reconcile `product_analytics` across the three documents that disagree** (privacy-policy collects it, dpdp §5.1 names a vendor but §9 register has no row, store-submission declares "no Analytics"). Pick a vendor + declare Analytics, OR cut analytics for v1 and remove the consent purpose/policy line/recipient. Decision + options are `[DP-09]`; rides with `[DP-05]` (review finding #19)

- [ ] `E20-35` (risk:critical) **BLOCKS `E17-04` — no store form may be submitted until this is closed.** Finish or disable `E20-10` (no PII in logs or Sentry). Every "not collected" answer in `docs/andy-prep/store-privacy-answers.md` assumes it, and answering a store form wrongly is a compliance problem rather than a paperwork one
- [ ] `E20-36` (risk:critical) **The policy acceptance gate is never mounted.** `PolicyGateScreen` exists, is tested, and `onAccept`/`onNotNow`/`accepting` have no caller — so the version-acceptance gate that `E20-03` calls one of the six compliance tasks does not run. Found by the extended orphan guard, not by a person
- [ ] `E20-37` (risk:high) **Account deletion has no route.** `AccountScreen.onDeleteAccount` is never passed. One of the six compliance tasks; the screen renders a row that does nothing
- [ ] `E20-38` **Privacy, terms and refund policies are published but unlinked.** `AccountScreen.onPolicy` has no caller, so nothing in the app opens them
- [ ] `E20-39` **Support and the grievance officer are unreachable.** `AccountScreen.onSupport`, `SupportScreen.grievance` and `SupportScreen.supportEmail` all have no caller. DPDP requires a published contact point for data complaints. Per Andy 2026-08-11: keep the route, **replace the exposed address with a contact form or a compose action that reaches andy@graybag.com without displaying it**
