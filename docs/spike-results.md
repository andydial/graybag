---
title: Spike results — E19-01, E19-02
status: CLOSED 2026-08-09. §A answered by static analysis 2026-08-08; §B by the handset session; the UPI chooser question was closed by construction rather than by measurement
---

# Spike results

The procedure is `docs/spike-runbook.md`. This is where the answers land.

**Both spikes are closed.** `E19-01`'s payment question is answered end to end: a real
test-mode UPI payment on a real handset captured, and its callback signature verified.
`E19-02` is closed on a subjective verdict rather than numbers — see §D, which is the one
thing in here that did not get what it came for.

---

## A. Answered without a handset — 2026-08-08

| # | Question | Answer | Evidence |
|---|---|---|---|
| A1 | Does `react-native-razorpay` support RN 0.86 / New Architecture? | **Yes.** Ships `codegenConfig` and an `isNewArchitectureEnabled()` gradle branch. v3.0.0, published 2026-07-21 | `node_modules/react-native-razorpay/{package.json,android/build.gradle}` |
| A2 | Does the RN wrapper supply the Android 11+ `<queries>` block? | **No.** Its manifest declares only `CheckoutActivity` | its `android/src/main/AndroidManifest.xml` |
| A3 | Does anything in its dependency chain supply it? | **Yes** — `com.razorpay:standard-core` declares `<queries>` including `scheme="upi" host="pay"`. **Confirmed 2026-08-09 from the built artefact**, not just the AAR: see §C | AAR manifest, Maven Central, and the spike APK's merged manifest |
| A4 | Is the payment SDK version pinned? | **No.** `com.razorpay:checkout:1.6.41` depends on `standard-core` at version `LATEST`. Builds are not reproducible and the `<queries>` block can change under us | `checkout-1.6.41.pom`. **Fixed 2026-08-09 by `E19-08`** |
| A5 | Does the wrapper reference a stale RN artefact? | **Yes** — `com.facebook.react:react-native:+`, which on Maven Central stops at 0.71.0-rc.0; current RN publishes as `react-android`. RN's gradle plugin normally substitutes it. The EAS build is the confirmation | its `android/build.gradle`; Maven metadata |
| A6 | Is the callback signature construction as designed? | **Implemented and unit-verified** as `HMAC-SHA256(key_secret, "order_id\|payment_id")` hex, both match and non-match. Whether Razorpay *produces* it needed a real payment — **it does**, see B7 | `scripts/verify-signature.mjs` |
| A7 | Does the `<queries>` config plugin work if needed? | **Yes.** A local `expo prebuild` shows it merging into Expo's existing `<queries>` rather than replacing it, emitting the `upi://pay` intent plus six PSP packages | generated `AndroidManifest.xml` |
| A8 | Does `react-native-razorpay` actually **compile** against RN 0.86 / New Arch? | **Yes.** Its full AAR pipeline ran green on EAS — `compileReleaseJavaWithJavac`, `createFullJarRelease`, `bundleReleaseLocalLintAar`. A1 was a claim from metadata; this is the compiler agreeing | EAS build `811e73ef` gradle log |
| A9 | Does `com.facebook.react:react-native:+` break the build? (A5's risk) | **No.** Zero `Could not find/resolve com.facebook.react` in the log, and the build reached `:app:checkReleaseAarMetadata` — well past dependency resolution. RN's Gradle plugin substitutes the coordinate as expected. **A5 is a documented oddity, not a live problem** | same log |

### The first build failure, and what it ruled out

Build `811e73ef` failed after 13 minutes at `:app:checkReleaseAarMetadata`:

```
Dependency 'androidx.core:core:1.18.0' requires libraries and applications that
depend on it to compile against version 36 or later of the Android APIs.
:app is currently compiled against android-35.
```

**Self-inflicted.** The spike's `app.json` pinned `compileSdkVersion: 35` via
`expo-build-properties`, below what Expo SDK 57's own dependency set requires. Fixed by
removing the `expo-build-properties` block entirely — Expo 57's defaults (compileSdk 36,
targetSdk 36, minSdk 24) are correct, and targetSdk 36 is comfortably above the 30 at which
Android enforces the package-visibility rules this spike is about. A spike should have fewer
variables, not more; pinning them was the error.

**But a failure that late is informative.** `checkReleaseAarMetadata` runs *after* dependency
resolution and after every library has compiled, so getting there proved A8 and A9 — the
Razorpay module builds clean against RN 0.86 under the New Architecture, and the stale
`react-native:+` coordinate resolves without complaint. Those were the two risks most likely to
sink `[PAY-01]`, and neither did.

---

## B. The handset session — 2026-08-09

| # | Question | Answer | Consequence |
|---|---|---|---|
| B1 | Does the EAS release build succeed? | **Yes** — `28127b5b` FINISHED after the compileSdk fix | — |
| B2 | Does a **UPI app chooser** list installed PSP apps? | **Not determinable on this device, and not being retried.** Only one UPI app was installed, so Android went straight into it rather than presenting a list. That observation is equally consistent with a working chooser and a broken one | Closed by construction instead — see §C |
| B3 | If not, does enabling `withUpiQueries` fix it? | **Question withdrawn.** There was nothing to fix on that build: its merged manifest already declared the `upi` scheme query (§C). The plugin is now on permanently regardless | `E06-29` shipped as a permanent enable, not a conditional fix |
| B4 | Does the app return cleanly after the PSP app-switch? | **Yes.** The callback fired and the success log carried all three values | §3.5's return path is as designed |
| B5 | Wall-clock, tap-Pay → callback | **Not recorded.** The session did not capture the number | `S5`'s waiting-state design still has no measured budget — see §D |
| B6 | Is the payment **captured** or only **authorized**? | **CAPTURED.** The Razorpay dashboard shows `captured`, not `authorized` | **This is the headline result.** `[OL-01]`'s auto-capture assumption holds for UPI intent. `authorized` is not a state we routinely see, so `L5` does not start costing real orders. Checklist item 4 answered |
| B7 | Does the real callback signature verify? | **Yes.** `MATCH` against `scripts/verify-signature.mjs` | Checklist item 9 answered. `POST /checkout/:group/verify` can be built exactly as §5.3 specifies |
| B8 | Does the app survive the app-switch under memory pressure? | **Not tested** | §3.4's recovery path frequency is still unknown. Does not block `E06-16`, which is built regardless |
| B9–B14 | The `E19-02` performance measurements | **Not recorded as numbers.** Verdict was "performance acceptable" | See §D. `E14-07` still has no evidence base |

### What B6 changes

Captured-not-authorized is the single most useful thing this spike returned, because it
removes a whole branch from `E06` rather than confirming one:

- `payment.status = 'authorized'` becomes a **transient** state seen only in out-of-order
  webhook delivery, not a state an order can sit in while someone decides whether to cook.
- `L5` ("never cook against an authorization") stays in the design as a guard, but it guards
  against a case that should not arise in normal operation rather than a routine one.
- `[OL-01]`'s reasoning holds without amendment: the validation manual capture would have
  bought is already done before the Razorpay order is created, and there is nothing to decide
  at capture time.

**It does not remove the need for the guard.** The rule that nothing is cooked against an
unconfirmed payment is unchanged and is not weakened by this result — see §E.

---

## C. The chooser question, closed by construction — 2026-08-09

`B2` cannot be answered on a single-UPI-app handset and Andy is not running the session again.
Rather than leave `E06-29` waiting on a second device, the ambiguity was made irrelevant.

**Two things were done, and between them the question stops mattering:**

1. **`withUpiQueries` is now permanently enabled** in `apps/mobile` (`E06-29`). It is already
   written and verified, and `<queries>` entries are declarations rather than permissions —
   no runtime cost, no user-visible prompt, nothing to disclose in a store listing. Whatever
   the device would have shown, the app now declares the visibility itself.
2. **`scripts/verify-apk-upi-queries.mjs` asserts it in the built artefact** (`E06-32`),
   because a config plugin that silently stops applying looks exactly like one that works.

### What the artefact check found, and it is worth recording

Running the new verifier against the **`E19-01` spike APK itself** — the very build the
handset session used — gives:

```
UPI package visibility — spike.apk
  <queries> element        present
  android:scheme="upi"     present
  PSP packages declared    0/6
```

That is the expected shape for a build made before the plugin was switched on, and it settles
two things:

- **A3 is confirmed from a real merged manifest**, not inferred from an AAR. `standard-core`
  really does contribute `scheme="upi" host="pay"` to the app manifest.
- **Package visibility was therefore not the limiting factor in that session.** The build Andy
  tested could enumerate UPI apps. The single installed app is the entire explanation for what
  he saw, and `B3` was never going to return a usable answer — there was no defect for the
  plugin to repair.

The residual risk is now the *provenance* of that block rather than its presence: it came from
a dependency resolved at `LATEST`. `E19-08` pins it to `1.7.18` — the version that build used —
and `E06-32` fails if a future artefact loses either the scheme query or our six explicit
packages.

---

## D. What `E19-02` did not deliver, and what that costs

The spike is closed with the verdict **"performance acceptable"** and **no recorded figures**.
`docs/spike-runbook.md` §2.5 asked for cold-start `TotalTime` (median of five, first
discarded), `gfxinfo` frame percentiles for a 50-item scroll with and without the Skia layer,
and janky-frame counts across ten shared-element transitions. None of those numbers exist.

**This is recorded as a gap rather than papered over, because one task depends on it directly.**
`E14-07` (the cold-start budget) was parked on Andy's explicit ruling that its thresholds must
come from `E19-02` measured on a real handset. A subjective "acceptable" is good evidence that
the framework choice is not catastrophically wrong — which is what `E19-02` was *for*, and why
closing it is reasonable — but it cannot set a numeric threshold, and a threshold invented
without measurement is worse than none: it will either never fire or fire constantly.

**Consequences, stated plainly:**

- `E13-05`'s framework choice is **validated**. That was the decision-shaped half of `E19-02`
  and it is done. Reanimated and Skia on a mid-range Android are not a mistake.
- `M05` (the dish-card → dish-detail shared element) **survives**. `docs/open-questions.md`
  called it provisional pending this spike; nothing observed suggests deleting it.
- `E14-07` remains **blocked on numbers**, not on a decision. It needs one `adb` session, not a
  conversation. Anyone with the handset and ten minutes can close it; the commands are in the
  runbook and need no rebuild.

---

## E. The guard that does not relax

`B6` simplifies the happy path. It does not simplify the failure paths, and the temptation it
creates is worth naming before `E06` is written:

> Because capture is now known to be immediate, it becomes tempting to treat a successful
> Razorpay callback as sufficient to release an order to the kitchen.

**It is not, and nothing here changes that.** §3.6 is unchanged: a verified signature proves
the callback body was not tampered with, not that money moved. The server still fetches the
payment from Razorpay before settling, the webhook remains an independent second path, and no
order reaches a kitchen list on the strength of a client-reported success. What `B6` buys is
that the *server-confirmed* capture arrives promptly, so the waiting state is short — not that
the waiting state can be skipped.

---

## F. Not in this session

`E19-07`'s remaining §12 rows — the webhook event set, event-id header, retry policy and
timeout, collect-pending window, refund idempotency and listing, MDR in the capture payload,
the settlement recon endpoint, payments-list windowing — need a **public webhook endpoint** and
a Razorpay dashboard webhook subscription. That is a separate sitting; `create-order.mjs`
already exercises items 13 (duplicate `receipt`) and 14 (`notes` round-trip) as a by-product.

Checklist rows answered by this spike: **1, 2, 4, 9**. Row 3 (iOS `LSApplicationQueriesSchemes`)
is untouched — no iOS build has run a payment — and row 12 (UPI collect pending window) still
sets the floor for `[OL-03]`'s TTL and is unanswered.
