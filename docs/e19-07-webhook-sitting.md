---
title: E19-07 — the webhook sitting, prepared
status: Prep. Andy's part is three actions; everything around them is built beforehand.
---

# The `E19-07` sitting

Seven facts about Razorpay's behaviour cannot be learned from documentation, because the
documentation either does not state them or states them in a way we have already seen differ
from a live account (`E19-01` found `captured` where the docs implied `authorized`). They need
one sitting against a real dashboard.

**This document exists so that sitting is short.** Everything that can be built in advance is
built in advance; Andy's part is three actions and roughly **45 minutes**.

---

## 1. What we need to learn, and why each one costs something

| # | Question | What it decides | Cost of guessing wrong |
|---|---|---|---|
| 1 | The exact **webhook event set**, and whether `X-Razorpay-Event-Id` is sent | Which events we subscribe to and how §7.1 layer 1 deduplicates | Subscribing to the wrong set means a capture we never hear about. No event id means dedup falls to a weaker key |
| 2 | **Retry policy** — how many, over what window, and the response timeout | Whether "always 200" (§6.3) is sufficient, and how long a poisoned event keeps arriving | Too-slow a handler is retried as a failure; we then process the same capture twice |
| 3 | How long a **UPI collect** stays pending before Razorpay expires it | `[OL-03]`, the `pending_payment` hold, and `S21`'s Ending B — the waiting screen has no timeout and resolves on this | A hold shorter than Razorpay's expiry manufactures the late-capture path `L9`'s grace window exists to absorb |
| 4 | Whether **refunds accept an idempotency key** header | Whether `E06-08` can retry a refund safely or must reconcile before every attempt | A retried refund without idempotency sends money twice |
| 5 | Whether **`fee` and `tax` arrive on `payment.captured`** or only at settlement | **The expensive one.** `E07-11` computes MDR at refund time; `M5` puts refund MDR on the school's share | If they arrive only at settlement, a school's payout cannot be calculated until days later. That is not a code change — it reaches `E07-10` and `E11-01` |
| 6 | The **settlement recon report** shape and retention | `E06-27`, tier-3 reconciliation | Tier 3 cannot be written |
| 7 | Payments-list **`from`/`to` semantics** and page-size cap | `E06-11`, tier-2 daily recon — whether the window is inclusive, and in which timezone | A daily recon that silently drops the boundary hour reconciles to a wrong total and looks correct |

---

## 2. What Andy needs in front of him

1. **The Razorpay dashboard**, logged in, **in Test mode.** Settings → Webhooks, and Settings →
   API Keys.
2. **Test-mode API keys** (`rzp_test_…` key id and secret). Not the live ones — nothing in this
   sitting should touch a live account.
3. **A phone with a UPI app**, for the one question that needs a real payment attempt (#3, how
   long a collect stays pending). Test mode is enough; no real money moves.

That is all. No tunnel, no local server, no ngrok — see below.

---

## 3. What is built beforehand, so the sitting is short

**A `webhook-probe` Edge Function**, deployed to the **staging** Supabase project. It logs the
raw body, every header, and the receipt time to a table, and always returns `200`. It verifies
nothing and decides nothing — it is a tape recorder.

Deploying it to staging rather than running a local tunnel is the whole trick: a Supabase Edge
Function is already a public HTTPS URL, so there is nothing to install, nothing to keep open,
and nothing that stops working when the laptop sleeps. The URL can be pasted into the dashboard
and left subscribed for as long as we like.

**A script, `scripts/probe-razorpay.mjs`**, that answers rows 4, 6 and 7 by making the API calls
directly with the test keys and printing what comes back. These need no webhook and no payment —
they are questions about request and response shapes.

**Neither is payment code**, and neither posts to the ledger. They are instruments.

---

## 4. Andy's three actions, in order

| | Action | Time |
|---|---|---|
| 1 | Paste the probe URL into Settings → Webhooks, subscribe **all** payment and refund and settlement events, save. Copy the webhook secret it generates into the staging secrets (`npm run secrets:set`, one command, printed for you) | ~10 min |
| 2 | Make **one** test-mode UPI payment against a test order the script creates, and **let a second one expire without paying it** — that second one is the only way to learn row 3 | ~20 min, most of it waiting |
| 3 | Run `node scripts/probe-razorpay.mjs` with the test keys in the environment, and paste the output back | ~5 min |

**Total: about 45 minutes**, of which roughly half is waiting for a deliberately-unpaid collect
request to expire. That waiting can happen in the background — start action 2 first, then do
action 3 while it expires.

Everything after that is mine: reading the recorded events, writing the seven answers into
`docs/payments-design.md` §12, and closing `E19-07`.

---

## 5. What this sitting is NOT

- **Not scenario #40.** The live-handset UPI intent happy path (`docs/payments-design.md` §14)
  is a separate, live-mode exercise at release time, and it must never be simulated. This
  sitting is test mode and is about protocol facts.
- **Not a decision meeting.** Every question here has a factual answer that Razorpay's servers
  already know. Nothing on this page needs Andy's judgement — only his credentials and one
  phone.
- **Not blocking step 1 or step 2.** The ledger and the remaining schema are being built
  meanwhile, exactly as `docs/e06-build-plan.md` §3 orders them. Step 5 blocks step 6, not the
  work before it.
