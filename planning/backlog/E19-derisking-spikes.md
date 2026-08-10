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

- [x] `E19-01` (risk:critical) (mvp) **Razorpay + UPI spike** — Standard Checkout in test mode, on a real Android 11+ handset. Prove native UPI intent works and returns cleanly. Blocks the whole E06 design. **PARKED 2026-08-08 awaiting Andy's handset (expected 2026-08-09 morning): all setup is done and merged** — harness at `tools/spike-mobile/`, release APK **built and green** on EAS (`28127b5b`), `adb` installed, order-creation and signature-verification scripts tested. Static analysis already answered five checklist rows (`docs/spike-results.md` §A). **CLOSED 2026-08-09.** A real test-mode UPI payment on a real handset **captured** (not merely authorized) and its callback signature **verified**. `[PAY-01]` resolved to the native RN SDK; checklist items 1, 2, 4 and 9 answered. The UPI-chooser question (B2) could not be settled on a single-UPI-app device and was closed by construction instead — `E06-29` enabled permanently, `E06-32` asserting it in the built APK, `E19-08` pinning the upstream source. Results in `docs/spike-results.md`
- [x] `E19-02` (risk:critical) (mvp) **Low-end Android performance spike** — Expo + Reanimated + Skia on a **mid-range Android** typical of private-school families (not the cheapest tier). Measure cold start, 50-item list scroll with images, and a shared-element transition. Sets the thresholds used in `E14-07` and validates the framework choice before `E13-05` is finalised. **CLOSED 2026-08-09 on a subjective verdict — "performance acceptable" — with no recorded figures.** That is enough to validate `E13-05`'s framework choice and to keep `M05`, which is what this spike was for. It is **not** enough for `E14-07`, whose thresholds Andy ruled must come from measured numbers: see `docs/spike-results.md` §D. `E14-07` stays blocked on one `adb` session, not on a decision
- [x] `E19-03` ~~VAG Rounded Next licence check~~ — **CLOSED BY DECISION 2026-08-10 (`S35`), not by checking.** Nunito is the typeface outright. No licence question remains to answer
- [x] `E19-04` (risk:high) (mvp) **Bubble export dry run** — inspect the dump from `E00-15`: real row shapes, mobile-number quality, image URLs, what is and is not obtainable. Feeds `E16`
- [ ] `E19-05` (risk:high) **Supabase Edge Function + connection pooling probe** — confirm concurrency limits and pooler behaviour under a burst, so the plan size is chosen on evidence not guesswork
- [ ] `E19-06` Write up each spike's result as a short note in `docs/`, including anything that changes a decision in `docs/decisions.md`
- [ ] `E19-07` (risk:critical) **Answer the 20-item verification checklist in `docs/payments-design.md` §12** as part of `E19-01` — signature algorithms and header names, the webhook event set and event-id header, retry policy and response timeout, auto-capture under UPI intent, UPI collect pending window, refund idempotency and listing, whether MDR is in the capture payload, the settlement recon endpoint, and the payments-list windowing. Each row names what breaks if the answer differs. **Note two corrections to `E19-01` as written**: the official Razorpay RN SDK is a native module, so the spike needs an **EAS development build, not a bare managed Expo app** (`[PAY-01]`), and it must run on a **real Android 11+ handset** or the `<queries>` failure in `E06-29` will not reproduce
- [x] `E19-08` (risk:high) **Pin the Razorpay Android SDK version.** `com.razorpay:checkout:1.6.41` declares its dependency on `com.razorpay:standard-core` as version `LATEST`, so two builds a week apart can embed different payment SDK code with nothing in our lockfile to show it — including a different `<queries>` block (see `docs/spike-runbook.md` §1.3). Add a Gradle `resolutionStrategy` force (or an explicit pinned `implementation`) via `expo-build-properties`, so we choose when the payment SDK changes. Found by `E19-04`'s sibling static analysis during `E19-01` setup
