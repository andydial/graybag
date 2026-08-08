---
title: Spike results — E19-01, E19-02
status: partial — §A answered 2026-08-08 without a device; §B awaits the handset session
---

# Spike results

The procedure is `docs/spike-runbook.md`. This is where the answers land. `E19-06` closes when
every row below is filled and anything contradicting `docs/payments-design.md` has been changed
**in that document**, in the same PR.

---

## A. Answered without a handset — 2026-08-08

| # | Question | Answer | Evidence |
|---|---|---|---|
| A1 | Does `react-native-razorpay` support RN 0.86 / New Architecture? | **Yes.** Ships `codegenConfig` and an `isNewArchitectureEnabled()` gradle branch. v3.0.0, published 2026-07-21 | `node_modules/react-native-razorpay/{package.json,android/build.gradle}` |
| A2 | Does the RN wrapper supply the Android 11+ `<queries>` block? | **No.** Its manifest declares only `CheckoutActivity` | its `android/src/main/AndroidManifest.xml` |
| A3 | Does anything in its dependency chain supply it? | **Yes** — `com.razorpay:standard-core` declares `<queries>` including `scheme="upi" host="pay"`. So the chooser may already work with nothing added | AAR manifest, Maven Central |
| A4 | Is the payment SDK version pinned? | **No.** `com.razorpay:checkout:1.6.41` depends on `standard-core` at version `LATEST`. Builds are not reproducible and the `<queries>` block can change under us | `checkout-1.6.41.pom` |
| A5 | Does the wrapper reference a stale RN artefact? | **Yes** — `com.facebook.react:react-native:+`, which on Maven Central stops at 0.71.0-rc.0; current RN publishes as `react-android`. RN's gradle plugin normally substitutes it. The EAS build is the confirmation | its `android/build.gradle`; Maven metadata |
| A6 | Is the callback signature construction as designed? | **Implemented and unit-verified** as `HMAC-SHA256(key_secret, "order_id\|payment_id")` hex, both match and non-match. Whether Razorpay *produces* it needs a real payment (B7) | `scripts/verify-signature.mjs` |
| A7 | Does the `<queries>` config plugin work if needed? | **Yes.** A local `expo prebuild` shows it merging into Expo's existing `<queries>` rather than replacing it, emitting the `upi://pay` intent plus six PSP packages | generated `AndroidManifest.xml` |

**A3 and A4 together are the finding that changes plans.** `E06-29` was scoped as "add the
`<queries>` block". It is more likely to become "**assert the merged manifest still contains a
`<queries>` block we do not control the version of**" — a regression test against a floating
third-party dependency, which is a different and slightly worse problem.

---

## B. Awaiting the handset session

| # | Question | Answer | Why it matters |
|---|---|---|---|
| B1 | Does the EAS release build succeed? | *(pending)* | A5 is the most likely failure |
| B2 | Does a **UPI app chooser** list installed PSP apps? | *(pending)* | The entire spike. No chooser = silent degradation to collect/QR (§3.3) |
| B3 | If not, does enabling `withUpiQueries` fix it? | *(pending)* | Decides whether `E06-29` is a fix or a regression test |
| B4 | Does the app return cleanly after the PSP app-switch? | *(pending)* | §3.5. If not, the whole return path needs rework |
| B5 | Wall-clock, tap-Pay → callback | *(pending)* | Sets the waiting-state design under `S5` |
| B6 | Is the payment **captured** or only **authorized**? | *(pending)* | Item 4. If authorize-only, `L5` starts costing real orders |
| B7 | Does the real callback signature verify? | *(pending)* | Item 9. A mismatch rejects every legitimate payment |
| B8 | Does the app survive the app-switch under memory pressure? | *(pending)* | §3.4. Sets how often the recovery path runs |
| B9 | Cold start `TotalTime` (median of 5, first discarded) | *(pending)* | Sets `E14-07`'s thresholds |
| B10 | JS-side first render, for comparison | *(pending)* | Splits native/bundle cost from JS cost |
| B11 | 50-item scroll: total frames, janky %, p50/p90/p95/p99 | *(pending)* | `E14-07` |
| B12 | Same, with the Skia layer on | *(pending)* | Validates `E13-05`'s framework choice |
| B13 | Transition: elapsed ms and janky frames over ~10 cycles | *(pending)* | Dropped frames in a transition are far more visible than in a list |
| B14 | Subjective: image pop-in, list fill time on a real connection | *(pending)* | The audience constraint the performance plan is written against |

---

## C. Not in this session

`E19-07`'s remaining §12 rows — the webhook event set, event-id header, retry policy and
timeout, collect-pending window, refund idempotency and listing, MDR in the capture payload,
the settlement recon endpoint, payments-list windowing — need a **public webhook endpoint** and
a Razorpay dashboard webhook subscription. That is a separate sitting; `create-order.mjs`
already exercises items 13 (duplicate `receipt`) and 14 (`notes` round-trip) as a by-product.
