---
title: E19-01 / E19-02 spike runbook
status: PARKED 2026-08-08 — setup complete, waiting only on Andy's handset (expected 2026-08-09 morning)
---

> **Parked, pick-up-and-go.** Everything that can be done without an Android handset is done and
> merged. **§2 is the whole remaining job** and needs no preparation beyond plugging the phone
> in — the APK is built, `adb` is installed, and the two laptop-side scripts are tested.
> Budget roughly 30–40 minutes. Nothing else in Block 3 is blocked on this; the rest is closed.

# Spike runbook — `E19-01` (Razorpay + UPI) and `E19-02` (Android performance)

One app, `tools/spike-mobile/`, serving both spikes: one EAS build, one device session. It is
throwaway — nothing in it is meant to survive into `apps/mobile`. What survives is the answers.

**Everything that can be done without a handset has been done.** §1 records what that already
settled. §2 is the part only Andy can run.

---

## 1. Already answered, without a device

These came from static analysis of the SDK and its transitive dependencies, plus a local
`expo prebuild`. They are recorded here because two of them **change what the spike is for**.

### 1.1 The RN SDK does support the New Architecture — `[PAY-01]` survives

`react-native-razorpay@3.0.0` (published 2026-07-21) ships a `codegenConfig` block and an
`isNewArchitectureEnabled()` branch in its `build.gradle`. RN 0.86 is bridgeless by default,
so a legacy-only bridge module would have been an immediate problem for option (a) in
`docs/payments-design.md` §3.2. It is not one. **Checklist item 1's first half holds**; the
second half (EAS dev build, not Expo Go) was never in doubt.

### 1.2 The `<queries>` block is probably already supplied — this inverts checklist item 2

`docs/payments-design.md` §3.3 assumes the SDK does **not** supply the Android 11+ `<queries>`
block, making `E06-29` necessary work. The dependency chain says otherwise:

| Artefact | Ships `<queries>`? |
|---|---|
| `react-native-razorpay@3.0.0` (the RN wrapper) | **No** — its manifest declares only `CheckoutActivity` |
| → `com.razorpay:checkout:1.6.41` | No — a thin wrapper AAR with an empty manifest |
| → → `com.razorpay:standard-core` (transitive) | **Yes** — including `scheme="upi" host="pay"` and a broad `VIEW` intent |

Android's manifest merger pulls library `<queries>` into the app manifest, so **the UPI app
chooser may work with nothing added on our side.** The design's assumption was right about the
wrapper and wrong about the SDK underneath it.

**This is why the spike app ships with the `<queries>` plugin OFF.** Building with it on first
would have proved nothing — the chooser would work and we would never learn whether it was our
plugin or Razorpay's manifest doing it. The experiment is: build without, and see.

- Chooser **works** → `E06-29` becomes a *regression test* asserting the merged manifest still
  contains the block, not a fix. And that test matters more than it sounds — see §1.3.
- Chooser **missing** → `E06-29` is real work, and the plugin is already written and verified
  (`tools/spike-mobile/plugins/withUpiQueries.js`; a local prebuild confirms it merges into
  Expo's existing `<queries>` rather than replacing it, and emits both the `upi://pay` intent
  and six explicit PSP packages).

### 1.3 Razorpay's payment SDK is pulled in on a floating version — this is new, and it is a finding

`com.razorpay:checkout:1.6.41`'s POM declares its dependency on `standard-core` as:

```xml
<dependency>
  <groupId>com.razorpay</groupId>
  <artifactId>standard-core</artifactId>
  <version>LATEST</version>
</dependency>
```

`LATEST`, not a pinned version. `standard-core` was last published 2026-08-04 as 1.7.18.

**Two builds a week apart can therefore embed different payment SDK code, with no change on our
side and nothing in our lockfile to show it.** The `<queries>` block in §1.2 is part of what can
change that way. It also means a compromised or simply broken Razorpay publish reaches our app
on the next build without review.

This is not something the spike can fix, but it changes what we assert: **whatever `E06-29`
becomes, it must verify the merged manifest of the actual build artefact, not trust a
dependency version.** Worth a Gradle `resolutionStrategy` pin in `E06`, so at least *we* choose
when the payment SDK changes. Logged as `E19-08` / `E06-30`.

### 1.4 The wrapper asks for an artefact that has not existed since RN 0.71

`react-native-razorpay`'s `build.gradle` contains `implementation 'com.facebook.react:react-native:+'`.
On Maven Central that coordinate tops out at **0.71.0-rc.0**; current React Native publishes as
`com.facebook.react:react-android` (now 0.87.0-rc.4). We are on 0.86.2.

React Native's Gradle plugin normally rewrites this coordinate via a dependency substitution
rule, which is why libraries with this line still build — but it is the kind of thing that fails
loudly on a version bump.

> **Resolved, 2026-08-08.** The first EAS build got past dependency resolution and compiled the
> Razorpay module cleanly, with no `Could not find com.facebook.react` anywhere in the log. The
> substitution works on 0.86.2. **Recorded as a known oddity to recognise on sight, not a live
> problem** — but it stays written down, because the failure mode returns on an RN major bump
> and it is much cheaper to recognise than to debug.

### 1.5 Callback signature construction — verified in the abstract

`scripts/verify-signature.mjs` implements checklist item 9 exactly as the design states it
(`HMAC-SHA256(key_secret, "order_id|payment_id")`, hex) and has been tested against a known
vector in both the matching and non-matching direction. It cannot confirm Razorpay *produces*
that signature until a real payment happens — that is §2.4.

---

## 2. The handset session — what only Andy can do

### 2.0 What you need in hand

- A **mid-range Android, version 11 or newer** — not the cheapest tier, and not an emulator.
  Android 11 is the floor because package-visibility restrictions are the whole point of §1.2;
  on Android 10 the chooser works regardless and the result is meaningless.
- **At least two UPI apps installed and set up** (GPay, PhonePe, Paytm, BHIM). One is enough to
  test the flow, two is what proves it is a *chooser* and not a single hardcoded handoff.
- A **Razorpay test-mode key pair** from the dashboard (Settings → API Keys → test mode).
  `rzp_test_…` and its secret. The secret stays on the laptop.
- A USB cable and **USB debugging** enabled (Settings → About phone → tap Build number 7 times,
  then Developer options → USB debugging).

`adb` is already installed on this machine (`brew install --cask android-platform-tools`, done).

### 2.1 Get the build

> **APK (built, green, ready):**
> https://expo.dev/artifacts/eas/tb1HfSZCA2TRkhJ2y_yBeIjHP1xjJj79OhVi9S1RXGA.apk
>
> Build page: https://expo.dev/accounts/anuragdial/projects/graybag-spikes/builds/28127b5b-5872-451e-a135-31463149d454

Download it, or straight to the phone:

```bash
curl -L -o ~/Downloads/graybag-spike.apk \
  https://expo.dev/artifacts/eas/tb1HfSZCA2TRkhJ2y_yBeIjHP1xjJj79OhVi9S1RXGA.apk
adb install -r ~/Downloads/graybag-spike.apk
```

**The first attempt (`811e73ef`) failed, and it was my config, not the SDK.** `app.json` pinned
`compileSdkVersion: 35` via `expo-build-properties`, below the 36 that Expo SDK 57's own
dependency set requires, so it died at `:app:checkReleaseAarMetadata`. The pin is removed —
Expo 57's defaults are correct, and its targetSdk 36 is comfortably above the 30 at which
Android enforces the package-visibility rules this whole spike is about.

That failure was still worth its 13 minutes: `checkReleaseAarMetadata` runs *after* dependency
resolution and after every library compiles, so reaching it proved that **`react-native-razorpay`
builds clean against RN 0.86 under the New Architecture** and that **§1.4's stale
`react-native:+` coordinate resolves without complaint.** Those were the two risks most likely
to sink `[PAY-01]`. Neither is live.

To rebuild after any change:

```bash
cd tools/spike-mobile
eas build --platform android --profile spike
```

**Use the `spike` profile, not `development`.** `spike` is a release build. A dev-client build
runs unminified JS with dev-mode assertions on and Reanimated in its slow path — measuring
performance on one would produce numbers that are wrong in the pessimistic direction, and we
would tune against a phantom.

Install it:

```bash
adb devices                      # confirm the handset shows as "device", not "unauthorized"
adb install -r ~/Downloads/*.apk
```

### 2.2 `E19-01` — does native UPI intent work?

1. On the laptop, create a test order (₹1):

   ```bash
   cd tools/spike-mobile
   export RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
   export RAZORPAY_KEY_SECRET=xxxxxxxx
   node scripts/create-order.mjs --amount 100 --receipt SPIKE-1
   ```

   It refuses to run with a live key. It prints the key id, order id and amount to type into
   the app, and echoes the `notes` object back (checklist item 14).

2. Open the app → **E19-01**, paste the three values, tap **Pay**.

3. **Watch what the sheet offers.** This is the whole spike:

   - [ ] Is there a **UPI section listing your installed apps** by name and icon?
   - [ ] Or does it only offer **"enter your UPI ID" (collect)** and/or a **QR code**?

   The second is the silent-degradation failure in §3.3 — a payment flow that works, slowly
   and badly, on every device. It does not error, so it will not announce itself.

4. Pay in the PSP app, then come back. The on-screen log records the wall-clock from tapping
   Pay to the callback firing — **write that number down**, it sets the waiting-state design
   under `S5`.

5. In the Razorpay dashboard, find the payment. **Is it `captured` or `authorized`?**
   Checklist item 4: if UPI intent only ever authorizes, `authorized` becomes a live state and
   `L5` (never cook against an authorization) starts costing real orders.

6. Run it again and **background the app while the PSP app is open** — swipe away, open three
   other apps, come back. Does the spike app survive, or is it killed? §3.4 says this is the
   normal UPI path with bad luck attached; the answer sets how often the recovery path runs.

### 2.3 If there is no UPI app chooser

Enable the plugin and rebuild — that turns §1.2's experiment into its answer:

```bash
# in tools/spike-mobile/app.json, add to the "plugins" array:
#   "./plugins/withUpiQueries"
eas build --platform android --profile spike
```

If the chooser then appears, `E06-29` is required work. If it still does not, the problem is
not package visibility and the finding is bigger than the plugin.

### 2.4 Confirm the callback signature

From the app's success log, take all three values:

```bash
node scripts/verify-signature.mjs \
  --order order_xxx --payment pay_xxx --signature <the hex from the app>
```

`MATCH` confirms checklist item 9 and means `POST /checkout/:group/verify` can be built as
specified. `NO MATCH` means every legitimate payment would be rejected, and §5 needs rework
before `E06` starts.

### 2.5 `E19-02` — performance

All three numbers come from `adb`, not from the on-screen counter. The in-app FPS readout
samples on the JS thread and cannot see UI-thread jank, which on Android is most of it. It is a
smoke alarm, not the measurement.

**Cold start** — kill the app first, or you are measuring a warm start:

```bash
# if the component name is wrong, this prints the right one:
adb shell cmd package resolve-activity --brief in.graybag.spikes | tail -1

adb shell am force-stop in.graybag.spikes
adb shell am start -W -n in.graybag.spikes/.MainActivity
```

Read **`TotalTime`** (launcher tap → first frame). Do it five times, discard the first, take the
median. Compare with the JS number on the app's home screen: if `TotalTime` is 1800 ms and the
JS number is 90 ms, the cost is native and bundle load, and trimming JS will not help.

**50-item list scroll with images** — the real menu shape, using `expo-image` because that is
what `E14` ships:

```bash
adb shell dumpsys gfxinfo in.graybag.spikes reset
# now scroll the list hard for ~20 seconds, top to bottom, several times
adb shell dumpsys gfxinfo in.graybag.spikes | head -30
```

Record **Total frames**, **Janky frames** (and its percentage), and the **50th / 90th / 95th /
99th percentile** frame times. Under 5% janky is good; over 20% means `E14-07`'s thresholds need
to be set against reality rather than aspiration.

Then do it again with the **Skia layer ON** (the toggle at the top). `E13-05`'s framework choice
assumes Skia can be on screen during a scroll without costing frames. Two `gfxinfo` runs answer
that.

**Shared-element transition** — tap a row: its thumbnail expands into a full-bleed hero, driven
on the UI thread by Reanimated. The elapsed time shows at the top. Run `gfxinfo` around ten
open/close cycles and record the janky-frame count separately from the scroll number — a
transition that drops frames is far more visible than a list that does.

**While you have the handset:** note whether images visibly pop in, and roughly how long the
list takes to fill on the school's connection rather than home wifi. The audience is mid-range
Androids on unreliable networks, and that is the constraint the whole performance plan is
written against.

---

## 3. Recording the answers

Fill in `docs/spike-results.md` (stubbed with every question above). Anything that contradicts
`docs/payments-design.md` gets changed **in that document, in the same PR** — never left to
diverge. `E19-06` is the write-up task; `E19-07` is the remaining §12 checklist, most of which
needs a webhook endpoint and is not part of this session.
