---
id: E00
title: Immediate — Security & External Lead Time
phase: 0
risk: critical
status: not-started
depends_on: []
summary: Things with real-world lead time or live security exposure. Nothing else is blocked by these, but they block launch if started late.
---

## Why first

Every item here is either a live security exposure or has a multi-week external dependency (government, accountant, telco). None of them require any code.

## Tasks

- [ ] `E00-01` (risk:critical) (owner:andy) (mvp) Rotate the **live Razorpay key** (`rzp_live...`) — it is in cleartext in the `.bubble` export file
- [ ] `E00-02` (risk:critical) (owner:andy) (mvp) Rotate the Stripe test secret key and the 2 Bubble marketplace plugin app secrets found in the same file
- [ ] `E00-03` (risk:critical) (mvp) Add `*.bubble` to `.gitignore` before the repo exists; store the export outside the repo
- [ ] `E00-04` (risk:high) (owner:andy) (mvp) Check whether Bubble's **Data API** is exposed publicly; if so, disable it (Order and Child data are currently world-readable)
- [ ] `E00-05` (risk:high) (owner:andy) (mvp) Tighten Bubble privacy rules as a stopgap on the live app: `Order` (currently everyone can search/view all), `Child`, `Dish_In_Order`, `Temp`
- [x] `E00-06` ~~Start **TRAI DLT registration**~~ — **OUT OF SCOPE 2026-08-10 (`P16`).** v1 is email only; no SMS, no push. Not deferred — dropped. If SMS is ever wanted the approval chain restarts, knowingly
- [x] `E00-07` ~~Register DLT **Header / Sender ID**~~ — **OUT OF SCOPE 2026-08-10 (`P16`).** v1 is email only; no SMS, no push. Not deferred — dropped. If SMS is ever wanted the approval chain restarts, knowingly
- [x] `E00-08` ~~Register 5 DLT **content templates**~~ — **OUT OF SCOPE 2026-08-10 (`P16`).** v1 is email only; no SMS, no push. Not deferred — dropped. If SMS is ever wanted the approval chain restarts, knowingly
- [x] `E00-09` ~~Open account with SMS provider~~ — **OUT OF SCOPE 2026-08-10 (`P16`).** v1 is email only; no SMS, no push. Not deferred — dropped. If SMS is ever wanted the approval chain restarts, knowingly
- [ ] `E00-10` (risk:high) (owner:andy) Accountant: obtain **GSTIN**, confirm **SAC code** (996331 assumed), confirm CGST/SGST split for Mohali / SAS Nagar
- [ ] `E00-11` (risk:high) (owner:andy) Accountant: confirm whether the school's 10% revenue share attracts 18% GST on the school's invoice to GrayBag
- [x] `E00-12` (owner:andy) (mvp) Confirm whether menu `Price` in the Excel is GST-inclusive or exclusive (cart currently adds 5% on top)
- [ ] `E00-13` (owner:andy) (mvp) Verify direct access to Apple Developer account and Google Play Console independent of Bubble
- [ ] `E00-14` (owner:andy) (mvp) Locate original dish images (Bubble CDN URLs die on migration); inventory what is missing
- [ ] `E00-15` (owner:andy) (mvp) Export a full Bubble **data** dump (users, children, orders, dish_in_order, schools, kitchens, menus) — hand it over; the build side inspects and reports on it in `E19-04`
- [ ] `E00-17` Draft the **secret rotation policy** for Andy to approve: which keys, how often, who does it, where they are stored
- [ ] `E00-18` (owner:andy) (mvp) Check whether any legacy **prepaid card / wallet balances** exist off-system for early users; if so they must be migrated as opening ledger credits (see `E16-15`)
- [ ] `E00-19` (owner:andy) Decide the customer **self-cancellation window** (`[PP-01]`) and the **post-delivery refund stance** (`[PP-02]`) for the refund policy. These are the final customer-facing values `docs/refund-policy.md` is blocked on; drafts ship with tokens until set
- [ ] `E00-20` Implement the **rotation logbook + a scheduled reminder** (calendar or Better Stack heartbeat) driving the `docs/secret-rotation-policy.md` §1 cadences, so 180/90/365-day rotations are prompted, not remembered. The reminder mechanism only — the credentialed rotation itself stays Andy's

- [ ] `E00-22` (owner:andy) (risk:critical) (mvp) **Fix the four failing Supabase auth settings on staging** — `npm run check:config` names them: OTP length 8 → 6, Site URL still `localhost:3000`, empty redirect allow-list, and an email rate limit of **2 per hour** (project-wide, so the third parent signing in at the school gate gets nothing). Dashboard only; no PR can fix these
- [ ] `E00-21` (owner:andy) (risk:high) (mvp) **A real SMTP sender before production** — Supabase's built-in email is a handful of messages an hour with no delivery guarantee, and for an OTP-only product that means nobody can sign in. Resend/SES/Postmark with SPF and DKIM
