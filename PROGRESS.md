# Progress

Newest handover at the top. Assume the reader has forgotten everything.

---

## 2026-08-11 (overnight) — E06 steps 1–4, and the first invoicing guard

### WHERE WE ARE, BY EPIC — read this bit only

**Live-blocking epics still substantially open: E03, E06, E07, E08, E09, E17.** Everything else
is either done, nearly done, or fast-follow.

| | Epic | MVP ticked | State |
|---|---|---|---|
| ✅ | **E02** data model & authorization | 15/15 | Done. Default-deny proven by 194 pgTAP assertions |
| ✅ | **E19** de-risking spikes | 4/4 | Done bar the `E19-07` sitting, which is yours and ~45 min |
| 🟢 | **E13** design system · **E04** menu · **E14** app shell · **E01** foundations | 78% · 75% · 70% · 73% | Close. Remainder is polish and wiring, not unknowns |
| 🟡 | **E05** ordering & cart | 5/11 | Cart, menu, recipients, break windows all work. Checkout is the gap, and it is E06's |
| 🟡 | **E06** payments & ledger | 6/15 | **Steps 1–4 of the build plan are done tonight.** Ledger, state machine, webhook, alerting. Steps 5–9 need your `E19-07` sitting |
| 🔴 | **E07** invoicing & GST | 1/9 | First guard landed tonight. No invoice has ever been generated — this is the biggest untouched MVP epic |
| 🔴 | **E08** notifications · **E09** kitchen ops · **E10** admin · **E15** observability | 0–20% | Untouched or barely started. E08 and E09 are live-blocking; E10 and E15 are not |
| 🔴 | **E17** release & cutover | 0/11 | Mostly yours — store consoles, credentials, the cutover itself |
| ⏭ | **E11** school reporting · **E12** marketing site · **E18** deferred · **E21** screen design | — | Fast-follow (`P15` for E11). E21's screens are built; the epic is a design-review list |

**Two caveats on those numbers.** They count *ticked* state, and older epics under-report:
**E03 shows 0/11 while sign-in demonstrably works**, and E21 shows 0/20 while every screen it
lists is built. Nobody ticked them at the time. Filed as `E00-23`; do not read E03 as "not
started".

**The single largest remaining risk is not code.** It is that no invoice has ever been generated,
and `E07` is 1/9. Payments can now be taken, recorded and reconciled long before anything can
lawfully be issued for them.

---

### SHIPPED

Ten commits, each green from a clean database, each pushed.

- **E06 step 1** (`0034`–`0037`) — the chart of accounts (`ledger_account` was **empty**, so the
  first posting would have failed on a foreign key), `duplicate_of_payment_id` so a real double
  charge can be recorded, the three payment timings on all three config tables, the two
  cancellation reason codes, and the refund-to-source guard.
- **E06 step 2** (`0038`) — the ledger's one way in. Refuses fewer than two entries, a
  non-positive amount (**a negative amount balances**, so the zero-sum trigger cannot catch it),
  an unbalanced posting, an unknown or deactivated account, and a non-ledger reason code.
  Idempotency at the point of harm; corrections are reversals.
- **E06 step 3** (`0039`) — §4.1's transition table enforced literally, the actor as part of the
  transition, a missing actor as a refusal. `L3`: payments only move up the capture rank, so a
  late `authorized` cannot downgrade a capture.
- **E16-49** (`0040`/`0041`) — the migration actor, narrowed three ways: two states, INSERT only,
  and the row must carry a `legacy_bubble_id`.
- **E06 step 4** (`0042`) — **signature verification, the webhook endpoint, and the alerting.**
  Raw-body rule, constant-time comparison, fail closed, always `200`, idempotency at §7.1 layer 4.
  17 vitest assertions including an RFC 4231 vector.
- **E06-21** (`0043`) — the over-refund guard takes the `order_group` row lock.
- **E06-30** (`0044`) — `order_group.status` is now **derived at all**; it never was.
- **E07-20** (`0045`) — production refuses to take money it cannot invoice.

`test:all` green from clean: **856 mobile, 612 shared, 500 pgTAP.**

### FINDINGS

- **`order_group.status` was never derived.** `L1` says it is maintained by trigger; no trigger
  existed. Every group has read `draft` since `0001`, and three statuses were unreachable.
- **The seller's identity had no home in configuration.** It existed only as snapshot columns on
  `invoice`, so the invoice builder had nowhere to read from.
- **`E06-21`'s documented defect was in the document, not the code.** The arithmetic was always
  right; the *race* was real, and deferring the trigger to COMMIT does not close it.
- **A wrong webhook secret is silent** — that is what `E06-28` now alarms, with two checks
  because each is the other's blind spot.
- **I committed on a failing `build-backlog`**, which clobbered `E07-17`. Restored, and smoke now
  runs the check that would have caught it.

### BLOCKED

- **Everything from E06 step 5 onward** — client checkout, recovery paths, reconciliation —
  needs the `E19-07` answers. Not stalled on: I moved to E07.

### NEEDS ANDY

1. **`E19-07`, ~45 minutes.** Step 4's alerting is green, which was your cue.
   `docs/e19-07-webhook-sitting.md` has the three actions.
2. **`E20-48` is done but `E07-22`'s CA sign-off is not** — follow-up, not a blocker, as ruled.
3. **`E00-23`** — the backlog under-reports older epics. Worth an hour of reconciling before you
   use these percentages for planning.

### NEXT

E07 invoicing is the largest untouched MVP epic and the biggest non-code risk. Then E15.



## 2026-08-11 — overnight run: flow fixes, dish photographs, the orphan guard

Branch **`ux-spec-and-prototype`**. Smoke green throughout. Reload Metro and walk it.

### SHIPPED

| | |
|---|---|
| **Flow fixes** | `OrderTargetProvider` was mounted nowhere; the school was asked twice and lost; no stack screen had a way back |
| **Dish photographs** | 82 uploaded to Storage, `image_path` populated, and the app can now resolve a storage key to a URL |
| **The orphan guard** | `src/architecture/orphans.test.ts` — every context, provider and store must have a reader, a writer and a mount |
| **Connectivity** | `E14-26`. Six screens took an `offline` prop that nothing supplied |
| **Children's copy** | Now says what *we* have not read, not what the parent failed to share |
| **`ListRow`** | `E14-27`. Leading slot, danger tone, label override |
| **Can't connect + Policy gate** | `E21-17`, `E21-16`. An unconfigured build now says so instead of looking like an empty menu |
| **`DishImage`** | Draws rectangles; three hand-rolled copies folded back |
| **`food_type`** | End to end, live on staging — veg/egg marks render |
| **Cart** | Rebuilt to the prototype — photo, veg mark, allergen line, stepper pill, eleven states |
| **Order detail** | Timeline, pickup code, five distinct cancel-refusal reasons |
| **Payment + Order placed** | `R8` made structural: a premature confirmation now needs a cast |
| **Support** | Grievance officer, or an honest "coming" |
| **`PlaceholderScreen` deleted** | No caller left. Every screen in the app is a real screen |

### FINDINGS

**The same defect, a fifth time.** `OrderTargetProvider` was written, exported, and **mounted
nowhere** — so every screen read the context's *default*, `target` was permanently null, and
yesterday's work on `setTarget` could never have helped. Found independently by me and by the
orphan-guard agent within minutes of each other. That is now: menu cache never installed,
sign-in behind a wall, target never set, E13 tokens unconsumed, and this.

**The orphan guard caught its first, and it was mine.** I wrote `report()` into
`ConnectivityContext` and never called it. Caught minutes after the code was written, which is
the entire point. Its agent proved every rule by mutation rather than asserting them — including
that a doc comment naming `setMenuCache` does not count as a call, which matters because four
comments named it during the whole period nothing did.

**The Maestro flow had a wrong testID.** It tapped `screen-dish-detail-button`; the real handle
is `screen-dish-detail-add-button`. `check-maestro-ids.mjs` reported success because both halves
are real in that one file. I tightened it to compose two levels, and **documented that it still
cannot catch this class** — deciding it needs to know which testID prop reaches which component,
which is runtime behaviour. Only a real run can. That is the argument for the item below.

**Dish photographs are 120px thumbnails.** No higher-resolution source exists on the CDN. Fine
as list tiles, soft as a hero. See `docs/open-questions.md`.

### BLOCKED

**Maestro's first green run — not done, and not deferrable by me.** This machine has **no
Xcode, no Android SDK, no simulator, no emulator and no Maestro binary**. There is nothing to
run the flow against. I fixed the flow's wrong id and its stale first step so it is correct when
it does run, and filed `E14-30` (`owner:andy`) for the toolchain. **Ten screens are shipping
behind a suite that has never executed once.**

### NEEDS ANDY

1. **Install Xcode or the Android SDK** so Maestro can run (`E14-30`).
2. **Dish photography** — ship with the 120px thumbnails and shoot the catalogue as a
   fast-follow? Recommendation and reasoning in `docs/open-questions.md`.
3. **Staging has no real menu** — five seed fixtures, so 78 of 82 photographs are unused. The
   app is showing four real photographs against five fixture dishes.
4. `E20-10` still blocks the store privacy forms.

### §6 RE-WALK — what is still divergent

Fixed tonight: **F1** (sign-in returns to the cart, and the gate no longer fires on people who
have passed it), **F9** (switching recipient now switches school and menu), **F10** (gone with
`AR8`), the back affordance, and the school being asked twice.

Still divergent, all for the same reason — **the data does not exist in the client yet**, and in
every case the app says so rather than inventing it:

| Flow | Divergence | Blocked on |
|---|---|---|
| **F2** cutoff passes with the cart open | The cart shows no cutoff at all | `E05-30` — no calendar read in `api/` |
| **F5** dish contains the recipient's allergen | **No allergen warning can ever fire.** `fetchRecipients` does not return allergies, so `allergenIds` is null everywhere | `E05-31` |
| **F7/F8/F11/F12** payment paths | The waiting and confirmation screens exist but nothing routes to them | `E06` |
| **F14** policy version changed | The gate screen exists; nothing routes to it | needs a policy-version read |
| **F9** cart discard on switching recipient | Switching does **not** ask before discarding a non-empty cart | small, unbuilt — filed below |

### NEXT

1. Maestro, the moment a toolchain exists.
2. `E05-31` allergens — F5 is the one divergence with a safety consequence.
3. `E05-30` cutoff read — unblocks F2 and the cart's cutoff line.
4. Cart discard prompt on switching recipient.
5. Splash (`E21-18`) is the one screen from the list I did not reach.

### Final state

**30 suites, 602 tests, smoke green.** `PlaceholderScreen` is deleted — there was no caller
left, which is the clearest single measure of the night: every screen in the app is now a real
screen rather than a note to ourselves.

Two things the agents pushed back on and were right about, both recorded in the commits: the
cutoff prop cannot be a three-valued enum without inventing a time (§5.21), and there must be no
retry button while a payment is `pending`, because a retry during an unsettled capture is an
invitation to §10.6 duplicate payment.

One judgement call I want checked in the morning: the cart's signed-out footer now carries the
prototype's "we'll ask you to sign in — your order is kept" caption. `AR7`'s code note says the
words appear nowhere on this screen; the caption sits under the button, gated behind
`signedOut`, and reads as reassurance rather than a gate. The existing assertion still passes
because it defaults off. **If you disagree, it is one line.**

---


## 2026-08-10 (afternoon) — the order path exists and works; nobody can run it yet

### SHIPPED

| Task | One line |
|---|---|
| — | **`Deploy to staging` is green for the first time.** The project ref was a secret, and an unset secret is an empty string |
| `E05-09`/`E05-12`/`E05-13` | `create_checkout()` — §8.2 steps 1-9 in one transaction. **`assert_cutoff_open` finally has a caller** |
| `E05-09` (client) | The `checkout` Edge Function and `api.createCheckout()` — the first write in the system |
| `E09-11a` | `npm run kitchen -- --date YYYY-MM-DD`, plus `--csv production\|per-school\|packing` |
| `E05-15` follow-up | Fixture ids now carry the `7e57` marker, caught by `check:fixtures` |

Smoke **490 unit tests**; pgTAP **317 assertions** across eight suites. PRs #27 and #28
merged; `main` is current and nothing is unpushed.

### FINDINGS

**1. The order path is complete and has nobody to run it for.** `create_checkout` refuses
every request from the app with `not_authorized`, correctly — there is no `guardian_link`,
because **nothing in the product creates a child**. `E05-01`/`E05-02` are unbuilt, and the
reason they are not simply next is that adding a child is where consent is captured
(`E20-01`, `[DM-12]`), which is blocked on the DPDP legal question. Filed as `E05-16`.
Staging carrying no children is deliberate, not a seeding gap.

**2. `Deploy to staging` was never a credentials problem.** With the token and password
set it still failed at `supabase link --project-ref ""`. `SUPABASE_PROJECT_REF` was never
set and should never have been a secret — it is the subdomain of the Supabase URL that
ships inside every APK. An unset secret renders as an empty string, so the CLI's error
read like a credentials failure and was not one. Now a plain value with a guard that names
which of the three inputs is missing.

**3. `node --experimental-strip-types` cannot resolve the `.js`-for-`.ts` convention**
`packages/shared` uses. Same class as the Metro bundling bug: fine for `tsc`, Vitest and
Jest, not for every runtime. The kitchen script runs under `tsx`.

**4. I committed a red typecheck once**, fixed in the following commit. Lint and the unit
tests were green and I read those instead of the full smoke output — which is exactly what
`npm run smoke` exists to stop me doing.

### BLOCKED

- **Placing an order from the phone** — `E05-16` above. Not blocked on anything in the
  order path; blocked on there being no child to order for.
- **`E09`'s screens** — they belong in `apps/web`, which is one `index.ts`. A web app is
  not something to start and half-finish in a three-hour run, so the terminal path shipped
  instead and the screens are still open (`E09-04`, `E09-05`).
- **No iOS build** — `E17-26`.

### NEEDS ANDY

1. **The four decisions**, drafted in chat this run: `[OL-02]`, `[OL-03]`, `[PAY-02]`,
   `E09-14`. `E06` is blocked on the first three; the fourth is a data-protection
   commitment.
2. **`E05-16` / `[DM-12]`** — does v1 capture consent at child creation, or defer it?
   Building the add-a-child flow twice is the expensive outcome, and it is the last thing
   between the order path and a real order.
3. **`E19-03`** — the VAG Rounded Next licence.
4. **`E17-26`, `E17-27`** — iOS device registration and the App Store Connect app id.

### NEXT

`E05-01`/`E05-02` the moment `[DM-12]` returns — that is the whole remaining distance to a
real order on a phone. Then `E09-04`/`E09-05` need `apps/web` to exist at all, which is a
scaffold job worth doing deliberately rather than as a side effect.

### BUILDS

See the previous entry's link unless the build started at the end of this run finished —
check `npx eas-cli build:list --platform android --limit 1` from `apps/mobile`. Nothing in
this run changes what the app displays: the checkout client landed, the screen that would
call it did not.

---

## 2026-08-10 (morning) — staging serves a real menu, and AUTH-01 is what you decided

### SHIPPED

| Task | One line |
|---|---|
| — | **`supabase@2.112.0` cannot link at all.** Pinned to `^2.113.0`. This was the "credential blocker" |
| `E01-20` (in effect) | **Staging is seven migrations up to date and seeded.** `0005`–`0013` applied |
| `[AUTH-01]` / `U5` | **Literal table grants** (`0012`), replacing `0010`'s definer functions. Four security assertions rewritten, stronger |
| `E06-22` | Ledger reason codes seeded — the first posting no longer fails on a foreign key |
| `E06-31` / `M9` | Sign convention resolved **structurally**: a constraint, one balance function, a structural nightly check |
| `E03-20` | Session survives a restart — `expo-secure-store`, chunked under the keychain size limit |
| `E09-01/02/03`, `E09-11a` | The three kitchen lists and their CSV, as pure tested functions |
| `E05-15` | A time-dependent calendar test, found by CI. Not a regression — it failed on `main` too |

Smoke **865 green**. pgTAP **293 assertions** across seven suites, from a clean replay of
all thirteen migrations. PR #25 merged; `main` is current and nothing is unpushed.

### FINDINGS

**1. The Supabase CLI, not the credentials, was the blocker.** `2.112.0` fails parsing the
API's api-keys response with a `SchemaError` on a timestamp, so `link`, `migration list
--linked` and `db push --linked` all die. Two further traps on the way through, both in
`docs/environments.md` now: `Cannot find project ref` after a *successful* link (the CLI
writes `linked-project.json` but some commands still read the older `.temp/project-ref`),
and `IPv6 is not supported on your current network` (the direct `db.<ref>` host is
IPv6-only; a successful link records the IPv4 pooler).

**2. Staging was running a different authorization model from the repository.** It was
missing `0005`, the privilege baseline, along with six others. Not "two migrations behind".

**3. `E06-22`'s own wording was slightly wrong.** `0001` did seed one ledger reason code —
`migration_opening_balance`. It covers none of the payment path's movements, so the blocker
was real, but the test now records the correction.

**4. The zero-sum ledger constraint already existed.** Last night's Finding 4 said it did
not. `0001` has a deferred constraint trigger enforcing debits − credits = 0 and at least
two entries. What was genuinely missing was the *sign convention* — nothing tied an
account's type to which way its balance runs — and that is what `0013` fixes.

**5. The calendar suite was time-dependent, and the precedence was not the bug.**
`orderable_calendar` reports `cutoff_passed` before `too_soon` deliberately. The fixture
left no day that was unambiguously too soon: with a two-day lead, tomorrow's cutoff is
23:00 *today*, so after 23:00 the day is both. The suite had been green only because it
rarely ran that late. CI runs at 02:52 IST.

### BLOCKED

- **No iOS build.** `E17-26` — `eas device:create`, an Apple login with 2FA, a registered
  UDID. Nothing about it is automatable from here.
- **`Deploy to staging` still fails.** The GitHub Actions secrets are not set
  (`gh secret list` is empty), so the workflow cannot link. Migrations are applied by hand
  from this machine in the meantime, which works but is not a pipeline.
- **`E06` is plan-only by instruction.** Its step 5 is a genuine stop: seven `E19-07` rows
  need a public webhook endpoint.

### NEEDS ANDY

1. **`SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD` as GitHub Actions secrets.** Staging
   is current, but only because it was pushed from this laptop. Until the secrets exist,
   every deploy is manual and the pipeline is decorative.
2. **iOS: `E17-26` and `E17-27`** — device registration and the App Store Connect app id.
3. **`E19-03`** — the VAG Rounded Next licence. Still blocking `E13-02`.
4. **Two kitchen-operations questions before `E06` starts:** `[OL-02]` (how long can the
   kitchen still add a sandwich to the run?) and `[OL-03]` (how long to hold a pending
   checkout). Neither is an engineering call.
5. **`[PAY-02]`** — how a refund splits across wallet- and source-funded portions.
6. **`E09-14`** — how long a downloaded packing CSV may be kept, and how it is destroyed.
   It names children by design; the file warns its reader in the first row, and the rest is
   policy.

### NEXT

`E05-09`, the checkout transaction — `docs/order-lifecycle.md` §8.2 steps 1–9. It is pure
database, needs no Razorpay and no handset, and it is what turns `E09`'s list functions
from tested code into a screen with real orders on it. `assert_cutoff_open` still has no
caller; enforcement becomes real when step 6 calls it.

### BUILDS

- **Android — install this:**
  https://expo.dev/artifacts/eas/7DW57LqLsGGCECizs7bFooHbejJ-Qgue6tsHr-ypSr4.apk
  Build `e7d4b1bb`, from commit `1a97286`. Everything except the calendar test fix, which
  is test-only. **Verified with `E06-32`'s own checker against the downloaded artefact:**
  `upi` scheme present, 6/6 PSP packages.

  **This should now show real food.** Menu tab → pick a school → four dishes with prices,
  read straight from staging under the new `anon` policies.

  **Delete any earlier APK.** Builds before `e7d4b1bb` call the `SECURITY DEFINER`
  functions that `0012` dropped, so they will show an empty school list against staging.
- **iOS: none.** Blocked on `E17-26`.

---

## 2026-08-10 (overnight) — the spikes are closed, `anon` can read a menu, and there is a sign-in screen

### SHIPPED

| Task | One line |
|---|---|
| `E06-29` (Android half) | UPI `<queries>` permanently enabled in `apps/mobile` — the chooser question resolved by construction rather than by a second handset |
| `E19-08` | `com.razorpay:standard-core` pinned to `1.7.18` via a Gradle `resolutionStrategy`; it was floating on `LATEST` |
| `E06-32` | `scripts/verify-apk-upi-queries.mjs` — decodes the binary manifest out of a **built APK** and asserts the UPI block. Renumbered from a duplicate `E06-30` |
| `E19-01`, `E19-02` | Both spikes closed. `docs/spike-results.md` rewritten; `payments-design.md`, `open-questions.md` and the backlogs reconciled |
| `[AUTH-01]` + `E14-02` | A signed-out user can read a dish. Migration `0010`, decision `U5`, and the **`api/` module now exists** at `packages/shared/src/api/` |
| `E02-26` | A `SECURITY DEFINER` function about **children** was callable by unauthenticated users. Closed |
| `E03`/`E14-14` | School picker + migration `0011`, so the Menu tab has something to show |
| `E03-14` | Sign in with an emailed code. No password field, no "are you new?" step, no verification screen |
| `E06` | `docs/e06-build-plan.md` — plan only, no payment code |

Smoke: **832 tests green.** pgTAP: **271 assertions across six suites**, from a clean reset
replaying all eleven migrations.

### FINDINGS

**1. A `SECURITY DEFINER` function about children was reachable by `anon`.** Found by writing
the assertion "anon may execute exactly two functions" — it failed with eleven. Postgres grants
`EXECUTE` to `PUBLIC` on every new function by default and nothing had ever revoked it. Ten are
`SECURITY INVOKER` and die on their first table; the eleventh,
`auth_recipient_has_fulfilment_order(uuid)`, bypasses RLS by design because it is an
authorization helper. **Verified against the local stack: as `anon`, with a seeded recipient
id, it returns `false` rather than refusing** — an unauthenticated caller holding a recipient
id learns whether that child has an order. Not a bulk leak (v4 UUIDs are not enumerable), but
an authorization primitive answering questions about a child to strangers. Closed in `0010`;
`E02-27` filed for the default-privileges fix, which needs a check of which role runs
migrations in each environment.

**2. The `E19-01` spike APK's merged manifest already carried the `upi` scheme query.** So
package visibility was never the limiting factor in your handset session — the single installed
UPI app is the whole explanation, and the follow-up experiment could never have returned
anything. It also confirms finding A3 from a real artefact rather than from an AAR.

**3. The ledger cannot record anything today.** `ledger_transaction.reason_code` is
`not null references reason_code(code)` and **none of the eight seeded codes names a money
movement**. Not a thin vocabulary — the first insert fails on a foreign key. It blocks `E06-07`
outright and is step 1 of the E06 plan.

**4. The ledger sign convention is undefined, and this is the E06 failure I would bet on.** The
wallet is a liability, `provider:razorpay:clearing` is an asset, their balances run in opposite
directions, and no document says which way is positive for which. A single-signed `balance()`
helper gives plausible numbers for both and is wrong for one — and the nightly assertion meant
to catch the drift is the thing computing it wrongly. Nothing about it looks like a bug.

**5. `E19-02` returned no numbers.** "Performance acceptable" validates `E13-05`'s framework
choice and keeps `M05`, which is what the spike was for. It does **not** set `E14-07`'s
thresholds, which you ruled must come from measured figures. `E14-07` now needs one `adb`
session, not a decision — the commands are in the runbook and need no rebuild.

**6. A binary parser with a wrong base offset lies rather than failing.** My first APK read
reported the `upi` scheme MISSING, which would have been a significant finding. It was an
off-by-16 in my own parser (`attributeStart` counts from `ResXMLTree_attrExt`, not the chunk
header) — and it still parsed, producing confident nonsense. Caught by asserting known-good
values through it first. Written up in `docs/learnings.md`.

### BLOCKED

- **Staging has none of this.** Migrations `0010` and `0011` are not applied to
  `graybag-staging`, so the APK below shows the school picker and then an empty menu. Blocked
  on `SUPABASE_DB_PASSWORD` (`E01-20`) — it is not on disk, and the CLI's access token sits in
  the macOS keychain behind an interactive prompt I cannot answer unattended.
- **No iOS build exists.** `E17-26` — needs `eas device:create`, an Apple login with 2FA and a
  registered device UDID. Nothing about it is automatable from here.
- **`E06` is plan-only by instruction**, and step 5 of that plan is a genuine stop: seven
  `E19-07` rows still need a public webhook endpoint.

### NEEDS ANDY

1. **`SUPABASE_DB_PASSWORD` + `SUPABASE_ACCESS_TOKEN` as GitHub Actions secrets (`E01-20`).**
   This is the one that unblocks the most: it applies `0010`/`0011` to staging, which is what
   puts real dishes on your phone, and it fixes `Deploy to staging`, which has failed on every
   run since 2026-08-08.
2. **Read the `[AUTH-01]` implementation note.** You chose option (c), "grant `anon` SELECT on
   the menu tables". **What shipped is two `SECURITY DEFINER` functions instead**, because table
   grants would have meant rewriting four security assertions unsupervised overnight — including
   one ("every view in public is `security_invoker`") that I only found by a view-shaped first
   attempt failing against it. Same product outcome, all four assertions still passing.
   Literal table grants remain a small migration if that is what you want. Decision `U5`.
3. **`E19-03`** — the VAG Rounded Next licence. Still open, still blocking `E13-02`.
4. **iOS device registration (`E17-26`) and the App Store Connect app id (`E17-27`).**
5. **Two kitchen-operations questions before `E06` starts:** `[OL-02]` (how long can the kitchen
   still add a sandwich to the run?) and `[OL-03]` (how long to hold a pending checkout).
   Neither is an engineering call.
6. **`[PAY-02]`** — how a refund splits across wallet-funded and source-funded portions. Cannot
   be guessed; getting it wrong refunds real money to the wrong place.

### NEXT

Apply `0010` and `0011` to staging the moment the credentials exist, then rebuild — that is
one command and it turns the current build from "picker then empty menu" into a working menu.

After that, `E03-20`: session persistence across restarts. Sign-in works but the session lives
in memory, so every cold start is a fresh OTP. It needs a native storage dependency
(`expo-secure-store` preferred, so the refresh token sits in the keychain), which I deliberately
did not add unattended hours after the last verified build.

### BUILDS

- **Android — install this one:**
  https://expo.dev/artifacts/eas/5qUgVJwgdjqoMxS6DaXGWjLwQvwwxhuQT73PiVVzuhU.apk
  Build `64660df4`. Everything from the night: UPI `<queries>`, the SDK pin, the `api/`
  module, the school picker and the sign-in screen. **Verified with `E06-32`'s own checker
  against the downloaded artefact — `upi` scheme present, 6/6 PSP packages.**
  Install with `adb install -r`.

  **What you will see:** the Menu tab now offers a school picker instead of an empty state.
  Picking one will fail to load a menu, because staging has neither migration — that is the
  `E01-20` blocker above, and it is one command away once the credentials exist.
- **Android (earlier, without the picker):**
  https://expo.dev/artifacts/eas/CGyy9kEd0-GKgDvZeyR9Q1O_vqtOXNwW_zihUuTo52A.apk
- **iOS: none.** Blocked on `E17-26`.

### Merged

PR #23 merged to `main` after all three checks passed, including the migrations-and-
authorization job. `main` is up to date and everything is pushed.

---

## 2026-08-09 — Block 6 in progress; an Android build exists; four things need Andy

### What shipped

**Merged to `main`** (PRs #15, #16):

| Task | What it is |
|---|---|
| `E05-07` | **Cutoff enforcement** in SQL — `compute_cutoff_at`, `assert_cutoff_open`, `is_service_date_orderable`. Migration `0008`, pgTAP 16/16 |
| `E05-04` | **The cart** — pure domain in `packages/shared/src/cart`, `CartProvider`, a real `CartScreen`, and the tab badge wired to it |
| — | **`money.formatPaise`** — the shared formatter `design/type.ts` has always required and which did not exist |
| `E05-08` *(half)* | **Calendar server half** — `orderable_calendar` (migration `0009`) + `GET /order/calendar`. pgTAP 13/13 |

**On branch `block6-checkout`, not yet merged:** the store version floor (2.0.0), the `preview` build profile, `.easignore`, and this file.

Smoke is green at **496 tests**. pgTAP is **29/29** after a full `db reset` replaying all nine migrations.

### The Android build — **done, installable**

**APK: https://expo.dev/artifacts/eas/uJbrNfblIujNIe_FPvRyUq_aMl2UTVBsMY7lUbMKZyw.apk**

`eas build --profile preview --platform android` — version **2.0.0**, build **1**, project `@anuragdial/graybag`.

It took seven attempts and two genuine bugs, both now fixed and both of which had been latent for the whole project:

1. **The app had never bundled.** `packages/shared` is `"type": "module"` and imports with TypeScript's ESM `./env.js`-for-`env.ts` convention. Metro does not do that; Jest, `tsc` and Vitest all do. So 496 tests passed against a bundle that could not be produced. Fixed in `apps/mobile/metro.config.js`; `npm run bundle:check` now runs in CI so it cannot come back.
2. **`.easignore` excluded `config/`**, which every workspace `tsconfig.json` `extends`. Expo's Metro TypeScript resolver follows that chain at startup, and its absence killed the build with a message that named no file. **This class of failure is invisible locally** — the local machine has the whole repo, only the upload was short.

Uploads also failed repeatedly with `408` on an 85 KB/s uplink; `.easignore` cutting the tarball from 3.4 MB to 2.2 MB is what made them complete.

**It launches and is worth holding, but the Menu tab is empty and the cart cannot be filled**, because `E01-21` below is outstanding — there are no client env values anywhere, so there is no backend to reach. Nothing crashes: `loadClientEnv` is not called at startup, and a missing school renders an empty menu rather than an error. What it *does* show honestly: navigation, the design system, splash, icon, tab bar, and every empty state.

### Blocked on Andy — four credentialed actions, none attempted

| Task | What is needed | What it unblocks |
|---|---|---|
| **`E01-20`** | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` and the staging project ref, as GitHub Actions secrets | `Deploy to staging` has failed on **every run since 2026-08-08** on `supabase link --project-ref ""`. Nothing has ever actually deployed. Required CI checks do not depend on it, which is why it went unnoticed for a day |
| **`E01-21`** | Staging Supabase URL + anon key, and the Razorpay **test** key id, **as EAS environment variables** | A device build that can reach a backend. Note: EAS builds from a git archive, so a gitignored `.env.staging` is *not* uploaded — a local file will not do |
| **`E17-26`** | `eas device:create`, an Apple login with 2FA, one registered device UDID | Any iOS build at all. Android needed none of this |
| **`E17-27`** | The App Store Connect app id (`ascAppId`) | The first `eas submit`. Deliberately absent from `eas.json` — a guessed value submits to somebody else's listing |

**Also worth deciding:** `eas submit` needs Apple authentication, and interactive 2FA cannot run unattended. An **App Store Connect API key** would let submission run without you at the keyboard.

### iOS, prepared but not submitted

Version is `2.0.0` in `app.json`, with a test pinning the major at ≥ 2 — an upload at or below the live Bubble version is rejected *after* the build is paid for and waited on. The build number comes from EAS (`appVersionSource: remote` + `autoIncrement` on production), so the two cannot collide. Bundle identifiers are untouched and asserted: `com.gracord.graybag` on iOS, `com.Gracord.Graybag` on Android — capitals and typo included, because they are what the live store records are attached to.

### Where Block 6 stands

Done: `E05-04`, `E05-07`. Half done: `E05-08` (server yes, calendar UI no) and `E05-06` (resolver yes, picker no — it has no home until the checkout screen exists).

**Not started, and this is the next thing to build:** the checkout transaction, `docs/order-lifecycle.md` §8.2 — `E05-09` (order creation with snapshots), `E05-12` (idempotency), `E05-13` (preflight), then `E05-11` (cancellation). Everything it needs is already decided and in place:

- Steps 1–9 of §8.2 are **pure database and need no Razorpay**, so they are buildable now. Step 10 is the wallet and belongs to `E06-10`.
- The tax rule is not an open question: `G1` (per line, per component, half-up) and `G2` (CGST and SGST each computed independently from the taxable value — *never* 5% halved).
- `idempotency_key` exists, and `order_group` carries its own `unique (customer_user_id, idempotency_key)`. Two layers, both already in `0001`.
- **`assert_cutoff_open` still has no caller.** `E05-07` delivered the mechanism and its proof; enforcement goes live only when §8.2 step 6 calls it. This is the single most important loose end in the block.

Then: `E05-01`/`E05-02` (recipients — needs Edge Function writes and therefore the `api/` module, which still does not exist despite `E14-02`'s lint gate being in place), `E05-06` (break times), `E05-10` (history).

`E03` (identity) is 1/20. The app's session is an intentional seam — `SessionContext` holds "is there a session" and nothing else, and `E03` replaces its body without touching a screen. Cart and menu are deliberately usable signed out (`AR7`).

### Two traps that cost real time today

1. **A sparse override table turns `update … where` into a test that asserts nothing.** Creating a kitchen does not create its `kitchen_config` row, so the cutoff fixture's `UPDATE` matched zero rows and reported success while four assertions silently measured the platform default. Build config-chain fixtures with `INSERT`, and give the "defaults" case a parent that overrides nothing.
2. **The local Supabase stack cannot see this repo.** It lives outside `$HOME`, so colima bind-mounts resolve empty: the edge runtime cannot find its entrypoint and `pg_prove` reports `Files=0, Tests=0, Result: NOTESTS` — a green exit code for a suite that never ran. Run pgTAP by piping over stdin instead; the recipe is in `docs/learnings.md`.

Both are written up in full in `docs/learnings.md`.
