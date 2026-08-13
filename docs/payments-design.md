---
title: Payments design — Razorpay integration
status: specification — this is what E06 is built from, together with docs/order-lifecycle.md
sources: docs/order-lifecycle.md, docs/data-model.md §8, supabase/migrations/0001_initial_schema.sql, docs/decisions.md
---

# Payments design — Razorpay integration

`docs/order-lifecycle.md` specifies **when** money is allowed to move and what the order does
when it does. This document specifies **how** it moves: which Razorpay APIs are called, what
the client is allowed to do, how a webhook is proved genuine, what makes every path safe to run
twice, how the books are checked against the provider every day, and how a refund is computed
and issued.

The two documents are deliberately split at the provider boundary. If a statement is about
`order.status`, it belongs in the lifecycle document; if it is about an HTTP call to
`api.razorpay.com`, a header, a signature, an amount in paise crossing the wire, or a ledger
posting, it belongs here.

**This document is normative for `E06-02`, `E06-03`, `E06-04`, `E06-07`, `E06-08`, `E06-09`,
`E06-11`, `E06-12`, `E06-14`, `E06-17`, `E06-22`…`E06-29`, `E07-11` and `E15-05`.** If the
implementation needs to diverge from it, change this file in the same PR.

**Nothing here may be built before `E19-01` returns.** Sixteen statements below are marked
**[verify in E19-01]** at the point they are made. They are behaviours of Razorpay's SDK, API
and webhooks that this design depends on and that cannot be checked without a live account and
a real Android handset. §12 collects them, with four more that follow from the design rather
than from a single sentence, into a twenty-item checklist saying what breaks if each answer
comes back differently. **They are load-bearing. Do not treat them as facts.**

---

## 1. Scope

**In scope.** Keys and environments; the in-app checkout and native UPI intent; the server's
provider-facing API surface; signature verification; the webhook endpoint; the complete
idempotency strategy; the reconciliation job; refunds, full and per-line; the ledger postings
that each of these produces.

**Out of scope, and where it lives instead.**

| Thing | Where |
|---|---|
| Order states and legal transitions | `docs/order-lifecycle.md` §4 |
| The checkout transaction's guards (cutoff, price, availability, authorization) | `docs/order-lifecycle.md` §8.2 |
| Failure paths as *order* outcomes (app kill, sweeper, late capture, duplicate) | `docs/order-lifecycle.md` §10 |
| Invoice content, GST split, gapless numbering | `docs/data-model.md` §8.6, `E07` |
| Wallet as a *payment method* at checkout | `E06-10`, blocked on the RBI PPI question |
| Payouts to schools and kitchens | `E07-09`…`E07-12` |
| Subscriptions | `E18` |

---

## 2. Accounts, keys and environments

### 2.1 There are three secrets, not one, and they verify three different things

This is the single most common way to get a Razorpay integration wrong, because two of the
three are the same shape (a random string) and the third looks like a username.

| Secret | Shape | Where it may appear | What it is for |
|---|---|---|---|
| **Key id** | `rzp_test_…` / `rzp_live_…` | Server **and client** — it is public by design | Identifies the account. Handed to the checkout SDK |
| **Key secret** | opaque string | **Server only** | HTTP Basic auth to `api.razorpay.com`, and the HMAC key for the **checkout callback** signature |
| **Webhook secret** | opaque string, chosen by us when the webhook endpoint is registered | **Server only** | The HMAC key for the **webhook** signature. Per endpoint, therefore per environment |

The key secret and the webhook secret are **different values and must never be set to the same
string**, however convenient that would be. They authenticate opposite directions of travel:
the key secret proves *we* are us when we call Razorpay; the webhook secret proves *Razorpay*
is Razorpay when it calls us. Making them equal means a leak of either is a leak of both.

`E00-01` rotated the live key id/secret pair found in cleartext in the `.bubble` export
(`docs/learnings.md`, 2026-08-06). The webhook secret is new — the legacy app had a public
`payment_processed` endpoint with no visible verification at all, which is the defect this
entire section exists to remove.

### 2.2 Environment isolation

`A7` gives staging and production. Razorpay gives **test mode** and **live mode** on one
account, each with its own key pair and its own webhook endpoints.

| Environment | Razorpay mode | Webhook URL |
|---|---|---|
| Local | test | not registered — webhooks are replayed from fixtures (`E06-13`) |
| PR preview | test | not registered — same |
| Staging | **test** | `https://<staging-project>.supabase.co/functions/v1/razorpay-webhook` |
| Production | **live** | `https://<prod-project>.supabase.co/functions/v1/razorpay-webhook` |

`E06-14` is the assertion that staging can never reach live keys. It has two halves, and both
are needed:

1. **Startup assertion.** Every payments Edge Function refuses to start if
   `RAZORPAY_KEY_ID` does not carry the prefix its `APP_ENV` requires — `rzp_test_` outside
   production, `rzp_live_` in production. A mismatch is a hard failure at boot, not a warning,
   because the alternative is real money moving against staging data.
2. **Build assertion.** `E01-18` already asserts no `service_role` key or Razorpay **secret**
   reaches a client bundle. Extend it: the *key id* legitimately ships in the mobile bundle, so
   the check is that the bundle contains no `rzp_live_` id in a non-production build and no key
   *secret* or webhook secret in any build.

Cross-environment traffic still happens — someone registers the wrong URL, or a staging webhook
is left pointing at production. `docs/order-lifecycle.md` §10.9 is the handler for it: record
`processing_status = 'ignored'`, return `200`, alert. §8.2 break class **B2** below is how the
daily job notices it if the alert is missed.

### 2.3 Where each secret lives

Supabase Edge Function secrets, per project, set through the CLI and never hand-edited
(`E01-07`). Nothing payments-related reads from a `.env` committed anywhere. The names:

```
RAZORPAY_KEY_ID          # not secret, but environment-scoped
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
RAZORPAY_WEBHOOK_SECRET_PREVIOUS   # present only during a rotation window (§2.4)
```

### 2.4 Rotation

`E00-17` drafts the policy; this is the payments-specific mechanic, and it is not obvious.

A Razorpay webhook secret belongs to the **endpoint**, so it cannot be changed atomically with
respect to events already in flight. Rotating it naively means every event signed with the old
secret between "we changed it in Razorpay" and "we changed it in Supabase" fails verification,
gets recorded and never acted on, and — because §6.3 returns `200` to everything — is never
retried by Razorpay either. That is a silent hole in the settlement path.

The rotation is therefore **dual-secret**: the verifier tries `RAZORPAY_WEBHOOK_SECRET` and,
if that fails and `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` is set, tries that too, recording which
one matched. Rotation is: set `_PREVIOUS` to the current value → change the secret in the
Razorpay dashboard → set the new value → wait one retry window (24h [verify in E19-01]) →
unset `_PREVIOUS`. `E06-26`.

The key secret has no such problem — it is used on calls we initiate, so it can be swapped
between requests.

---

## 3. The client — in-app checkout and native UPI intent

### 3.1 What is being replaced

The legacy app redirected to a **hosted Razorpay payment link** in a browser. That is the
"clunky" experience `E06-02` exists to fix, and it fails in three ways beyond feel: the user
leaves the app (so the return path is a deep link that may not fire), UPI intent app-switch
from a mobile browser is unreliable, and the app learns the outcome only from whatever the
redirect carries.

### 3.2 Integration choice — `[PAY-01]`

Three ways to run Razorpay Standard Checkout inside a React Native app:

- **(a) The official React Native SDK** (`react-native-razorpay`) — a thin native module
  wrapping Razorpay's Android and iOS Checkout SDKs. UPI intent app-switch, saved cards, the
  UPI app chooser and the "waiting for your UPI app" state are all handled natively.
- **(b) Standard Checkout in a WebView** — the web checkout script inside `react-native-webview`.
  No native module, so it works in Expo Go. UPI intent from inside a WebView is the weakest
  link: launching `upi://` from a WebView requires intercepting the navigation and firing the
  intent ourselves, and the return to the WebView is not guaranteed.
- **(c) A bespoke flow on Razorpay's S2S/custom checkout APIs** — full control of the UI,
  and it puts us much closer to card data and therefore to PCI scope (§11.1).

**Recommended: (a).** It is the only option that gets native UPI intent for free, which is the
entire point of `E06-02`, and it keeps card entry inside Razorpay's SDK so §11.1 stays true.

**Its cost, which must be accepted explicitly:** it is a native module, so **the app can no
longer run in Expo Go** — every developer and every E2E run needs an EAS development build.
That is already the plan (`A1`, EAS Build), but note that `E19-01` says "a bare Expo app", and
a bare *managed* Expo app cannot host this SDK. The spike must be run on a development build,
or it will prove the wrong thing. Recorded as `[PAY-01]` because the decision also decides §3.4
and part of `E14`.

> **`[PAY-01]` RESOLVED — (a), the official RN SDK. 2026-08-09, `E19-01`.**
>
> Not "recommended" any more; demonstrated. The SDK compiles against RN 0.86 under the New
> Architecture, an EAS release build ships it, and **a real test-mode UPI payment on a real
> Android handset captured and its callback signature verified** (`docs/spike-results.md`
> B6, B7). The two risks that would have forced a flip to (b) — a legacy-only bridge module,
> and the stale `com.facebook.react:react-native:+` coordinate — were both ruled out by the
> compiler rather than by reading metadata (A8, A9).
>
> Options (b) and (c) are closed. Nothing below in §3.3–§3.5 is contingent any more.

### 3.3 How native UPI intent actually works

Worth writing down, because "UPI" is three different flows with very different failure
behaviour and only one of them is what `E06-02` asks for.

| Flow | Mechanism | Where the user completes it | Failure mode |
|---|---|---|---|
| **Intent** (what we want) | Checkout builds a `upi://pay?…` intent URI and hands it to a chosen installed PSP app | Inside GPay / PhonePe / Paytm / BHIM, then back | The app-switch backgrounds our app — see §3.5 |
| **Collect** | A pull request sent to a VPA the user types | In whichever app owns that VPA, possibly minutes later | Sits `pending` for a long time; this is what makes `[OL-03]` hard |
| **QR** | An on-screen QR scanned by another device | Elsewhere entirely | Same as collect |

Intent requires that checkout can **see** which UPI apps are installed. On Android 11 and
later, package visibility is restricted: an app cannot enumerate other packages unless it
declares them in a `<queries>` element in `AndroidManifest.xml`.

**This is the failure that must not be discovered in production.** With no `<queries>` block,
the intent app list comes back empty, checkout degrades to collect/QR without erroring, and the
result is a payment flow that works — slowly and badly — on every device, which is exactly the
complaint `E06-02` exists to fix. It will not reproduce on a developer's Android 10 emulator or
on iOS.

In an Expo project the manifest is generated, so this needs an **Expo config plugin** adding
either the `<queries><intent><action android:name="android.intent.action.VIEW"/><data
android:scheme="upi"/></intent></queries>` form or the explicit package list the Razorpay SDK
documents. `E06-29`.

> **RESOLVED 2026-08-09 — and the resolution is all three of those things, not one.**
>
> The paragraph above is right about the RN wrapper and wrong about the SDK beneath it.
> `react-native-razorpay@3.0.0`'s manifest declares only `CheckoutActivity` and no `<queries>`
> — but `com.razorpay:standard-core`, pulled in transitively, **does** declare a `<queries>`
> block containing `scheme="upi" host="pay"`, and Android's manifest merger pulls it into the
> app. That is now confirmed from a **built artefact's merged manifest**, not from the AAR:
> `scripts/verify-apk-upi-queries.mjs` decodes it out of the `E19-01` spike APK.
>
> **The device could not adjudicate it, and will not.** The handset had a single UPI app
> installed, so Android went straight into it instead of showing a list — consistent with a
> working chooser and with a broken one alike. Since that build's manifest *did* carry the
> scheme query, there was in fact no defect for the plugin to repair, and the experiment could
> never have returned a usable answer.
>
> So `E06-29` was resolved by construction rather than by measurement, and it is now three
> things rather than a choice between them:
>
> 1. **`E06-29`** — `apps/mobile/plugins/withUpiQueries.js`, **permanently enabled**. We
>    declare the visibility ourselves and stop depending on anyone else for it.
> 2. **`E06-32`** — assert the `<queries>` block in the **built APK**, because a config plugin
>    that silently stops applying is indistinguishable from one that works.
> 3. **`E19-08`** — pin `com.razorpay:standard-core` (to `1.7.18`), so the upstream half of
>    the block cannot change under us between builds.
>
> The residual risk was never "is the block there" but "who put it there, and can they take it
> away". See `docs/spike-runbook.md` §1.2–1.3 and `docs/spike-results.md` §C.

On iOS, intent is app-switch by URL scheme, which needs the PSP schemes in
`LSApplicationQueriesSchemes`. iOS UPI usage in this audience is a small fraction of Android's;
the flow must work, but it is not where the effort goes. **Still unverified** — `E19-01` ran on
Android only, and no iOS build has put a payment through. It lands with `E06-02`, which is when
the SDK is added to `apps/mobile` and the iOS half of `E06-29` can be written and tested
together.

### 3.4 What the client is given, and what it must persist

The checkout Edge Function returns:

```
{ order_group_id, order_ref, correlation_id,
  razorpay: { key_id, order_id, amount_paise, currency, prefill: { contact, email }, notes } }
```

**The app must persist `order_group_id` to local storage before it opens the Razorpay sheet.**
`docs/order-lifecycle.md` §10.3 depends on it: an app killed after the sheet opens recovers by
calling `GET /checkout/:group/status` for every locally known non-terminal group, and it can
only do that if it wrote the id down first. An app killed between the HTTP response and the
write is recoverable only by the §10.4 sweeper.

This is not a rare path. **A UPI intent payment app-switches away from our process by
construction**, and on a mid-range Android under memory pressure the OS may not bring it back.
On this product, "app killed mid-payment" is the *normal* UPI path with bad luck attached, not
an exotic edge case — which is what makes `E06-16` (`GET /checkout/:group/status`) a launch
blocker rather than a nicety.

### 3.5 The return path

Razorpay's success handler yields `razorpay_payment_id`, `razorpay_order_id` and
`razorpay_signature`. The app posts all three to `POST /checkout/:group/verify`.

The failure handler yields a code and description. The app posts them to the same endpoint so
they land in `payment.failure_code` / `failure_description` — **but the server treats a
client-reported failure as a hint, never as a fact.** It records it and then asks Razorpay.
A client can be lied to, be out of date, or simply be wrong about a payment that succeeded
after the sheet closed.

The app must show a **waiting state**, not a success screen, until the server confirms
settlement — `payment_pending` (202) in `docs/order-lifecycle.md` §13. `S5` applies: skeleton
the confirmation screen, never spin.

### 3.6 The client is never a source of truth about money

`E06-03`. Stated once, applied everywhere:

- A verified `razorpay_signature` proves **the callback body was not tampered with**. It does
  **not** prove the payment captured. The server therefore fetches the payment from Razorpay's
  API before settling (`docs/order-lifecycle.md` §8.4a).
- No endpoint accepts an amount, a status or a payment id as authoritative input from the app.
  The amount comes from `order_group.payable_paise`, which the server computed.
- The webhook is an independent second path (§6) precisely so that the app's cooperation is
  optional.

### 3.7 What crosses to Razorpay — a hard rule

Non-negotiable #4 (children's data is regulated under the DPDP Act) applies to payment
processors as much as to Sentry.

**Permitted** in a Razorpay order or payment: `order_group.id`, `correlation_id`, `order_ref`,
the amount, and `prefill` for the **paying adult's** phone and email (they are the payer;
Razorpay needs a way to reach them about their own transaction).

**Forbidden, without exception**: a recipient's name, class, section, school, allergens, or any
dish name that could identify a school menu. `notes` carries identifiers, never descriptions.
The same rule applies in reverse to what we store from Razorpay: `payment.notes` and
`payment_webhook_event.payload` are **redacted copies**, never the raw body (§6.5).

`E06-25` is the test that asserts it: a fixture order for a recipient named with a distinctive
sentinel string, and an assertion that the sentinel appears in no outbound Razorpay request
body and in no stored payload. It must be a test, because this is the kind of rule a
well-meaning "let's add the child's name so support can find it" PR breaks in one line.

The disclosure that a payment processor receives the payer's contact details belongs in the
privacy policy (`E20-03`).

---

## 4. The server-side surface

Every one of these is an Edge Function, class 3 under `[AZ-01]` — `service_role`, no RLS write
policy exists for `authenticated` on any money table.

| Our endpoint | Called by | Razorpay API it calls | Lifecycle reference |
|---|---|---|---|
| `POST /checkout` | app | *(none — the DB transaction only)* | §8.2 |
| `POST /checkout/:group/pay` | app | `POST /v1/orders` | §8.3 |
| `POST /checkout/:group/verify` | app | `GET /v1/payments/:id` | §8.4a |
| `GET /checkout/:group/status` | app | `GET /v1/orders/:id/payments` | §10.3, `E06-16` |
| `POST /razorpay-webhook` | Razorpay | *(none)* | §8.4b, §6 here |
| `POST /refunds` | admin/kitchen web | `POST /v1/payments/:id/refund` | §7, §9 here |
| *(job)* sweeper | schedule | `GET /v1/orders/:id/payments` | §10.4 |
| *(job)* in-flight reconciler | schedule | `GET /v1/payments/:id`, `GET /v1/refunds/:id` | `E06-17` |
| *(job)* daily reconciliation | schedule | `GET /v1/payments`, settlement recon report | §8 here, `E06-11` |

`POST /checkout` and `POST /checkout/:group/pay` are split deliberately, and the split is `L4`:
the database transaction commits, *then* the provider order is created. A retry of `pay`
against an already-created attempt is safe (§7.4).

### 4.1 Creating the provider order

```
POST https://api.razorpay.com/v1/orders
Authorization: Basic base64(key_id:key_secret)

{ "amount":   <order_group.payable_paise>,     // paise. Non-negotiable #3 agrees with Razorpay
  "currency": "INR",
  "receipt":  "<order_group.id>",
  "notes":    { "order_group_id": "…", "correlation_id": "…", "order_ref": "GB-…" } }
```

Then insert `payment` at `created`, with `provider_order_id` from the response and
`attempt_no = (max for this group) + 1`.

Four notes:

1. **Amounts are paise on both sides.** Razorpay's `amount` is the smallest currency unit, so
   `payable_paise` goes across unchanged. There is no conversion, and therefore no place for a
   float to appear.
2. **`receipt` is our `order_group.id`**, which makes a Razorpay-side duplicate detectable.
   Whether Razorpay *rejects* a duplicate receipt depends on an account setting
   **[verify in E19-01]**; the design does not rely on it (§7.4).
3. **`notes` has a size limit** — a small number of key/value pairs, values bounded
   **[verify in E19-01]**. Three keys is well inside any plausible limit.
4. **Auto-capture** is `[OL-01]`, recommended auto. Whether it is set per order
   (`payment_capture`) or once at account level, and whether it behaves identically for UPI
   intent, is **[verify in E19-01]**.

**If the call fails**, the group sits at `pending_payment` with no `payment` row and the
customer retries (`docs/order-lifecycle.md` §10.10). **If the call succeeds and our insert then
fails**, we have an orphan Razorpay order. That is acceptable, and the reason is worth stating
because it is what makes `L4`'s ordering safe: **the client only ever learns a
`razorpay_order_id` from a response we successfully returned**, so an orphan created by a call
whose response we never returned is unpayable. It costs nothing, it settles nothing, and break
class **B1** (§8.2) would surface it if the reasoning is ever wrong.

### 4.2 `POST /checkout/:group/verify`

1. Verify the callback signature (§5.3). A mismatch is a `400` and an `E15-05` alert — unlike a
   webhook, this one *is* a client, and a client sending a bad signature is either a bug or an
   attempt.
2. **Fetch the payment from Razorpay** (`GET /v1/payments/:id`). This is the authoritative read.
3. Assert the fetched payment's `order_id` matches the group's `provider_order_id` and its
   `amount` matches `payable_paise`. A mismatch is a hard alert and settles nothing.
4. Call `settle_payment()` (`docs/order-lifecycle.md` §8.4), under the group advisory lock.

### 4.3 `GET /checkout/:group/status`

`E06-16`. **Reconciles rather than reports.** It fetches the provider order's payments and
settles if any of them captured, then returns the group's state. Reporting our own row would
defeat the purpose: the case it exists for is precisely the one where our row is stale because
neither the callback nor the webhook reached us.

Rate-limited per user, since the app calls it on every launch for every non-terminal group.

---

## 5. Signature verification

`E06-03`, risk critical. Two signatures, two keys, two algorithms that differ only in what is
hashed — which is exactly why they get confused.

### 5.1 The two signatures

| | Checkout callback | Webhook |
|---|---|---|
| Arrives as | `razorpay_signature` in the SDK's success payload | `X-Razorpay-Signature` HTTP header |
| HMAC key | **key secret** | **webhook secret** |
| Message | `razorpay_order_id + "|" + razorpay_payment_id` | the **raw request body**, byte for byte |
| Digest | HMAC-SHA256, lowercase hex | HMAC-SHA256, lowercase hex |
| On mismatch | `400`, alert (§4.2) | record, **`200`**, alert (§6.3) |

**[verify in E19-01]** — the exact header name, the digest encoding, and the concatenation
order for the callback. All three are stable and documented, but every one of them is a silent
total failure if wrong, so they get confirmed against a real event rather than against memory.

### 5.2 The raw-body rule

The webhook HMAC is over the **bytes Razorpay sent**. In a Deno Edge Function that means:

```ts
const raw = await req.text();                 // FIRST. Not req.json().
const expected = await hmacSha256Hex(webhookSecret, raw);
if (!timingSafeEqual(expected, req.headers.get("x-razorpay-signature") ?? "")) { … }
const event = JSON.parse(raw);                // only after verifying
```

Parsing to JSON and re-serialising produces a different byte string — key order, whitespace,
unicode escaping and number formatting all change — and the HMAC will never match. The failure
is total and uniform, which is what makes it dangerous: it looks like an attack, not like a bug
(§5.5).

`JSON.parse` runs **after** verification, so an unverified body is never interpreted.

### 5.3 The callback signature

```
expected = hmac_sha256(key_secret, `${razorpay_order_id}|${razorpay_payment_id}`)
```

Note it is keyed on the **key secret**, not the webhook secret, and that the payload is a
constructed string rather than the request body. Using the wrong secret here fails every
verification; using the wrong secret on the webhook fails every verification there. They are
independent, and both must be tested against a real event.

### 5.4 Comparison

Constant-time, always — a byte-by-byte early-exit compare leaks the correct prefix to a
patient attacker. `crypto.subtle` produces the digest; the comparison is a fixed-length XOR
accumulate over the two hex strings, or `crypto.timingSafeEqual` where the runtime offers it.
Compare lowercase hex to lowercase hex; do not normalise by parsing.

### 5.5 Nothing is stored

`D12`. The signature is verified and **discarded**. There is no signature column on `payment`,
by design — the legacy `Temp` table held Razorpay signatures in an unbounded, world-readable
table, and nothing downstream needs them. `payment_webhook_event` records the **verdict**
(`signature_verified boolean not null`) and never the signature.

### 5.6 A misconfigured secret is indistinguishable from an attack

This is the non-obvious consequence of §6.3's "record, `200`, never act" rule, and it needs its
own alert.

If `RAZORPAY_WEBHOOK_SECRET` is wrong — a bad deploy, a rotation half-done (§2.4), a staging
value in production — then **every** webhook fails verification. Each one is recorded with
`signature_verified = false`, acted on by nothing, and answered `200`, so Razorpay stops
retrying. No 5xx appears anywhere. Sentry is quiet. Settlement still happens for customers who
stay in the app long enough for the callback path, so the symptom is not "payments broke", it
is "*some* payments are late", drifting worse as UPI intent app-switches take their share.

`E15-05` must therefore distinguish two different alerts off the same column:

| Signal | Reading | Severity |
|---|---|---|
| A handful of `signature_verified = false` against a background of successes | Probing or a misdirected sender | Warn |
| **Signature failure rate ≈ 100% since a deploy, or zero verified events in a window in which orders were placed** | **Our configuration is broken** | **Page** |

The second is `E06-28`. The "zero verified events while orders exist" half matters as much as
the rate: it also catches a webhook that was never registered at all, which produces no rows to
compute a rate from.

---

## 6. The webhook endpoint

### 6.1 One endpoint, one job

A single `POST /razorpay-webhook` handles every event type. Its **only guaranteed job is to
record the event durably.** Acting on it is attempted inline and guaranteed by the retry job.

The alternative — process fully inline and return a status reflecting the outcome — makes our
settlement latency Razorpay's retry problem, and makes a slow ledger write look to them like a
failed delivery.

### 6.2 The handler

```
1  raw = await req.text()
2  verify HMAC (§5.2). On mismatch: insert with signature_verified = false,
                                    processing_status = 'ignored', alert, return 200.
3  event = JSON.parse(raw)
4  insert into payment_webhook_event
       (provider, provider_event_id, event_type, signature_verified = true,
        payload = redact(event), correlation_id)
   ON CONFLICT (provider, provider_event_id) DO NOTHING
   -- no row inserted => already seen => return 200 immediately. (D16)
5  resolve the payment / refund from the event's provider ids.
   Not found => processing_status = 'ignored', alert (§10.9), return 200.
6  pg_advisory_xact_lock(hashtext(order_group_id::text))
7  apply the §6.2 monotonicity rule (docs/order-lifecycle.md) and dispatch by event type
8  processing_status = 'processed', processed_at = now()
9  return 200
```

Steps 6–8 run in one transaction. If it throws, the row stays `pending`, `attempt_count` is
incremented, `error_text` is set — **and step 9 still returns `200`**. The
`ix_payment_webhook_event_retry` partial index exists for exactly the sweep that picks it up
(`docs/order-lifecycle.md` §11).

The `X-Razorpay-Event-Id` header is `provider_event_id` **[verify in E19-01]**. If it is ever
absent, fall back to a deterministic hash of `(event_type, payload.payload…entity.id,
payload.created_at)` — but the fallback must be *deterministic*, or the idempotency guarantee
in step 4 evaporates.

### 6.3 Response codes — always `200`

| Case | Response | Why |
|---|---|---|
| Processed | `200` | |
| Already seen | `200` | Idempotent replay is success, not conflict |
| Bad signature | **`200`** | A `4xx` makes Razorpay retry a request we will never accept. Record and alert instead (§10.8) |
| Unknown event type | `200` | Recorded `ignored`. An unknown type must never 500 — Razorpay retries for ever and the storm buries the real events |
| Unknown order/payment | `200` | §10.9. Almost always the other environment's account |
| Our processing threw | `200` | The row is `pending`; **we** own the retry (§6.6) |

The single exception: if the *insert itself* fails — the database is down, so the event is not
recorded anywhere — return `500` and let Razorpay retry, because that is the one case where
their retry is the only copy of the event.

### 6.4 Subscribed events

Configured per environment in the Razorpay dashboard. Effects are in
`docs/order-lifecycle.md` §6.3; this is the subscription list.

`payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.created`,
`refund.processed`, `refund.failed`, `refund.speed_changed`.

Deliberately **not** subscribed in v1: `settlement.processed` (the daily job pulls the recon
report instead, §8.4) and the `payment.dispute.*` family. Disputes/chargebacks have **no
handling in v1** — a chargeback on a ₹200 lunch is rare, and a half-built dispute flow is worse
than none. It is a gap, not an oversight: `E18-24`, and until it exists a dispute is an email
from Razorpay that a human handles in the dashboard, followed by break class **B6** (§8.2)
showing up in the next day's reconciliation.

Subscribing to a *superset* is safe by construction, since unknown types are recorded and
ignored. **[verify in E19-01]** — the exact event names and whether `order.paid` fires for
every capture.

### 6.5 Redaction and retention

`payment_webhook_event.payload` is a **redacted** copy. Stripped before storage:

- `card.*` beyond `last4` and `network`
- `vpa` (a UPI VPA is a personal identifier and we have no use for it)
- `email` / `contact` — we already hold the payer's, from our own records
- any `notes` value that is not one of our three known keys
- anything under a key matching `/token|secret|signature/i`

Retention is the same as `payment`: kept for the statutory invoice period (`DM-15`, `E20-05`),
because it is the evidence of what the provider told us. The redaction is what makes that
retention acceptable.

### 6.6 We own the retry after the first `200`

Stated explicitly because it is a real transfer of responsibility: the moment the endpoint
answers `200`, Razorpay is done. Every subsequent attempt is ours, driven by the 5-minute sweep
over `processing_status in ('pending','failed')`. If that job is not running, events are
recorded and never applied, and the only thing that notices is the daily reconciliation.

The sweep therefore needs a **job-liveness alert of its own** — one that fires when the cron has
not *run* within its expected interval, distinct from both an error alert (the job ran and
threw) and an uptime alert (`E15-03` — the site or API is unreachable). A cron that silently
stopped produces neither a 5xx nor a failed HTTP probe: it produces **silence**, so uptime
monitoring cannot see it. `E15-03` is the wrong control here and is explicitly not it.

This is not specific to the webhook sweep. **All six scheduled jobs in
`docs/order-lifecycle.md` §11 need the same guarantee** — a job that records a heartbeat on each
run and an alert that pages when a heartbeat is overdue for its cadence (5-min sweeps within
minutes, the daily jobs within hours). `E15-06`'s daily digest carries each job's *last
outcome* but not its *liveness*, so a job that stopped emitting anything at all is exactly what
it misses. `E15-13` is the dedicated job-liveness monitor covering the webhook retry sweep, the
abandoned-checkout sweeper, the in-flight payment and refund reconcilers, the daily
reconciliation, and the idempotency-key purge.

---

## 7. Idempotency

`D16` — **idempotency is enforced by database constraints, not application logic.** Logic gets
refactored; constraints do not. This section is the complete inventory, because "the same event
must never double-credit" (`E06-04`) is a property of the *set*, not of any one of them.

### 7.1 The layers

| # | Layer | Mechanism | Protects against |
|---|---|---|---|
| 1 | Client checkout | `uq_order_group_idempotency (customer_user_id, idempotency_key)` + the `idempotency_key` table's stored response | Two devices, or a double-tap, submitting one cart (`E05-12`) |
| 2 | Provider order | `payment_provider_order_unique (provider, provider_order_id)` | Two `payment` rows for one Razorpay order |
| 3 | Provider payment | `uq_payment_provider_payment_id (provider, provider_payment_id) where not null` | The callback and the webhook each inserting an attempt |
| 4 | **Webhook event** | `payment_webhook_event_unique (provider, provider_event_id)` | Razorpay's retries. **The load-bearing one for `E06-04`** |
| 5 | One capture per checkout | `uq_payment_one_capture_per_group` | Two payments settling one cart — and see `[OL-05]`, §7.5 |
| 6 | Ledger | `ledger_transaction_source_unique (source_type, source_id, reason_code)` | The same movement posted twice |
| 7 | Invoice | `uq_invoice_one_tax_invoice_per_group` | A second settlement burning a second invoice number (`M3`) |
| 8 | Pickup code | `uq_order_pickup_code` | A re-run allocating a second code |
| 9 | Refund | `uq_refund_provider_refund_id where not null` | One provider refund recorded twice |

Layers 5–8 are what make `settle_payment()` idempotent **without a flag**: run it twice and the
second run's every write is refused by a different constraint. That is the property to test —
`E06-13` scenario 7 asserts one settlement from two deliveries, and it should assert it by
replaying the *whole function*, not by checking a boolean.

### 7.2 The client key

`POST /checkout` takes an `Idempotency-Key` header. Inside the transaction, insert into
`idempotency_key` with `scope = 'checkout'` and `request_hash` over the canonicalised body.

- Unique violation, **same** hash → replay: return the stored `response_body` verbatim.
- Unique violation, **different** hash → `409 idempotency_key_reused`. A repeat with the same
  key and a different body is a client bug, not a retry, and answering it with the first
  response would silently drop the second cart.

24-hour TTL, purged daily (`E01`).

### 7.3 The advisory lock

`pg_advisory_xact_lock(hashtext(order_group_id::text))` is taken first by `/verify`, by the
webhook handler, by the sweeper and by every refund. Constraints make a double-write *fail*;
the lock makes concurrent writers *queue* instead, so the loser sees the winner's committed
state and returns cleanly rather than raising a unique violation that then has to be
interpreted. Both are needed: the lock for tidy behaviour, the constraint because a lock is
advisory and a future code path might not take it.

Transaction-scoped, so it is released on commit or rollback with no unlock call to forget.

### 7.4 Idempotency on Razorpay's side

We do not control it, and it is weaker than the database's.

- **Order creation.** `receipt = order_group.id`. Whether duplicate receipts are rejected is an
  account setting **[verify in E19-01]**. The design does not depend on it: a duplicate
  Razorpay order is unpayable unless its id reached a client (§4.1).
- **Refunds.** Razorpay does **not** appear to offer a general `Idempotency-Key` header
  **[verify in E19-01]**, so a timed-out refund POST that actually succeeded would be
  re-issued blind by a naive retry — a double refund, which is real money out. The safe
  sequence, and the one `E06-08` implements:

  1. take the group advisory lock;
  2. `GET /v1/payments/:id/refunds` and look for one whose `notes.graybag_refund_id` equals the
     `refund.id` we are about to issue;
  3. if found, adopt it — set `provider_refund_id`, move to `processing` — and do not POST;
  4. otherwise POST, with `notes: { graybag_refund_id, correlation_id }`.

  **Our `refund.id` is generated before the provider call and sent in `notes`.** That is what
  makes step 2 possible, and it is the only reason a retry is safe. A refund created without it
  is unmatchable and becomes a break class **B6** the next morning.

### 7.5 The one thing that is not idempotent-safe today

`[OL-05]`. `uq_payment_one_capture_per_group` refuses to record a *genuine* second capture, so
the correct response to a real double charge — record it, then refund it — is the one thing the
schema forbids. Until migration `0003` adds `duplicate_of_payment_id` and narrows the index,
`E06-18` cannot be built and `E06-13` scenario 14 cannot pass. The general rule is in
`docs/learnings.md`: **a uniqueness constraint on a table that mirrors an external system must
not prevent recording something that system has already done.**

---

## 8. Reconciliation

`E06-11`, risk critical. Three tiers, three clocks, three questions. Conflating them produces a
job that is either too slow to catch a stuck payment or too noisy to read.

| Tier | Cadence | Question | Task |
|---|---|---|---|
| **1 — in-flight** | 5–15 min | "Is this specific attempt still in flight, or did something happen we missed?" | `E05-14`, `E06-17` |
| **2 — daily transaction** | daily, for yesterday | "Does our set of payments and refunds equal Razorpay's, row for row?" | `E06-11` |
| **3 — settlement** | per settlement | "Did the money Razorpay says it sent actually arrive, and does the ledger say so?" | `E06-27` |

Tier 1 is specified in `docs/order-lifecycle.md` §10.4 and §11. Tiers 2 and 3 are here.

### 8.1 Tier 2 — the daily job

Runs after midnight `Asia/Kolkata` for the previous day, with a **one-hour overlap** on either
side of the window so a payment created at 23:59:58 is not missed by clock skew. Re-running it
must be free, so every finding is keyed on `(provider_payment_id | provider_refund_id)` and
upserted into a run report rather than appended.

**Inputs**

1. `GET /v1/payments?from=&to=&count=100&skip=…`, paged to exhaustion. `from`/`to` are unix
   seconds on `created_at` **[verify in E19-01]**, as is the page size cap.
2. `GET /v1/refunds?from=&to=…` likewise, or refunds fetched per payment where the list
   endpoint does not exist **[verify in E19-01]**.
3. Our `payment` and `refund` rows over the same window.

**Matching key:** `provider_payment_id`. Never the amount, never the timestamp — two ₹210
orders in the same second are normal.

### 8.2 Break classes

Every break is one of these. Naming them is what turns "the numbers do not match" into a
runbook line (`E15-08`).

| # | Break | Meaning | Response |
|---|---|---|---|
| **B1** | At provider, not in our database | Money taken against a payment we have no row for | **Page.** Should be impossible under `L4` (§4.1). Real causes: a cross-environment key, or a dashboard-created payment link. Never auto-heal — a human decides whether it is ours |
| **B2** | In our database, not at provider | We hold a `provider_payment_id` Razorpay does not know | **Page.** Almost always test/live mixing (`E06-14`) |
| **B3** | Captured at provider, not captured with us | A settlement we missed — webhook lost, callback lost, sweeper too slow | **Auto-heal**: run `settle_payment()`. Alert at warn level, because each occurrence means a path failed |
| **B4** | Captured with us, not captured at provider | We believe money arrived and it did not | **Page.** Never auto-heal. Invoice issued, food may be cooked |
| **B5** | Amount mismatch | | **Page.** Never auto-heal |
| **B6** | A refund at the provider with no `refund` row | Someone refunded from the Razorpay dashboard (§8.5), or an adopted-refund match failed (§7.4) | **Page.** Ingest as a draft record for an admin to classify; do not post to the ledger unattended |
| **B7** | A `refund` row at `pending`/`processing` past its window | | Tier 1 owns it; tier 2 counts it and escalates if it recurs |
| **B8** | `provider_fee_paise` still null on a captured payment | The MDR was not in the capture payload | Backfill from the settlement report (§8.4). Not an error unless it persists past settlement |

**Only B3 self-heals.** Everything else alerts and waits for a human. A reconciliation job that
"fixes" a discrepancy it does not understand destroys the evidence needed to find out why.

### 8.3 Ledger assertions in the same run

These are cheap queries over our own data and they catch the class of bug that Razorpay cannot
see. Each is an invariant from `docs/order-lifecycle.md` §12.

| Assertion | Invariant |
|---|---|
| Every `ledger_transaction` sums to zero across its entries | I10 |
| Every `captured` payment has exactly one sale transaction | I9 |
| `wallet_balance.balance_paise = Σ` that account's ledger entries, for every row | I8, `[DM-04]` |
| No wallet hold outstanding against a group in a terminal state | `E06-19` |
| `order.refunded_total_paise = Σ` completed refunds attributable to it | I4 |
| `Σ` refunds at `pending`/`processing`/`completed` per group `≤` captured | I5 |
| No invoice for a group that never had a capture | I6 |
| Invoice numbers gapless within the financial year | I7 |
| No order at `draft` | I12 |
| `balance(provider:razorpay:clearing)` = what Razorpay says is pending settlement | §8.4 |

The last one is the payoff `[DM-03]` promised for double-entry: "does our clearing account
equal what Razorpay holds" is one query. **It cannot be run today** — see §8.4.

### 8.4 Tier 3 — settlement, and two gaps that block it

Razorpay batches captured payments and credits a bank account on a settlement cycle, net of
MDR and GST on MDR. The settlement recon report (`GET /v1/settlements/recon/combined?year=&
month=&day=` **[verify in E19-01]**) lists, per settled transaction, the payment id, amount,
fee, tax and the settlement UTR.

Ingesting it does three things: fills `provider_fee_paise` / `provider_tax_paise` (B8), gives
`E07-11` the real MDR per payment rather than an estimate, and lets the cash actually leave the
clearing account.

**Gap 1 — there is no bank account in the ledger.** `ledger_account_type` is `wallet,
revenue, receivable, payable, tax_payable, provider_clearing, provider_fees, suspense`. There
is nowhere for a settlement to land, so `provider:razorpay:clearing` is debited on every capture
and **never credited**: it grows without bound and the §8.3 assertion against it can never pass.
`docs/data-model.md` §8.4 already assumes the account exists — "payout later debits
`school:<id>:payable` and credits a bank clearing account" — so payouts are blocked on the same
gap. `[PAY-05]`, `E06-23`.

Adding it needs care: `ALTER TYPE … ADD VALUE` cannot be *used* in the same transaction that
adds it, and a Supabase migration file is one transaction. The value goes in `0003` and its
first use in `0004`, or the type is altered outside a transaction block.

**Gap 2 — there are no ledger reason codes.** `ledger_transaction.reason_code` is
`not null references reason_code(code)`, and the eight seeded codes are
`dish_unavailable`, `customer_cancelled`, `school_holiday`, `kitchen_closed`, `payment_failed`,
`duplicate_payment`, `goodwill`, `migration_opening_balance`. **Not one of them names a
sale**, an MDR fee, a wallet hold, a settlement or a revenue-share accrual — so
`docs/order-lifecycle.md` §8.4 step 6 ("post the sale to the ledger") cannot be written. The
`reason_category` enum already anticipates the split (`cancellation`, `refund`, `ledger`,
`adjustment`): the *why* vocabulary answers "why did this order stop", the *ledger* vocabulary
answers "what movement is this". Only the second is missing. `[PAY-05]`, `E06-22`, and it is a
blocker for `E06-07` — the ledger cannot be built without it. §10 lists the codes required.

### 8.5 Dashboard-initiated refunds — `[PAY-07]`

Anyone with Razorpay dashboard access can refund a payment without touching our database. It
produces a `refund.created` webhook we cannot match to a `refund` row, so it lands in §10.9's
"unknown" path and then in break class B6 — the money moved, our ledger says it did not, the
school's revenue share is overstated and the customer's order still reads `paid`.

**Recommended: forbid by policy, detect by design.** Refunds are issued through the admin UI
(`E06-08`), which is the only path that writes a `refund` row, a ledger posting and a credit
note. The dashboard is break-glass only. Detection is not optional, because a policy is not a
control: the `refund.created` handler recognises a provider refund with no matching row and
records it as a **draft** `refund` for an admin to classify and complete, rather than guessing a
`reason_code`. Needs a seeded code (`provider_initiated`) and Andy's agreement on the policy,
since he is the dashboard holder.

### 8.6 Output

One row per run in a report the admin dashboard renders (`E10`), plus:

- **Page** on any B1, B2, B4, B5 or B6, on a failed zero-sum assertion, and on any wallet drift.
- **Warn** on B3 and B7 counts above a threshold.
- The daily health digest (`E15-06`) carries the run's status, so a job that silently stopped
  running is visible as an absence.

A run that finds nothing must still report, for that last reason.

---

## 9. Refunds

`E06-08` (full and per-line), `E06-09` (wallet default), `E06-12` / `E07-11` (MDR).
`docs/order-lifecycle.md` §7 owns `refund_status` and what a refund does to the order; this
section owns the amount, the destination, the provider call and the ledger.

### 9.1 The shapes

| Shape | Trigger | `refund.order_id` | `refund_line` rows |
|---|---|---|---|
| Full group | Customer cancels the whole checkout; checkout expired after a late capture (§10.5) | null | all lines |
| Full order | One recipient's order cancelled out of a multi-order group (`[DM-01]`) | that order | that order's lines |
| **Per line** | A dish is unavailable; deliver the rest (`E06-08`, §10.11) | that order | the affected lines only, with `quantity` |
| Partial quantity | 1 of 3 sandwiches unavailable | that order | one line, `quantity = 1` |
| Goodwill | Admin, post-delivery | that order | optional |
| Duplicate | §10.6b | null | none — it refunds a payment, not food |

Per-line is the interesting one and it is why `refund_line` carries `quantity` as well as
`amount_paise`: `order_line.refunded_quantity` is maintained from it, and
`order_line.status` is derived from that (`ordered` → `partially_refunded` → `refunded`).

### 9.2 Destination is a *request*, not a guarantee — `[PAY-02]`

`M7` makes wallet the default, resolved through the config chain
(`refund_default_destination`, platform → kitchen → school). Two things override it:

- a **duplicate payment** always refunds to **source** (§10.6b) — someone charged twice wants
  their money back, not credit;
- a **wallet-funded portion** can only go back to the wallet.

That second one is the constraint people miss. An order paid ₹50 from wallet and ₹160 from a
card has only ₹160 at the provider. A ₹210 "refund to source" is not partially possible; it is
**impossible**, because ₹50 of it was never sent to Razorpay.

So: **`refund.destination` is a single enum on a single row, and one logical refund may
therefore need two rows.** The split rule:

```
wallet_portion = min(requested, wallet_applied_paise − already refunded to wallet
                                                      from that group's wallet leg)
source_portion = requested − wallet_portion
source_portion ≤ payment.amount_paise − Σ (completed + in-flight refunds against that payment)
```

- Destination **wallet** (the default): one row, everything to wallet. No provider leg, no cap,
  synchronous (§7.1 of the lifecycle document).
- Destination **source**: the wallet-funded portion goes to **wallet** and the rest to source —
  two rows, sharing a `correlation_id`, each with its own `refund_line` rows summing correctly.

**Options considered.** (a) The split above — the wallet leg back to the wallet, the source leg
back to source. (b) Proportional across both, which is defensible in accounting and impossible
to explain to a parent ("you paid ₹50 from your balance and got ₹38 of it back"). (c) Refuse
source refunds on part-wallet orders entirely, which is simple and leaves a real support case
with no answer. **Recommended: (a)**, which is what is written. `[PAY-02]`.

The over-refund guard (§7.3 of the lifecycle document, `E06-21`) enforces the group-level cap
independently, so a bug in this arithmetic fails at write time rather than sending money.

### 9.3 Amount arithmetic

**Refund amounts are gross — inclusive of GST.** The customer paid tax, so a refund returns the
tax, and the credit note reverses the CGST and SGST (`E07-07`). The revenue share works on the
*taxable* value (`[DM-18]`), which is why the ledger posting in §10 splits them again.

The rules, in priority order:

1. **A full-group refund equals `invoice.total_paise` exactly** — including
   `round_off_paise`. It is *not* computed as the sum of lines; the invoice is the document of
   record and the sum of lines can differ from its total by the round-off ([DM-19]).
2. **A full-line refund equals `invoice_line.total_paise` exactly.** No recomputation from unit
   price, no re-derived tax. The number was fixed when the invoice was issued.
3. **A partial-quantity refund** on a line of quantity *n* refunding *k*:
   `floor(line_total × k / n)` per unit, and **the last unit refunded on that line carries the
   remainder**, so refunding a line one unit at a time sums to exactly the line total. The
   "last unit" is determined by `refunded_quantity + k = quantity`, not by wall-clock order.
4. Every intermediate value is integer paise. Non-negotiable #3 has no exception for a
   proportion.

Rule 3 is where a rounding bug would hide, and it is worth a property test rather than an
example test: for every `(line_total, n)`, the sum over any partition of *n* equals
`line_total`.

`[DM-19]` — per-line or per-invoice GST rounding — is decided in `Q09` and rules 1 and 2 above
depend on it only in that they *defer* to whatever the invoice recorded. That is deliberate:
refund arithmetic must never re-derive tax, or a later change to the rounding rule silently
changes the refundable amount on historical orders.

### 9.4 The provider call

```
POST https://api.razorpay.com/v1/payments/{provider_payment_id}/refund
{ "amount": <source_portion_paise>,
  "speed":  "normal",
  "notes":  { "graybag_refund_id": "<refund.id>", "correlation_id": "…" } }
```

Preceded by the adopt-or-create check in §7.4 — always, including on the first attempt, because
"first attempt" is not knowable after a timeout.

The response yields `provider_refund_id` → `refund.status = 'processing'`. Completion arrives
as `refund.processed` (§7.2 of the lifecycle document). T+5 to T+7 working days is normal for
`normal` speed and the app must say so rather than implying instant.

A refund on a payment that is not `captured` is rejected before the call is made — there is
nothing to refund.

### 9.5 Refund speed — `[PAY-03]`

Razorpay offers `normal` (settled in the usual cycle, no extra charge) and `optimum` (instant
where the rails support it, at an additional fee) **[verify in E19-01]** for the exact names,
availability by method, and cost.

**Recommended: `normal`, always.** `M7` already provides the instant option — it is the wallet,
it costs nothing, and it is the default. Paying a per-refund premium to make the *non-default*
path faster is buying the wrong thing, and under `M5` the premium would land on the school's
share, which is a charge they did not agree to for a choice they did not make. Listed as an
open question because it is a cost/experience trade Andy may see differently for, say, a
duplicate-charge refund where goodwill matters most.

### 9.6 MDR — `[PAY-04]`, and a hole in `M5`

Razorpay charges MDR on capture and **does not return it on a refund**. `M5` says that loss
comes out of the school's share; `refund.mdr_paise` and `refund.mdr_borne_by` record it and
`E07-11` deducts it on the payout.

Attribution:

```
refund.mdr_paise = floor( (payment.provider_fee_paise + payment.provider_tax_paise)
                          × refund.amount_paise / payment.amount_paise )
```

capped so the sum across all refunds against one payment never exceeds the fee actually
charged. It depends on `provider_fee_paise` being populated, which may only happen at
settlement (B8) — so **a refund issued before its payment settles has an estimated MDR that must
be trued up**, or the deduction is wrong. Simplest correct answer: compute `mdr_paise` at
**payout** time from the settled fee, not at refund time, and leave `refund.mdr_paise` as the
recorded estimate. `E07-11` owns it.

**The hole.** `M5` assumes there is a school share to deduct from. Under `[DM-18]`'s assumed
reading — the share is *earned on delivery* — the most common refund by far, an order cancelled
before it was ever delivered, has **no share to deduct from**. The school earned nothing on that
order, so "the MDR comes out of the school's share" has no referent, and the deduction either
silently reduces an unrelated order's share in the same payout period or falls to zero.

**Options.** (a) The MDR on refunds of undelivered orders is **absorbed by the platform**;
`M5` applies only where a share was actually earned (post-delivery goodwill refunds). Simple,
honest, and it costs GrayBag roughly 2% of the refunded value on cancellations. (b) The
deduction is **netted against the school's next period** regardless of which order earned what
— which is what a naive implementation does by accident, and it will produce a payout line a
school cannot reconcile to any order. (c) Change `[DM-18]` so the share is **earned on
payment** and reversed on refund; then there is always a share to deduct from, at the cost of
paying schools for meals that were never eaten until the reversal lands.

**Recommended: (a)**, with the payout report showing the absorbed MDR as a platform cost so it
is visible rather than invisible. This needs Andy and probably the accountant — it is a
commercial term, not an engineering choice, and it interacts with `[DM-18]`, which is also
open. `[PAY-04]`.

### 9.7 Credit notes — `[PAY-06]`

`E07-07`. Every completed refund produces a credit note: `invoice.document_type =
'credit_note'`, `credit_note_of_invoice_id` pointing at the tax invoice, negative-facing
amounts on the same CGST/SGST split, allocated from `invoice_sequence` in the same
`UPDATE … RETURNING` pattern as an invoice (`D14`).

That last point has a consequence nobody has ruled on: `invoice_fy_sequence_unique
(financial_year, sequence_no)` spans **both** document types, so credit notes and tax invoices
share one number series and a credit note consumes an invoice number. Indian GST requires a
consecutive serial number unique within the financial year for both, and a single shared series
satisfies the letter of it; a separate series per document type is the more common practice and
is what most accountants expect to see. Changing it later is a migration plus a second sequence
table. **Needs the accountant** — it rides with `E00-10`/`E00-11` and `E07-02`. `[PAY-06]`.

Wallet refunds get a credit note too. The supply was reversed; how the money came back is
irrelevant to the tax document.

### 9.8 Concurrency

Two admins refunding the same order is `E06-13` scenario 23 and is real — it happens when one
does it and tells the other. The guard is `E06-21`'s corrected predicate:

```
Σ refund.amount_paise WHERE status IN ('pending','processing','completed')  ≤  captured amount
```

evaluated in a constraint trigger **that takes the `order_group` row lock first**. Both halves
matter: counting in-flight refunds is what stops the second admin, and the row lock is what
stops both evaluating the sum before either has inserted. The refund handler also takes the
group advisory lock (§7.3), so in practice the second admin queues and then fails cleanly.

### 9.9 Wallet refunds

No provider leg. Inserted `pending` and moved to `completed` in the same transaction as the
ledger posting and the `wallet_balance` update, `payment_id` null (or set, for attribution,
where the money originally came from a capture). The customer sees the balance immediately,
which is the whole point of `M7`.

One schema gap worth closing while `0003` is open: nothing prevents `destination = 'source'`
with `payment_id` null — a refund to a source that does not exist. A `CHECK (destination <>
'source' or payment_id is not null)` costs nothing. `E06-24`.

---

## 10. Ledger postings — the complete set

Double-entry (`[DM-03]`), every transaction summing to zero (I10). Worked at ₹210 gross =
20000 paise taxable + 500 CGST + 500 SGST, of which 5000 came from the wallet.

**Every one of these needs a `reason_code` that does not exist yet** (§8.4 gap 2). The proposed
`category = 'ledger'` codes are in the right-hand column; `E06-22` seeds them.

| # | When | Debit | Credit | `reason_code` |
|---|---|---|---|---|
| 1 | Wallet applied at checkout (a **hold**, not a sale) | `user:<id>:wallet` 5000 | `platform:suspense` 5000 | `wallet_hold` |
| 2 | Capture | `provider:razorpay:clearing` 16000, `platform:suspense` 5000 | `platform:revenue` 20000, `platform:tax_payable:cgst` 500, `platform:tax_payable:sgst` 500 | `sale` |
| 3 | MDR on that capture | `platform:provider_fees` *fee+tax* | `provider:razorpay:clearing` *fee+tax* | `provider_fee` |
| 4 | Settlement to bank | `platform:bank` *net* | `provider:razorpay:clearing` *net* | `settlement` |
| 5 | Revenue share earned (`[DM-18]`) | `platform:revenue` 2000 | `school:<id>:payable` 2000 | `revenue_share` |
| 6 | Refund to wallet | `platform:revenue` *taxable*, `platform:tax_payable:*` *tax* | `user:<id>:wallet` *gross* | `refund_to_wallet` |
| 7 | Refund to source | `platform:revenue` *taxable*, `platform:tax_payable:*` *tax* | `provider:razorpay:clearing` *gross* | `refund_to_source` |
| 8 | MDR recovered from the school on a refund (`M5`, subject to `[PAY-04]`) | `school:<id>:payable` *mdr* | `platform:provider_fees` *mdr* | `refund_mdr_recovery` |
| 9 | Revenue share reversed on refund | reversal of #5, via `reversal_of_transaction_id` | | `revenue_share` |
| 10 | Wallet hold reversed (checkout died) | reversal of #1 | | `wallet_hold_reversal` |
| 11 | Payout paid | `school:<id>:payable` | `platform:bank` | `payout` |

Notes on the shape:

- **#1 is a hold, not revenue.** The sale is not recognised until capture, which is why the
  wallet portion sits in `platform:suspense` until #2 clears it. A checkout that dies reverses
  #1 rather than editing it (`E06-19`) — corrections are reversals, never edits.
- **#4 is what makes the §8.3 clearing assertion pass**, and it is the posting that cannot be
  written today for want of a `bank` account type (`[PAY-05]`).
- **#3 is missing from the worked example in `docs/data-model.md` §8.4**, which debits
  `provider:razorpay:clearing` for the full gross. Razorpay never settles the gross, so without
  #3 the clearing account is permanently overstated by the MDR. Not a contradiction to resolve —
  the model's example is a simplification — but the implementation must post #3 or tier 3 can
  never balance.
- `ledger_transaction_source_unique (source_type, source_id, reason_code)` means each row above
  is postable exactly once per source object, which is layer 6 of §7.1. Note this is *why* the
  ledger needs movement-shaped reason codes rather than the *why*-shaped ones: two different
  postings against one refund (#6 and #8) must differ in `reason_code` or the second is refused.

### 10.1 The sign convention — which way `balance()` runs, per account type

The postings above are debit/credit *pairs*; nothing in them says which direction is
**positive** when you compute an account's balance. That is not a free choice, and it is not
uniform across accounts. State it once, here, because two nightly assertions
(`docs/order-lifecycle.md` I8 and §8.3's clearing-balance check) depend on it and they run in
**opposite** directions. `E06-31` implements it.

Every account has a `normal_balance` (`docs/data-model.md` §8.4). `balance()` is defined so a
healthy account is non-negative in its own normal direction:

```
balance(account) = Σ(entries on the normal side) − Σ(entries on the opposite side)

  normal_balance = 'debit'  ⇒  balance = Σdebits  − Σcredits
  normal_balance = 'credit' ⇒  balance = Σcredits − Σdebits
```

Per `ledger_account_type`, that resolves to:

| `account_type` | `normal_balance` | `balance()` is | Because it is a |
|---|---|---|---|
| `wallet` | credit | `Σcredits − Σdebits` | **liability** — money we owe the customer; a hold (#1) *debits* it when they spend |
| `revenue` | credit | `Σcredits − Σdebits` | income |
| `tax_payable` | credit | `Σcredits − Σdebits` | liability to the government |
| `payable` | credit | `Σcredits − Σdebits` | liability to a school/kitchen |
| `provider_clearing` | debit | `Σdebits − Σcredits` | **asset** — money at Razorpay; a capture (#2) *debits* it |
| `provider_fees` | debit | `Σdebits − Σcredits` | expense |
| `receivable` | debit | `Σdebits − Σcredits` | asset |
| `suspense` | debit | `Σdebits − Σcredits` | asset-side holding account |

The two assertions therefore read opposite columns of the same ledger:

- **I8** — `wallet_balance.balance_paise = balance(user:<id>:wallet)` — the wallet is a
  **liability**, so its balance is `Σcredits − Σdebits`.
- **§8.3 clearing** — `balance(provider:razorpay:clearing)` = what Razorpay says is pending —
  clearing is an **asset**, so its balance is `Σdebits − Σcredits`.

**A single-sign `balance()` helper is therefore wrong.** A helper that hard-codes
`Σdebits − Σcredits` (or its negation) for every account gets exactly half of them backwards,
and the failure is silent because a balanced two-sided posting still sums to zero across the
transaction (I10) — the sign bug only surfaces when you compute a *per-account* total. The
helper must branch on `ledger_account.normal_balance`, and the test asserts a `credit`-normal
and a `debit`-normal account with the same posting come out with opposite signs.

---

## 11. Security, PCI and data protection

### 11.1 PCI scope

Using Razorpay's Standard Checkout (§3.2 option a or b) means **card data never touches our
code, our servers or our logs** — it is entered in Razorpay's SDK/iframe and tokenised by them.
That keeps GrayBag in the lightest self-assessment category available to a merchant that
redirects/embeds rather than handles.

Option (c) — a bespoke S2S flow — would change that materially. It is the strongest reason to
reject it beyond the build cost, and it is why "let's build our own card form later" is a
decision that must come back through `docs/decisions.md`.

We store `card.last4` and `network` from the webhook payload, and nothing else about an
instrument (§6.5). No PAN, no CVV, no expiry, no token, no VPA.

### 11.2 Secrets

Covered in §2. The two rules that bite: the key secret and webhook secret are different values,
and neither ever reaches a client bundle (`E01-18`).

### 11.3 What is never logged

`E15-02` threads `correlation_id` through every log line, which is exactly what removes the
temptation to log the payload "for debugging". Never logged, at any level, in any environment:
signatures, secrets, card fields, VPAs, and anything from non-negotiable #4 — a recipient's
name, class, section or allergens. A payment log line carries `correlation_id`,
`order_group_id`, `provider_payment_id`, amount, status and event type. That is enough to
answer every support question, because `E02-13`'s correlation id is the join.

### 11.4 The webhook endpoint is public

It has to be. Its defences, in order: the HMAC (§5), the fact that an unverified body is never
parsed as anything but bytes, the `(provider, provider_event_id)` unique constraint, and the
fact that a verified event still only ever *triggers a re-read from Razorpay's API* for
anything material. A forged event that somehow passed all of that would still not move money,
because settlement is driven by what Razorpay's API says when we ask it.

Rate limiting sits in front of it, generous enough to absorb a retry burst.

---

## 12. What must wait on `E19-01`

The checklist. Each row is a statement this design makes, what the spike must confirm, and what
breaks if the answer is different. `E19-06` writes up the answers; `E19-07` is this checklist.

| # | Statement | If it is wrong |
|---|---|---|
| 1 | ~~The official RN SDK gives native UPI intent, and needs an EAS dev build (not Expo Go)~~ **ANSWERED 2026-08-09: yes, both halves.** A real UPI payment completed on an EAS release build | ~~`[PAY-01]` flips to WebView~~ Closed |
| 2 | ~~Android 11+ `<queries>` is required for the UPI app chooser, and the SDK does not supply it~~ **ANSWERED 2026-08-09: the requirement is real; the second half is wrong.** `com.razorpay:standard-core` does supply it — confirmed from a built artefact's merged manifest. We now supply it ourselves anyway (`E06-29`), assert it in the APK (`E06-32`) and pin the upstream source (`E19-08`) | ~~Silent degradation to collect/QR~~ Closed, and no longer dependent on an unpinned third party |
| 3 | iOS UPI app-switch works, and which `LSApplicationQueriesSchemes` are needed | **Still open.** No iOS build has run a payment. iOS UPI falls back to collect. Tolerable, but it must be a known state |
| 4 | ~~Auto-capture works identically for UPI intent (`[OL-01]`)~~ **ANSWERED 2026-08-09: yes — the dashboard shows `captured`, not `authorized`** | ~~If UPI intent only ever authorizes, `authorized` becomes a live state and `L5` starts costing real orders~~ Closed. `authorized` is a transient out-of-order-delivery state, not one an order sits in. `L5` stays as a guard against a case that should not arise |
| 5 | The webhook event set is exactly §6.4's list, with those names | Missing events break settlement paths; unknown ones are ignored, so the risk is one-directional |
| 6 | `order.paid` fires for every capture | Only affects redundancy; `payment.captured` is the primary |
| 7 | Webhooks carry `X-Razorpay-Event-Id` | Layer 4 of §7.1 needs the deterministic fallback in §6.2, which is weaker |
| 8 | Webhook signature = HMAC-SHA256(webhook secret, raw body), hex, in `X-Razorpay-Signature` | **Every** webhook fails verification. §5.6's failure mode, live |
| 9 | ~~Callback signature = HMAC-SHA256(key secret, `order_id\|payment_id`), hex~~ **ANSWERED 2026-08-09: confirmed against a real payment.** `MATCH` from `scripts/verify-signature.mjs` | ~~`/verify` rejects every legitimate callback~~ Closed. §5.3 can be built as written |
| 10 | Webhook retry policy and window (assumed ~24h) | Sets the `_PREVIOUS` window in §2.4 and the "we own retry" boundary in §6.6 |
| 11 | Webhook response timeout | If it is tight, §6.2's inline processing must move fully to the retry job |
| 12 | How long a **UPI collect** can stay pending, and whether Razorpay expires it | Sets the floor for `[OL-03]`'s TTL. Too short and §10.5 (late capture after sweep) becomes routine |
| 13 | Whether duplicate `receipt` values are rejected, and whether it is an account setting | Only strengthens §4.1; the design does not depend on it |
| 14 | `notes` limits — key count and value length | Three keys is well inside any plausible limit, but §7.4's refund matching depends on `notes` surviving round-trip |
| 15 | Refunds have **no** idempotency key header | If they do, §7.4's adopt-or-create can be simplified. If they do not, it is mandatory |
| 16 | Refund `speed` values, availability by method, and cost (`[PAY-03]`) | Decides `[PAY-03]` and the wording the app shows about timing |
| 17 | Refunds are listable per payment (`GET /v1/payments/:id/refunds`) | §7.4 step 2 is impossible without it and double-refund risk returns |
| 18 | `fee` and `tax` are present on `payment.captured`, or only at settlement | Decides whether `E07-11` can compute MDR at refund time or must wait for settlement (§9.6) |
| 19 | The settlement recon report endpoint, its shape and its retention window | Tier 3 (§8.4) and `E06-27` depend on it entirely |
| 20 | The payments list API's `from`/`to` semantics and page-size cap | Tier 2's windowing (§8.1). Getting it wrong produces false B1/B2 breaks, which page |

### 12.1 The `E19-07` sitting — answered 2026-08-13, against a live test account

Andy subscribed the real `payments-webhook` (not a throwaway probe — the deployed function, so
what was measured is what ships), paid a Standard Payment Link by netbanking, and ran
`scripts/probe-razorpay.mjs`. **Five of seven answered; two are recorded as open with reasons.**

Every line below is an observation from a recorded event or an API response, never a reading of
documentation — the distinction that matters, because the docs implied `authorized` where a real
capture gives `captured`.

| Row | Answer | What it settles |
|---|---|---|
| **7 — event id** | **`X-Razorpay-Event-Id` IS sent.** Values like `TPGqpLt6Q25DR5`, not the 64-hex body-hash fallback | §7.1 layer 1 dedupes on the real id. §6.2's weaker fallback stays as a guard, unexercised |
| **5/6 — event set** | Observed: `payment.failed`, `payment.authorized`, `order.paid`, `payment.captured`, `refund.created`, `refund.processed`. **`order.paid` fires ~1s after `payment.captured`** | Both describe one capture. `order.paid` is NOT in `HANDLED` and was recorded `ignored` — had it been handled, one payment would have settled twice |
| **18 — `fee`/`tax`** | **PRESENT and non-zero at capture.** `fee: 546, tax: 84` on a ₹210 netbanking payment | **The expensive one, and it went our way.** `E07-11` computes MDR at refund time; `M5` stands; `E07-10` and `E11-01` are unaffected. §4.3's contingency does not fire |
| **15 — refund idempotency** | **NOT idempotent.** `Idempotency-Key` was accepted, returned 200, and **created a second refund**: `rfnd_TPH0fuCG3IDjgs` and `rfnd_TPH0iHly5Eza3G`, identical bodies | §7.4's `notes.graybag_refund_id` adopt-or-create is **mandatory**, not an optimisation. `E06-08` must reconcile before every retry |
| **17 — refunds listable** | Yes, `GET /v1/refunds` returns them with `status` and `speed_processed` | §7.4 step 2 is possible |
| **19 — settlements** | `GET /settlements` → `id, entity, amount, status, fees, tax, utr, created_at, currency`. `settlements/recon/combined` → 200, 0 rows on a test account | `E06-27` has a shape to build against; row counts need a live account |
| **20 — payments list** | **Both ends INCLUSIVE** (proved both ways: `from=to=created_at` returns the payment; `from=created_at+1` excludes it). `created_at` is **epoch seconds, UTC**. `count` capped at **100**, with an explicit `400` above it | Tier 2's window must be half-open in our own code, and converted from IST. Inclusive-inclusive plus UTC seconds is how a daily recon double-counts the boundary second and still looks correct |

**Still open, and why — neither is a guess we may quietly fill in later:**

| Row | Why it is still open |
|---|---|
| **10/11 — retry policy and response timeout** | Our webhook always answers `200`, so Razorpay has never retried. Measuring it needs a deliberate non-`200` — a separate experiment, not a sitting. Until then §2.4's `_PREVIOUS` window and §6.6's "we own retry" boundary rest on the assumed ~24h |
| **12 — UPI collect expiry** | **Not answerable with the instruments available.** Test VPAs resolve immediately by design, so no pending collect can exist to time; and a payment link created without `expire_by` never expires — one sat at `status: created` for 9.1 hours with `expire_by: 0`. This must come from Razorpay support or a real Indian handset (§14.1, `E19-11`). `[OL-03]`, the `pending_payment` hold and `S21`'s Ending B all resolve on it, and a hold shorter than the real expiry manufactures the late-capture path `L9`'s grace window exists to absorb |

**Two things learned by accident, both worth keeping.** Andy's two failed card attempts —
`4111 1111 1111 1111` is rejected as *international* on a default test account — were recorded as
verified `payment.failed`, so the decline path is evidenced without anyone writing a test for it.
And the hosted payment-link page shows a **UPI QR with no UPI-ID field** on desktop, so the
test-VPA path needs netbanking or a card instead; netbanking turned out to be the better
instrument anyway, because UPI's zero MDR would have made `fee: 0` indistinguishable from
"not populated yet".

Two further things the spike should measure while it has a handset in hand, because they are
free at that point and expensive later: **the wall-clock time from tapping Pay to the callback
firing on UPI intent** (it sets the app's waiting-state design under `S5`), and **whether the
app survives the PSP app-switch on a mid-range device under memory pressure** (it sets how
often §3.4's recovery path actually runs). Neither blocks the design; both change `E13`/`E14`.

---

## 13. What this specification requires elsewhere

Each is a backlog task. The first two are **blockers for `E06-07`** — the ledger cannot be
built without them.

1. **Ledger reason codes** — the `category = 'ledger'` vocabulary in §10. `E06-22`, migration
   `0003`, alongside `E06-20`'s other seed additions.
2. **A `bank` value on `ledger_account_type`**, plus the seeded `platform:bank` account. `E06-23`.
   Blocks tier-3 reconciliation *and* payouts.
3. **`[OL-05]`'s duplicate-capture column** — already `E06-20`.
4. **`CHECK (destination <> 'source' or payment_id is not null)` on `refund`.** `E06-24`.
5. **A `provider_initiated` reason code** for `[PAY-07]`'s dashboard-refund ingestion. `E06-22`.
6. **Config**: `pending_payment_ttl_minutes`, `payment_in_flight_grace_minutes`,
   `payment_retry_window_minutes` — already `E06-20`.
7. **Payload redaction and its test.** `E06-25`.
8. **The Expo config plugin** for Android `<queries>` and iOS `LSApplicationQueriesSchemes`.
   `E06-29`.
9. **Webhook secret rotation runbook** with the dual-secret window. `E06-26`, feeding `E00-17`.
10. **The misconfiguration alert** distinct from the attack alert. `E06-28`, under `E15-05`.
11. **Dispute handling** — deferred, `E18-24`.
12. **A correction to `docs/data-model.md` §8.4's worked example**, which omits the MDR posting
    (§10 note). Ride it along with `E06-22`.

---

## 14. Test additions for `E06-13`

`docs/order-lifecycle.md` §12.1 lists 24 scenarios. These are the provider-integration ones it
does not cover, and they are unit- or contract-testable without a live account except where
noted.

| # | Scenario | Expected |
|---|---|---|
| 25 | Webhook body re-serialised before HMAC | Verification fails — asserts §5.2's raw-body rule is actually implemented |
| 26 | Webhook signed with the **key secret** instead of the webhook secret | Rejected, recorded, `200` |
| 27 | Signature compared against a truncated/extended digest | Rejected. Fixed-length compare |
| 28 | 100% signature failure since a marker time | The `E06-28` misconfiguration alert fires, distinct from the attack alert |
| 29 | Zero verified events in a window in which orders were placed | Same alert fires |
| 30 | A refund POST that times out, then is retried | One provider refund, adopted by `notes.graybag_refund_id` (§7.4) |
| 31 | Refund on an order paid part-wallet, destination `source` | Two `refund` rows; source leg ≤ what source captured (`[PAY-02]`) |
| 32 | Per-line refund of 1 of 3, then 1, then 1 | Three refunds summing to exactly `invoice_line.total_paise` (§9.3 rule 3) |
| 33 | Full-group refund on an invoice with non-zero `round_off_paise` | Refund equals `invoice.total_paise`, not the sum of lines |
| 34 | Sentinel recipient name in the cart | Appears in no outbound Razorpay body and no stored payload (`E06-25`) |
| 35 | Daily job over a seeded provider fixture with one of each break class | Each classified correctly; only B3 self-heals |
| 36 | Daily job run twice over the same day | Identical report, no duplicate ledger postings |
| 37 | Ledger transaction with unbalanced entries | Refused at commit (I10) |
| 38 | `rzp_live_` key id with `APP_ENV != production` | Function refuses to start (`E06-14`) |
| 39 | A `refund.created` for a provider refund with no local row | Draft record, `200`, page (`[PAY-07]`) |
| 40 | UPI intent happy path on a real handset | **Live only, and NOT runnable by Andy** — see §14.1 |
| 41 | UPI **collect** success, test VPA `success@razorpay` | `payment.captured`. The reachable substitute for 40 |
| 42 | UPI **collect** failure, test VPA `failure@razorpay` | `payment.failed`, and the app shows a decline rather than a cancellation |
| 43 | Card fallback, `4111 1111 1111 1111` | `payment.captured` on a non-UPI method — proves the settlement path is not UPI-shaped |

### 14.1 Who can run scenario 40, and why it is not Andy

**Andy is in Australia and has no working UPI.** Not temporarily — this is the standing condition
of every payment test this project runs, so it belongs in the specification rather than in a
message.

`E19-01` was validated on a real Android handset with a real test-mode UPI **intent** payment
(`docs/spike-results.md` B6, B7). That evidence stands — it is what closed `[PAY-01]` — but **it
cannot be reproduced by the person who now runs the tests.** A design that assumes it can is a
design whose verification plan has no owner.

So the split, explicitly:

| | Runnable by Andy, from anywhere | Needs a real Indian handset with UPI |
|---|---|---|
| **Scenarios 41–43** | Yes — test VPAs and test cards, laptop browser | — |
| **Scenario 40** | No | Yes, at release, in India |

**What the substitutes do and do not cover.** The webhook, the signature, `settle_payment`, the
invoice and the ledger see an identical `payment.captured` whichever instrument produced it — so
everything downstream of the provider is fully covered by 41–43. What they cannot exercise is the
**app-switch itself**: `LSApplicationQueriesSchemes` and the Android `<queries>` block (`E06-29`),
the chooser, and the process being killed while another app has the foreground (`E06-16`). Those
are properties of the handset, not of our server, and they need scenario 40.

**Open the checkout on a laptop.** The intent chooser only appears where the OS can resolve an
installed UPI app; a desktop browser has nothing to resolve, so checkout renders the collect path
with the "Enter UPI ID" field that accepts a test VPA. On a phone with any UPI app installed,
checkout may launch straight into intent and never offer the field — which looks like the test
being impossible rather than like the wrong device.

---

## 15. Open questions this raised

Seven, all recorded in `docs/open-questions.md` under "Raised by the payments design (Q07)".
`[PAY-05]` blocks `E06-07` outright.

| Q | One line | Blocks |
|---|---|---|
| ~~`[PAY-01]`~~ | ~~Native RN SDK, WebView checkout, or a bespoke S2S flow~~ **RESOLVED 2026-08-09 — (a), the native RN SDK, demonstrated end to end on a handset** | ~~`E19-01`, `E06-02`, `E14`~~ |
| `[PAY-02]` | How a refund splits across a wallet-funded and a source-funded portion | `E06-08`, `E06-09` |
| `[PAY-03]` | Refund speed `normal` or `optimum`, and who pays for instant | `E06-08` |
| `[PAY-04]` | `M5`'s MDR deduction has no school share to come out of on a pre-delivery refund | `E06-12`, `E07-11` |
| `[PAY-05]` | The ledger has no bank account type and no movement reason codes, so no posting can be written | `E06-07`, `E06-11`, `E07-10` |
| `[PAY-06]` | Credit notes share the invoice number series — is one series acceptable | `E07-07`, `E07-02` |
| `[PAY-07]` | Dashboard-initiated refunds bypass the ledger — forbid, ingest, or both | `E06-08`, `E06-11` |
