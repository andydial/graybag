---
title: Cutover weekend runbook — Bubble → new stack
status: DRAFT — operational plan. Depends on two dress rehearsals (E16-09, E16-10) having run, and on the open questions in §11 being answered. This document is E17-08.
sources: docs/decisions.md (R1–R5, U2, L4, D15), docs/dpdp-compliance.md §8 ([DP-03]), docs/data-model.md §4 ([DM-11]), docs/order-lifecycle.md §8–§10, docs/payments-design.md §8; planning/backlog E16 (data migration), E17 (release & cutover), E03 (identity/auth)
owner: Andy (incident lead / go-no-go authority for every gate)
---

# Cutover weekend runbook

This is the timed, step-by-step plan for moving GrayBag off the legacy Bubble app onto the new
stack (Supabase + Expo app + Netlify web), in one weekend, with a break-glass rollback at every
phase. It is `E17-08`, and it is produced by the second dress rehearsal (`E16-10`): **do not run
the real cutover until both rehearsals (`E16-09`, `E16-10`) have run clean against
pseudonymised data (`E16-13`), timed end to end.**

> **How to read the clock.** `T-0` is the moment ordering is frozen on Bubble (Friday night).
> Times before it are `T-2d`, `T-1d`, etc.; times after it are `T+2h`, `T+18h`, etc. Every time
> is **IST (Asia/Kolkata, +05:30, no DST)** — the only clock the business runs on. Wall-clock
> examples assume the recommended Friday-night → Monday-morning window (`[CO-01]`); adjust the
> absolute times if Andy picks a different window, but keep the relative offsets.

> **The default at every gate is STOP.** GrayBag is one person on the weekend (`[CO-07]`). Each
> go/no-go check below names a **rollback trigger**; if the check is not unambiguously green, the
> action is to *not proceed* and, past the point of no return (§5), to execute that phase's
> rollback. A gate you are unsure about is a failed gate.

---

## 0. Roles

| Role | Who | On the weekend |
|---|---|---|
| **Cutover lead / go-no-go authority** | **Andy** | Signs every gate. Cannot be delegated. Also the DPDP incident lead if anything goes wrong (`docs/dpdp-compliance.md` §8.5) |
| **Technical operator** | Claude Code, or a contractor | Runs the migration scripts, the validation suite, the reconciliation queries, the DNS change |
| **Payments reconciler** | Andy (Razorpay dashboard is credentialed to him) | Confirms Razorpay live keys, works the manual in-flight-payment worksheet (§4) |
| **Comms** | Andy | Sends the pre- and post-cutover customer comms (§8) |
| **Support (first 48h)** | Per `E17-12` (owner:andy) | Answers "I can't log in" — most of which is the OTP re-login (§8) and the manual-review queue (§6.4) |

There is no deputy (`[DP-01]`, `[CO-07]`). The compensating control is that this runbook fails
safe: rollback-by-default.

---

## 1. Preconditions — nothing starts until every one of these is true

These are checked in the **week before** the weekend, not on the night. If any is red, the
weekend is postponed — a slipped date is cheaper than a failed cutover.

| # | Precondition | Evidence | Owner |
|---|---|---|---|
| P1 | Closed beta exit criteria met (`E17-07`): ≥40 real orders / ≥8 users, zero unreconciled payments, ≥97% payment success, ≥99.5% crash-free, zero signature failures, ≥1 full + ≥1 partial refund end to end | Beta report | Andy |
| P2 | **Both dress rehearsals passed** (`E16-09`, `E16-10`), timed, against pseudonymised data (`E16-13`); the validation suite (`E16-08`) was green on rehearsal #2 | Rehearsal reports with wall-clock timings | Operator |
| P3 | Migration total wall-clock time from rehearsal #2 **fits inside the freeze window** with ≥50% headroom | Rehearsal #2 timing vs `[CO-01]` window | Operator |
| P4 | **Point-in-time-restore of the new Supabase project rehearsed** (`E16-18`) and restore time is inside the rollback SLA | Restore rehearsal log | Operator |
| P5 | All E.164 phone normalisation done (`E16-14`); duplicate/unparseable/missing-number report reviewed; ambiguous matches parked for manual review (`E03-11`, `[DM-11]`) | `E16-14` report | Andy + operator |
| P6 | Users with **no usable mobile number** (`E16-12`) identified and contacted by a non-OTP channel — they cannot receive an OTP and must not be silently stranded | Contact log | Andy |
| P7 | Legacy prepaid/wallet balances resolved (`E00-18`, `E16-16`, `[CO-05]`): either "none exist" confirmed, or the opening-ledger-credit migration is built and validated | Balance decision | Andy |
| P8 | Razorpay **live** keys configured in prod; webhook registered against the prod URL; a live test payment captured and reconciled during beta | Beta reconciliation | Andy |
| P9 | Store builds submitted and **approved/ready** (`E17-02`…`E17-06`); the OTA channel works. iOS phased release and Android staged rollout configured but **not yet started** | Console screenshots | Andy |
| P10 | Customer comms drafted and approved (`E17-11`, §8 below); send lists built from the normalised phone/email data | Approved drafts | Andy |
| P11 | **[DP-03] decided**: the legacy public `Order`/`Child` exposure has been assessed with legal (`E20-01`, `E20-23`), and the plan to lock the public Bubble Data API at freeze (`[CO-06]`, §3) is agreed | Legal note | Andy + lawyer |
| P12 | Rollback plan (§9) read and understood; DNS TTL on `graybag.com` **lowered to 300s at least 48h before** so a DNS rollback propagates fast | DNS record | Operator |

**Gate G0 — GO / NO-GO to schedule the weekend.** All of P1–P12 green. Owner: Andy. If any is
red: postpone. This gate is the last cheap decision point — everything after it costs a weekend.

---

## 2. Timeline overview

| Phase | When | What | Reversible? |
|---|---|---|---|
| **A. Pre-flight** | `T-2d` → `T-0` | Comms sent, DNS TTL lowered, final backups, Razorpay confirmed | Fully |
| **B. Freeze** | `T-0` (Fri ~22:00) | Bubble ordering + payments disabled; public Data API locked | Reversible (re-enable Bubble) |
| **C. Drain** | `T-0` → `T+2h` | Let Bubble in-flight payments settle/fail; snapshot Bubble data | Reversible |
| **D. Migrate** | `T+2h` → `T+8h` | Run migration into prod; images re-hosted | Reversible until Gate G3 |
| **E. Validate** | `T+8h` → `T+12h` | Full validation suite + reconciliation | Reversible until Gate G3 |
| **F. Point of no return** | `T+12h` (Gate G3) | Decide: cut over, or roll back | **The line** |
| **G. Cut over** | `T+12h` → `T+14h` | DNS to new web; new app "live"; smoke tests | Hard to reverse (see §9) |
| **H. Soak** | `T+14h` → `T+56h` (Sat 12:00 → Mon 06:00) | Monitored quiet period, no ordering pressure (weekend) | Roll forward preferred |
| **I. Open** | `T+56h` (Mon 06:00) | Ordering opens before the first weekday cutoff; comms #2 sent | Roll forward |
| **J. Phased rollout** | Mon → +7d | iOS phased / Android staged, with the halt button (`E17-10`) | Halt/revert (Android); OTA (iOS) |
| **K. Decommission** | +30d | Cancel Bubble, archive export (`E17-13`) | — |

The weekend is chosen deliberately (`[CO-01]`, proposed decision R6): schools in the current
cities do not serve on Sat/Sun, so **no `service_date` falls inside the freeze**. That is what
shrinks the in-flight problem to "future-dated paid orders and pending payments" (§4) instead of
"live orders being cooked right now".

---

## 3. Phase A + B — Pre-flight and freeze

### A. Pre-flight (`T-2d` → `T-0`)

| Time | Step | Who | Check |
|---|---|---|---|
| `T-2d` | Send **comms #1** (§8.1) — "you'll log in once with an OTP after this weekend" | Comms | Send count matches the list; bounces logged |
| `T-2d` | Confirm DNS TTL on `graybag.com` is 300s (lowered ≥48h ago, P12) | Operator | `dig graybag.com` shows TTL ≤300 |
| `T-1d` | Freeze the code: tag the exact migration script + schema versions that rehearsal #2 used. **No code changes after this point** | Operator | Git tag matches rehearsal #2 |
| `T-1d` | Take a **full Bubble data export** and archive it (this is also the start of `E17-13`'s archive) | Operator | Export row counts logged |
| `T-2h` | Confirm Razorpay live keys, webhook registration, and that the in-flight reconciler and daily reconciliation jobs are scheduled but the app is not yet public | Andy | A live test capture reconciles |
| `T-1h` | Operator + Andy both online. Open the incident/timeline log (append-only) | Both | — |

**Gate G1 — GO / NO-GO to freeze.** Andy confirms: comms #1 sent, backups taken, code frozen,
both people available, rollback plan (§9) in hand. NO-GO → slip to next window.

### B. Freeze (`T-0`, Friday ~22:00 IST — after the last weekday cutoff has passed)

Do these in order:

1. **Disable Bubble order-create and payment workflows.** This is the real freeze — no new
   orders, no new charges. (`[CO-02]`: if Bubble cannot be made fully read-only, disabling these
   two workflows is the minimum viable freeze.)
2. **Lock the public Bubble Data API** so the legacy public `Order`/`Child` exposure
   (`E00-04`, `E00-05`, `[DP-03]`) stops being world-readable **now**, not in 30 days. Keeping
   Bubble as break-glass (`R3`) must not mean keeping the exposure live (`[CO-06]`). Data stays
   readable to authenticated admin for support; it stops being readable to `anon`.
3. Put a **maintenance banner** on the Bubble app / `graybag.com`: "GrayBag is upgrading this
   weekend. Ordering reopens Monday morning. You'll sign in once with a text-message code."
4. Record `T-0` wall-clock in the timeline log.

**Rollback for Phase B is trivial:** re-enable the Bubble workflows and remove the banner. Bubble
is untouched as a data store. Use this freely if pre-flight surfaced anything.

---

## 4. Phase C — Drain the in-flight money (`T-0` → `T+2h`)

This is the hard case the runbook exists for. At freeze there are two kinds of live money on
Bubble, and **neither is migrated as live state** (`[CO-03]`, proposed decision R7 — mirrors
`L4`: never inherit a half-open payment attempt):

**(a) Bubble payments in flight** (e.g. a UPI collect request still pending at `T-0`).
- Let them **settle or fail on Bubble** during a fixed **90-minute drain window** (`T-0` →
  `T+90m`). Do not migrate a pending attempt.
- At `T+90m`, pull the Razorpay dashboard (Andy) and build the **in-flight worksheet**: every
  payment created before `T-0` whose final state is not yet settled/failed. Each row is handled
  by hand after cutover — settled → its order migrates as `paid`; failed → nothing owed;
  still-pending at snapshot → flagged for manual reconciliation (do **not** auto-migrate).
- This worksheet is short by design (a weekend freeze after cutoff means few live attempts).

**(b) Future-dated paid Bubble orders** — paid on Bubble for a service date *next week*.
- These are a real obligation. Per `[CO-04]` (needs Andy's decision), the plan is to migrate
  them as real `paid` orders in the new schema so the kitchen packing list includes them, with
  the money represented as an opening-ledger posture (no second charge). The fallback is
  refund-and-reorder on Bubble before snapshot.
- Whichever Andy chooses, it must be settled at Gate G0 (P7-adjacent) — it is not a weekend-night
  decision.

**Snapshot.** At `T+2h`, take the **migration snapshot** of Bubble data (the frozen dataset the
migration reads from). Everything migrated is as-of this instant. Record the snapshot timestamp.

**Rollback for Phase C:** still trivial — nothing has been written to prod yet. Re-enable Bubble
(Phase B rollback) and the drained payments simply remain on Bubble.

---

## 5. Phase D + E — Migrate and validate (`T+2h` → `T+12h`)

### D. Migrate (`T+2h` → `T+8h`)

Run the frozen migration script (`E16-01`…`E16-07`, `E16-17`) into the **prod** Supabase project,
in the order the rehearsals established:

1. Reference/geography, kitchens, schools, `school_class`, break times (using the **hand-verified
   break-time lookup**, `E16-15` — the legacy db values are wrong and must never be trusted).
2. `app_user` rows, **pre-created against `auth.users` with phone set and no password**
   (`[DM-11]` option A), `migration_source = 'bubble_migrated'`, `claimed_at` null. Ambiguous or
   duplicate phone matches are **not** auto-created — they go to `migration_review` (`E03-11`).
3. Recipients + `guardian_link`, reconciling the two legacy parent-child mechanisms into one and
   **reporting conflicts rather than guessing** (`E16-03`, `D10`).
4. Menus, dishes, `dish_allergen`; **re-host all dish images** (`E16-05`) — Bubble CDN URLs die;
   report any that cannot be sourced.
5. Full **order history** with line items, totals and dates preserved (`E16-04`), status mapped
   on db_value to a **legal v1 order status only — never `draft`**. `draft` is unreachable in v1
   (`docs/order-lifecycle.md` §3.2), invariant **I12** asserts no `draft` order exists (also
   asserted in `docs/payments-design.md` §8.3), and the §4.4 trigger permits `NULL→draft` only
   for an `admin` actor holding `orders.create_on_behalf` — not for the `system` actor this
   backfill runs as. A `draft` row would therefore be rejected at insert, or trip I12 on the
   first nightly run. Legacy orders are historical and terminal, so map a completed/paid legacy
   order to **`paid`**, a legacy-cancelled order to **`cancelled`** (with the matching
   `cancel_reason_code`), and — only if any legacy order was genuinely awaiting payment at
   snapshot — to **`pending_payment`**. Do **not** emit `draft`. The migration must run with
   `app.actor_type = 'system'` set around the backfill, or the order-status transition trigger
   rejects every insert (`docs/order-lifecycle.md` §4.4).
6. **Opening ledger credits** for any legacy prepaid/wallet balances (`E16-16`) and for the
   future-dated-paid-order posture (§4b), if that path was chosen.

Throughout: **all money is integer paise.** No float touches any total. **No real child data goes
into any log, Sentry, or this runbook** (non-negotiable #4).

### E. Validate (`T+8h` → `T+12h`)

Run the **validation suite** (`E16-08`) and record every number in the timeline log:

| Check | Pass condition |
|---|---|
| **Row counts** | Bubble→new counts match for users, recipients, guardian links, schools, kitchens, menus, dishes, orders, order lines (within the documented, explained delta for deliberately-left-behind test/junk data, `E16-07`) |
| **Financial totals** | Σ order totals, Σ line totals, Σ opening ledger credits reconcile to the Bubble export **to the paise** |
| **Sample field-by-field** | A sample of orders compared field-by-field Bubble vs new (`E16-08`) — dish names, prices, dates, recipient, break time, status all match |
| **Break-time correctness** | Spot-check that migrated orders landed in the *right* break using the `E16-15` lookup, not the wrong legacy label |
| **Ledger balances** | Every `ledger_transaction` sums to zero (I10); every wallet balance equals its ledger sum (I8, `[DM-04]`) |
| **Auth default-deny** | The `authorization.test.sql` suite is green; the `anon`-sees-zero-rows assertion passes (`[AZ-03]`) — the single most important property, and the exact thing the legacy app got wrong |
| **No orphans** | No order without a customer, no line without an order, no recipient without a live guardian link |
| **Reconciliation baseline** | Tier-2 daily reconciliation (`E06-11`) run for the beta+cutover window shows **zero unexplained breaks** (`E17-18`) — no B1/B2/B4/B5/B6 |
| **Manual-review queue sized** | `migration_review` row count is known and worked (or scheduled to be worked Monday, §6.4) |

**Gate G2 — validation clean?** Every check above green. This gate is still fully reversible:
nothing customer-facing has changed, and the prod project can be wiped and re-migrated, or the
whole thing abandoned. NO-GO → investigate; if not fixable inside the window, roll back to Bubble
(Phase B rollback) and reschedule.

### F. Point of no return — Gate G3 (`T+12h`)

> **This is the line.** Before G3, rollback is "re-enable Bubble". After G3, DNS has moved and
> customers may have logged into the new app and placed orders — rolling back now means the §9.2
> reconvergence problem. **Do not pass G3 unless G2 was unambiguously green and Andy signs it.**

**Gate G3 — GO / NO-GO to cut over.** Andy confirms: G2 green, reconciliation baseline clean,
manual-review queue understood, store builds ready, comms #2 ready to send, rollback SLA still
achievable. Default is **NO-GO → roll back to Bubble.**

---

## 6. Phase G + H + I — Cut over, soak, open

### G. Cut over (`T+12h` → `T+14h`, Saturday afternoon)

1. Point `graybag.com` **DNS at the new Netlify site** (marketing + admin/kitchen/school web).
   TTL is 300s (P12) so it propagates within minutes.
2. Flip the new app from beta to **generally reachable** (the store builds are approved but
   rollout starts Monday, §J — this weekend is DNS + web + the app being functional for anyone
   who has the beta build or updates).
3. Confirm the **webhook** is receiving live Razorpay events on the prod URL and the daily +
   in-flight reconcilers are running.
4. **Smoke test on prod** (not test mode), each recorded in the timeline log:
   - Fetch `GET /menu/version?school=X` — returns fast.
   - Log in as a migrated test account by OTP — the account **claims** (`claimed_at` set).
   - Place one real small order end to end: checkout → Razorpay capture → `paid` → invoice
     issued (gapless number) → ledger balanced → confirmation notification with pickup code.
   - Execute one refund to wallet; confirm the balance updates and the ledger reconciles.
   - Confirm no tier-S/P data appears in any log line or Sentry event (spot check).

**Gate G4 — smoke tests clean?** All green. NO-GO → §9.2 rollback (this is the expensive one;
weigh it against rolling forward with a known, contained bug).

### H. Soak (`T+14h` → `T+56h`, Saturday afternoon → Monday 06:00)

The weekend is the soak. No school serves, so there is no ordering pressure. Monitor:
- Sentry error rate, webhook signature failures (any is a page — `PY3`, `E15-05`).
- Reconciliation: no new breaks.
- Any OTP-login failures reported by the handful of people who try over the weekend.

Fix forward via OTA for JS-level issues. A schema-level problem discovered here is the argument
for §9.2 rollback while it is still Saturday.

### I. Open (`T+56h`, Monday 06:00 — before the first weekday cutoff)

1. **Work the `migration_review` queue** (§6.4) so ambiguous-match families can log in.
2. Confirm the kitchen packing list for Monday/the week is correct, **including any migrated
   future-dated paid orders** (§4b).
3. Send **comms #2** (§8.2) — "we're live, sign in with a text code".
4. Watch the first real cutoff and the first wave of new orders closely.

**Gate G5 — open ordering?** Kitchen confirms it can see and fulfil the day's orders;
reconciliation clean; manual-review queue worked or in hand. NO-GO → hold ordering, keep the
maintenance banner, and either fix-forward fast or invoke §9.2.

### 6.4 The manual-review queue (operational, easy to forget)

`E03-11` blocks auto-claim on any ambiguous/duplicate phone match, so a real number of families
land in `migration_review` and **cannot log in until a human resolves them**. This is not a code
path on the weekend, it is a task with a person attached (`E17-17`). Budget Monday
morning for it, and give support (`E17-12`) a script for "I can't log in" that checks this queue
first.

---

## 7. Phase J + K — Phased rollout and decommission

### J. Phased store rollout (Monday onward, `E17-10`)

Start iOS Phased Release (7 days) and Android staged rollout 5% → 20% → 50% → 100%. **Halt
immediately** (Android supports halt-and-revert; iOS has no true rollback, so an iOS fix is a new
build 24–48h or an OTA JS fix) on any of:
- any webhook signature-verification failure;
- payment success rate below 95% over any rolling hour;
- >20 unhandled errors/hour attributable to the new build;
- any reconciliation mismatch.

### K. Decommission (`+30d`, `E17-13`)

After 30 days of the new stack being stable, and after the `[DP-03]`/`[CO-06]` exposure is
confirmed closed (the public Data API was locked at freeze, but confirm nothing re-opened it):
export and archive **everything** from Bubble, then cancel the Bubble subscription (`R3`).

---

## 8. Customer communications — the one-time OTP re-login (`E17-11`)

**Why every user must do this.** Bubble cannot export password hashes (`U2`), so there is no way
to carry anyone's password across. Login on the new stack is **phone + OTP** (`U1`), matched on
the normalised E.164 number (`E03-11`). So every existing user re-authenticates exactly once,
and the whole risk is that they don't *know* they must — they try an old password, it fails, and
they churn. These comms exist to prevent that. They are drafts for **Andy to approve and send**;
he owns the channel (`E17-11`).

**Channels.** Email (where we hold one), SMS/push where a token or number is usable, the app
store "what's new" text, and an in-app login-screen explainer. Users with **no usable mobile
number** (`E16-12`, P6) get a **separate manual outreach** — they cannot receive an OTP at all,
so a mass "sign in with a code" message would strand them.

**No child data in any message** (non-negotiable #4). Address the adult account holder only.

### 8.1 Comms #1 — before the weekend (`T-2d`)

> **Subject: GrayBag is getting an upgrade this weekend**
>
> Hi,
>
> This weekend we're moving GrayBag to a faster, more secure app. Here's the only thing you need
> to know:
>
> **The next time you open GrayBag, you'll sign in once using a code we text to your mobile
> number — no password needed.** Your account, your children's details and your full order
> history all come across automatically.
>
> - Ordering will pause from **Friday night** and reopen **Monday morning**.
> - Please make sure we have your current mobile number. Reply to this message if it has changed.
> - You do **not** need to create a new account or re-enter anything.
>
> If you have any trouble signing in after the weekend, just reply here and we'll sort it out.
>
> Thanks,
> The GrayBag team

### 8.2 Comms #2 — when ordering reopens (`T+56h`, Monday)

> **Subject: GrayBag is live — sign in with a text code**
>
> Hi,
>
> The new GrayBag is ready. To sign in:
>
> 1. Open the GrayBag app (update it from the App Store / Play Store if prompted).
> 2. Enter your mobile number.
> 3. We'll text you a 6-digit code — type it in (on most Android phones it fills in
>    automatically).
>
> That's it — no password. Everything you had before is already there: your children, your
> saved details and your order history.
>
> **Didn't get the code?** Check the number is the one you registered with, wait 30 seconds and
> tap "Resend". Still stuck? Reply to this message.
>
> Thanks for being with us,
> The GrayBag team

### 8.3 In-app login-screen explainer (always on, first login)

> **First time on the new app? Just sign in with your number.**
> We've moved GrayBag to a new, more secure system. For security, everyone signs in once with a
> one-time code instead of a password. Enter your mobile number to get started — your account and
> order history are already here.

### 8.4 Support macro — "I can't log in" (`E17-12`)

Internal, not customer-facing. Order of checks:
1. Is the number in the **`migration_review`** queue (ambiguous/duplicate match, §6.4)? → resolve
   the match manually, then the OTP works.
2. Is the number **missing or unparseable** (`E16-12`/`E16-14`)? → this user was on the manual
   list; verify identity out-of-band and set the correct E.164 number.
3. OTP not arriving? → check DLT template status and SMS-provider delivery (`E03-01`, `E03-10`),
   not the user.
4. Never ask for or store any child data to "verify" a caller (`docs/dpdp-compliance.md` §7.4).

---

## 9. Rollback plan, per phase

The default at every gate is to invoke the rollback below rather than to push through.

### 9.1 Before Gate G3 (point of no return) — cheap rollback

For **Phases B, C, D, E**: nothing customer-facing has changed and Bubble is intact.
- **Trigger:** any precondition regressed, migration errors that can't be fixed in-window,
  validation (§5.E) not clean, or simply running out of window.
- **Action:** (1) wipe/reset the prod Supabase data (it was empty of real traffic — safe);
  (2) re-enable the Bubble order-create and payment workflows; (3) re-open the public site if it
  was banner-locked; (4) leave the public Data API **locked** anyway (`[CO-06]` — the exposure
  should not come back even on rollback); (5) send a short "we've rescheduled the upgrade; keep
  using GrayBag as normal" note. **No customer lost anything. No money moved on the new stack.**

### 9.2 After Gate G3 (DNS moved, customers may have transacted) — expensive rollback

For **Phases G, H, I**: some customers may have logged in and placed real orders on the new
stack. Rolling back to Bubble now means those orders and payments exist only on the new stack.

- **Trigger:** a defect that makes the new stack unsafe to keep live — money moving wrongly,
  auth default-deny broken (`anon` can read rows), reconciliation breaking (B4/B5), or the
  kitchen unable to fulfil.
- **Action, in order:**
  1. **Stop the bleeding first**: disable checkout on the new stack (feature-flag / take the
     payment Edge Function offline) so no *further* orders are created while you decide. This is
     containment and it is also DPDP evidence-preservation if the trigger was an exposure
     (`docs/dpdp-compliance.md` §8.4, `C7`) — **do not delete logs or data**.
  2. **Freeze and export** every new-stack order, payment, refund and ledger entry created since
     G4. This is the reconvergence worksheet.
  3. Point DNS **back to Bubble**; re-enable Bubble workflows.
  4. **Reconcile the gap by hand**: for each new-stack order, either honour it (fulfil from the
     kitchen manually and leave the money where it is) or refund it on the new stack — never
     charge again. Any Razorpay capture on the new stack is real money and the customer keeps
     their food or their refund.
  5. Send an honest comms: "we hit a problem and rolled back; if you ordered this weekend your
     order still stands / has been refunded — here's what to do."
- **This is why G3 is a hard gate.** The whole design pushes the decision to *before* DNS moves,
  where rollback is free.

### 9.3 Data-restore rollback (new stack corrupted, not abandoned)

If the new stack is the destination but its data got corrupted mid-migration:
- Restore the new Supabase project to the **pre-migration point-in-time snapshot** (rehearsed in
  P4 / `E16-18`), then re-run the frozen migration from the Bubble snapshot (§4). Because the
  Bubble snapshot is immutable, the migration is deterministic and re-runnable.
- This is a roll-*forward-again*, not a roll-back-to-Bubble, and it only applies before G3.

### 9.4 Breach during cutover — the other rollback

If the trigger is a **data exposure** (an RLS regression, a public bucket, the legacy Bubble
exposure being noticed), this is a DPDP incident and the clock starts at the **first credible
signal**, not at confirmation (`docs/dpdp-compliance.md` §8.4, `C7`). Containment (stop the
exposure) comes first, **evidence preservation is part of containment** (no log deletion), and
the T+6h CERT-In / T+72h Board clocks apply. Andy is incident lead. The technical rollback above
runs *alongside* the breach runbook, not instead of it.

---

## 10. The go/no-go gate summary (one table)

| Gate | When | Question | Default if not green |
|---|---|---|---|
| **G0** | Week before | All 12 preconditions (§1) met? | Postpone the weekend |
| **G1** | `T-1h` | Comms sent, backups taken, code frozen, both people online? | Slip to next window |
| **G2** | `T+12h` | Validation suite + reconciliation clean (§5.E)? | Roll back to Bubble (§9.1) |
| **G3** | `T+12h` | **Point of no return** — cut over? | Roll back to Bubble (§9.1) |
| **G4** | `T+14h` | Prod smoke tests clean (§6.G)? | Weigh §9.2 vs fix-forward |
| **G5** | `T+56h` Mon | Kitchen can fulfil; reconciliation clean; review queue in hand? | Hold ordering; fix-forward or §9.2 |

Every gate is Andy's to sign. Every default is the safe one.

---

## 11. Open questions this runbook depends on

All are in `docs/open-questions.md` (`[CO-01]`…`[CO-07]`). The ones that **block scheduling the
weekend**:

| Q | One line | Blocks |
|---|---|---|
| `[CO-01]` | Cutover date and freeze window (recommend weekend / holiday week) | `E17-09` |
| `[CO-02]` | Can Bubble go read-only / what does read-only permit? | `R3` break-glass, freeze step |
| `[CO-03]` | How Bubble in-flight payments are drained (recommend: settle-or-fail on Bubble, don't migrate live) | `E16-01`, `E16-04` |
| `[CO-04]` | Future-dated paid Bubble orders: fulfil on new stack, or refund-and-reorder? | migration shape |
| `[CO-05]` | Do legacy prepaid balances exist? If yes, `E16-16` is a blocker | P7 |
| `[CO-06]` | Is `[DP-03]`'s legacy exposure notifiable; lock the public Data API at freeze | regulatory clock |
| `[CO-07]` | Single go-no-go signer (no deputy) — mitigated by rollback-by-default | none (accepted) |

---

## 12. What a human must check before this is run

1. **Both dress rehearsals have actually happened** (`E16-09`, `E16-10`) and this runbook's
   timings match rehearsal #2's real numbers — the offsets here are planning estimates.
2. **`[CO-01]`…`[CO-06]` are answered** — especially the freeze window, the Bubble read-only
   capability, and the `[DP-03]` exposure decision with legal.
3. **The future-dated-paid-order decision (`[CO-04]`) and the prepaid-balance decision
   (`[CO-05]`)** are made and their migration paths built and validated — these change the
   migration itself, not just the runbook.
4. **The comms in §8 are approved by Andy** and the send lists are built from clean E.164 data.
5. **The rollback SLA in §9.3 is real** — the point-in-time restore has been rehearsed
   (`E16-18`) and fits inside the window.
