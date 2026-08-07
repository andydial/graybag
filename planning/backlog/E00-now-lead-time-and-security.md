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
- [ ] `E00-06` (risk:high) (owner:andy) Start **TRAI DLT registration**: Principal Entity on one operator portal (PAN, GST cert, CIN, signatory, letterhead; ~Rs 5,000)
- [ ] `E00-07` (risk:high) (owner:andy) Register DLT **Header / Sender ID** `GRYBAG` as Transactional / Service Implicit
- [ ] `E00-08` (risk:high) (owner:andy) Register 5 DLT **content templates**: OTP login, order confirmation, pickup code, refund confirmation, order cancelled
- [ ] `E00-09` (owner:andy) Open account with SMS provider (MSG91 or Gupshup); link DLT Entity ID, Header and Template IDs
- [ ] `E00-10` (risk:high) (owner:andy) (mvp) Accountant: obtain **GSTIN**, confirm **SAC code** (996331 assumed), confirm CGST/SGST split for Mohali / SAS Nagar
- [ ] `E00-11` (risk:high) (owner:andy) (mvp) Accountant: confirm whether the school's 10% revenue share attracts 18% GST on the school's invoice to GrayBag
- [ ] `E00-12` (owner:andy) (mvp) Confirm whether menu `Price` in the Excel is GST-inclusive or exclusive (cart currently adds 5% on top)
- [ ] `E00-13` (owner:andy) (mvp) Verify direct access to Apple Developer account and Google Play Console independent of Bubble
- [ ] `E00-14` (owner:andy) (mvp) Locate original dish images (Bubble CDN URLs die on migration); inventory what is missing
- [ ] `E00-15` (owner:andy) (mvp) Export a full Bubble **data** dump (users, children, orders, dish_in_order, schools, kitchens, menus) — hand it over; the build side inspects and reports on it in `E19-04`
- [ ] `E00-17` (mvp) Draft the **secret rotation policy** for Andy to approve: which keys, how often, who does it, where they are stored
- [ ] `E00-18` (owner:andy) (mvp) Check whether any legacy **prepaid card / wallet balances** exist off-system for early users; if so they must be migrated as opening ledger credits (see `E16-15`)
- [ ] `E00-19` (owner:andy) (mvp) Decide the customer **self-cancellation window** (`[PP-01]`) and the **post-delivery refund stance** (`[PP-02]`) for the refund policy. These are the final customer-facing values `docs/refund-policy.md` is blocked on; drafts ship with tokens until set
- [ ] `E00-20` (mvp) Implement the **rotation logbook + a scheduled reminder** (calendar or Better Stack heartbeat) driving the `docs/secret-rotation-policy.md` §1 cadences, so 180/90/365-day rotations are prompted, not remembered. The reminder mechanism only — the credentialed rotation itself stays Andy's
