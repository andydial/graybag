---
id: E18
title: Deferred — Post-Launch Backlog
phase: 9
risk: low
status: not-started
depends_on: [E17]
summary: Explicitly out of v1. Listed so nothing is forgotten and so the schema can accommodate them without rewrites.
---

## Tasks

### Subscriptions (design not yet decided)

The model has been discussed once internally and needs a conversation with a school. For planning, assume **parents subscribe**. Schema should not preclude any of the options below.

- [ ] `E18-01` (owner:andy) Decide: parent subscribes in-app vs school buys in bulk and bills through school fees
- [ ] `E18-02` (owner:andy) Decide: auto-generate daily orders vs subscription acts as prepaid credit with daily dish selection
- [ ] `E18-03` (owner:andy) Decide: meal-pack composition (e.g. 20 meals = main + drink + dessert) and whether the customer chooses dishes
- [ ] `E18-04` (owner:andy) Decide: unused meals at period end — expire, roll over, or refund
- [ ] `E18-05` (owner:andy) Decide: mid-period cancellation and pro-rata refund policy
- [ ] `E18-06` (owner:andy) Decide: per-school / per-kitchen subscription pricing (near certain to be needed across cities)
- [ ] `E18-07` Pre-plan a week or month of orders, editable until each day's cutoff
- [ ] `E18-08` Build subscriptions once decided

### Other deferred features

- [ ] `E18-09` Wallet **top-up** UI (balance and refund-to-wallet ship in v1; top-up does not)
- [ ] `E18-10` Cash / offline top-up recorded by an admin. **Gated on the RBI Prepaid Payment Instrument question** — stored value that is topped up with cash is regulated differently from refund-only credit
- [ ] `E18-11` Offline **order submission** (v1 is read-only offline) — needs conflict handling for price change, sold out, cutoff passed
- [ ] `E18-12` Per-dish daily capacity limits (table designed in E02-12, unused until needed)
- [ ] `E18-13` School holiday / exam calendar blocking ordering
- [ ] `E18-14` Separate **Delivery role** and a dedicated delivery app (permission already split in E09-09)
- [ ] `E18-15` Dedicated kitchen mobile app (v1 kitchen ops is web)
- [ ] `E18-16` WhatsApp order updates
- [ ] `E18-17` Promotional / win-back push campaigns with segmentation
- [ ] `E18-18` Razorpay Route for automatic split settlement to schools (v1 is manual bank transfer)
- [ ] `E18-19` Multi-language (Hindi / Punjabi) — English only in v1
- [ ] `E18-20` School-level reporting portal with login (v1 is monthly emailed PDF)
- [ ] `E18-21` Dedicated API server, if Edge Functions are outgrown (kept cheap by the `api/` module rule in E14-02)
- [ ] `E18-22` Read replicas and pre-aggregated reporting tables as volume grows
- [ ] `E18-23` Second contributor onboarding (branch protection and CI already in place from E01)
- [ ] `E18-24` **Chargeback / dispute handling** — the `payment.dispute.*` webhook family is deliberately not subscribed in v1 (`docs/payments-design.md` §6.4). A dispute on a ₹200 lunch is rare and a half-built dispute flow is worse than none, so until this exists a dispute is an email from Razorpay handled in the dashboard, surfacing the next morning as reconciliation break class B6
