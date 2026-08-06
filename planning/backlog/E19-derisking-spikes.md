---
id: E19
title: De-risking Spikes
phase: 1
risk: critical
status: not-started
depends_on: []
summary: Short, throwaway experiments that answer the questions capable of invalidating later work. Each is timeboxed to a day or two and needs almost no infrastructure.
---

## Why these are first

Each of these can invalidate a large amount of downstream work if the answer is bad.
Doing them in phase 1 costs days; discovering them in phase 4 costs weeks.

## Tasks

- [ ] `E19-01` (risk:critical) **Razorpay + UPI spike** — Standard Checkout in test mode inside a bare Expo app, on a real low-end Android. Prove native UPI intent works and returns cleanly. Blocks the whole E06 design
- [ ] `E19-02` (risk:critical) **Low-end Android performance spike** — bare Expo + Reanimated + Skia on a **mid-range Android** typical of private-school families (not the cheapest tier). Measure cold start, 50-item list scroll with images, and a shared-element transition. Sets the thresholds used in `E14-07` and validates the framework choice before `E13-05` is finalised
- [ ] `E19-03` (risk:high) (owner:andy) **VAG Rounded Next licence check** — confirm the licence permits app embedding and webfont use. If not, the entire design system needs a different typeface before `E13-01`
- [ ] `E19-04` (risk:high) **Bubble export dry run** — inspect the dump from `E00-15`: real row shapes, mobile-number quality, image URLs, what is and is not obtainable. Feeds `E16`
- [ ] `E19-05` (risk:high) **Supabase Edge Function + connection pooling probe** — confirm concurrency limits and pooler behaviour under a burst, so the plan size is chosen on evidence not guesswork
- [ ] `E19-06` Write up each spike's result as a short note in `docs/`, including anything that changes a decision in `docs/decisions.md`
- [ ] `E19-07` (risk:critical) **Answer the 20-item verification checklist in `docs/payments-design.md` §12** as part of `E19-01` — signature algorithms and header names, the webhook event set and event-id header, retry policy and response timeout, auto-capture under UPI intent, UPI collect pending window, refund idempotency and listing, whether MDR is in the capture payload, the settlement recon endpoint, and the payments-list windowing. Each row names what breaks if the answer differs. **Note two corrections to `E19-01` as written**: the official Razorpay RN SDK is a native module, so the spike needs an **EAS development build, not a bare managed Expo app** (`[PAY-01]`), and it must run on a **real Android 11+ handset** or the `<queries>` failure in `E06-29` will not reproduce
