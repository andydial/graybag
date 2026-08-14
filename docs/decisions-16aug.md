---
title: Decisions taken during the unattended launch run — 16 August 2026
status: living. Written as the run proceeds, per Andy's instruction not to stop and ask.
---

# Decisions — unattended launch run, 2026-08-16

Andy, 2026-08-15: *"Do not ask me questions. Where you would ask, make the call, write it in
`docs/decisions-16aug.md` with your reasoning, and keep going. If something blocks you, skip it,
note it, move to the next item."*

Target: production live, mandatory parent update 19 Aug, **iOS submitted to Apple by EOD 16 Aug**.

---

## BLOCKERS — read these first

Two of them stop roughly half the list, and neither is something I can work around by making a
call. Both were checked rather than assumed.

### B1 — `~/.graybag-secrets/prod.env` does not exist

```
$ ls ~/.graybag-secrets/
graybag-upload.keystore
graybag-upload.keystore.bak
```

That directory holds the Android upload keystore and nothing else. There is no `prod.env`, and no
file of that shape anywhere under `$HOME` or in the repo. I did not look inside the keystore and
have printed nothing.

**Blocks:** every Edge Function secret on production, the Razorpay live key/secret/webhook secret,
and any build that points at production.

### B2 — there is no production Supabase project

```
Alpha-Prep        ap-northeast-2
Dubbaa            ap-southeast-2
dubbaa-staging    ap-south-1
graybag-staging   ap-south-1   (linked)
```

`docs/environments.md` §1 describes production as "Supabase project, Mumbai `ap-south-1`
(`E01-05`)". **It has never been created.** So "apply every migration to the prod project in
order" has no target.

I did **not** create one. Creating a production project is a credentialed, billable, one-way act
that pins an organisation, a region, a database password and a project ref that then appear in
every subsequent config — and `E01-05` is Andy's task. Guessing those and having them be wrong is
substantially worse than the delay, because the wrong ones get baked into a shipped binary.

### What B1 and B2 together mean for the 16 Aug iOS deadline

**An iOS build pointing at production cannot be produced today.** The `production` EAS environment
would need `EXPO_PUBLIC_SUPABASE_URL` and the anon key of a project that does not exist. A build
submitted with staging values in it would be worse than a late one: it would take real parents'
real money against a test-mode Razorpay account.

What I have done instead is get everything that does **not** need those two facts to a state where
the build is a single command once they exist — see D4 and D6.

---

## D1 — Staging deploy (item 1): already done, verified rather than repeated

`0052`–`0054` and `cancel-order` were deployed by the `Deploy to staging` workflow on the merge of
PR #61, before this run began. Verified against the live project rather than trusting the workflow:

- `supabase migration list --linked` → local and remote agree through `0054`.
- `supabase functions list` → `cancel-order` **ACTIVE**, version 1.
- **Schema cache**: `cancellation_closes_at` and `cancellation_allowed` resolve as computed
  columns over REST, and `cancel_order` / `record_refund` answer with their own refusal hints
  (`not_found`, `payment_not_found`) rather than "function does not exist". A bogus column in the
  same query still returns `42703`, which is the negative control that makes the positive result
  mean something.

**One finding worth carrying into the smoke test:** every order currently on staging has
`config_snapshot = {}` and therefore reads `cancellation_closes_at: null` — they are seed and
probe rows, not `create_checkout` output. `platform_config` has
`customer_cancellation_allowed = true` and `customer_cancellation_cutoff_minutes = 0`, and
`resolve_effective_config` for Amity returns both, so **a freshly placed order will be
cancellable**. Do not read the old rows as evidence the feature is broken.

---

## D2 — E06-08 (partial refunds) was built before the scope change, and is parked unmerged

The instruction not to build partial refunds arrived after they were built and green: `0055`,
`post_refund_reversal`, a proportional `issue_credit_note`, and `partial_refund.test.sql` with 28
assertions passing.

**Decision: parked, not deleted, not merged.** `git stash` on branch `e20-53-policy-v3`, message
`E06-08 partial refunds (out of scope 16 Aug)`.

- Merging it contradicts a direct instruction and adds a money path to a launch week.
- Deleting tested, working code because the order of two messages happened to be what it was is
  waste, and the reasoning in that migration's header is the expensive part.

**It changes shipped behaviour, so it must not be merged casually later**: it replaces
`reverse_ledger_transaction` with a proportional posting for *full* refunds too, and re-keys
`issue_credit_note` from the invoice to the refund. Two assertions in `record_refund.test.sql`
fail against it by design. Whoever picks it up should read `0055`'s header first.

Partial refunds therefore remain **refused** in production, with hint `partial_refund_unsupported`
and a loud `console.error` naming the refund id. That is the `0054` behaviour and it is deliberate:
a wrong credit note is immutable under §13.2.

---

## D3 — E20-52 and the re-acceptance gate: done, and the premise was not what it looked like

Shipped in PR #62 (`E20-53`). §7A now publishes **Grievance Officer, GrayBag Solutions Private
Limited, `support@graybag.com`**.

**The re-acceptance premise did not apply to this document.** Andy's instruction assumed changing
the privacy policy re-triggers acceptance. Checked on staging:

- `policy_version` holds three rows — `child_data_notice` v1, `self_data_notice` v1 and v2. There
  is **no `privacy_policy` row at all**, so the privacy policy is rendered as a document and is
  not in the acceptance system.
- **No row anywhere sets `blocks_ordering = true`**, so the gate has never had anything to fire on.
- `user_policy_acceptance` holds **zero rows**.

So the change re-prompted nobody — cheaper than expected, and it also means the edit itself could
not exercise the gate. The gate was therefore exercised directly, which is what the instruction
actually wanted: `policy_reacceptance.test.sql` publishes a blocking v1, accepts it as the parent
through RLS, publishes v2, and asserts the same parent is **pending again**, then accepts and
clears. 15 assertions, second parent present so a leak between users cannot pass.

**`E20-55` was found doing it and is not fixed:** `0001`'s own comment says order creation checks
for a matching acceptance before letting an order through. `create_checkout` does no such check —
the gate is client-side only. It cannot bite today because nothing sets `blocks_ordering`, which
is why it has been invisible. Filed, not fixed: the fix belongs inside `create_checkout`'s
transaction and that is not a change to make in a launch week on a path that cannot currently fire.

---

## D4 — Force-update gate: server-side, and it does not depend on production existing

This is the item Andy called *"what makes the 19th update mandatory in practice"*, and it is
buildable without B1 or B2 — the minimum version lives in `platform_config`, which every
environment has.

Decisions taken, recorded because each is a judgement rather than a reading:

1. **The floor is data, not a deploy.** A constant in the app cannot raise the floor for a build
   already on a phone, which is exactly the population it exists to control.
2. **It is advisory at the API boundary and blocking in the app**, not the reverse. A server that
   hard-refuses every call from an old build turns "please update" into an app that appears
   broken, and the 4.0.0 cutover is precisely when a parent is most likely to have a stale build
   mid-order. The endpoint reports; the app blocks.
3. **Compared numerically, part by part**, reusing `compareVersions` rather than a second
   implementation — `E20-50` is the entry about `'9' > '10'` under text ordering silently
   recording consent against superseded wording, and a version floor has the same failure.
4. **A missing or unparseable client version is NOT treated as too old.** The safe direction here
   is to let them through: a parent locked out by a header we failed to send has no way to
   recover, and the population that can reach this endpoint at all is by definition running a
   build that talks to us.

See `docs/decisions/` for the permanent record; this is the run-time reasoning.

---

## D5 — The alert: one email, no platform

Per instruction. `payments-drain` already returns a `stuck` count and logs at error; nothing reads
either. The alert sends to `support@graybag.com` when `stuck > 0` or a money path has failed twice,
and does nothing else.

**It is deliberately not idempotent-per-incident beyond a day key.** A daily dedupe key means a
stuck payment produces one email a day rather than one per drain — hourly cron would otherwise
send 24 identical emails and train everyone to ignore them.

---

## D6 — Version 4.0.0 and the store submissions

Config prepared; submission blocked on B1/B2.

- `4.0.0` against the live `3.7.0` listing, per instruction.
- **`E17-33` is still open and I have not guessed it.** The live Play `versionName` was never read,
  and the handover is explicit that copying the App Store's `3.7.0` across is the guess that task
  exists to prevent. `versionCode` comes from `LIVE_PLAY` and is incremented from the known floor.
- **A production build must be unable to reach a test-mode Razorpay key.** `packages/shared/src/env.ts`
  already refuses a `rzp_live_` key outside production (`EN2`); the reverse — a `rzp_test_` key
  *inside* production — is now asserted too, because that is the direction that takes real money
  against a test account and it was not covered.
