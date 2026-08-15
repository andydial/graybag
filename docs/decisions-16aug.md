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

---

## D7 — `company.json` disagreed with the notice I had just published

`docs/legal/company.json` calls itself the single source for entity facts, and after `E20-53` it
held `grievanceOfficer: { name: "Vivek", email: "vivek@graybag.com" }` and
`supportEmail: "info@graybag.com"` — two facts the app and the published notice had both moved on
from.

**Nothing reads either field today**, which is exactly why it was worth fixing now rather than
later: the obvious way to wire the grievance block properly is to read it from this file, and
doing so would have silently reintroduced the name Andy asked to remove.

`grievanceOfficer.name` is now `null` and the title names the **office at the company**. The
`_comment` records that whether DPDP requires a natural person is open (`E20-52`), so a future
reader does not take the null as settled law.

**`info@graybag.com` still appears in privacy policy §7 and §8 and I did not touch it.** That is
lawyer-approved baseline text; changing it is a notice version, and it belongs with `E20-01`
rather than being folded into a config edit.

---

## D8 — `sacCode` is still `null` here and `996331` in `platform_config`

Untouched. This is `E07-25` — a statutory particular with two disagreeing sources, and it is
Andy's, not a call I may make. **An invented SAC is worse than a token**: a token is visibly
unfinished and a plausible number is not, and it goes on every invoice.

Flagged in `docs/prod-smoke.md` §1.4 so it is checked before production issues its first invoice
rather than after.

---

## D9 — What actually shipped, and what did not

**Shipped (PR on `e20-53-policy-v3`):**

| Item | State |
|---|---|
| Staging deploy of `0052`–`0054` + `cancel-order`, schema cache | **Done before this run; verified**, incl. a negative control (D1) |
| `E20-52` grievance block → office + `support@graybag.com` | **Done** (`E20-53`), notice version 3 |
| Prove the re-acceptance gate fires on a version bump | **Done** (`E20-54`), 15 assertions through real RLS |
| Force-update gate, server-side | **Done** (`E17-46`), 21 + 8 + 6 assertions |
| One alert to `support@graybag.com` | **Done** (`E06-39`), 10 assertions |
| `docs/prod-smoke.md` | **Written**, and marked not-yet-runnable at the top |
| Version 4.0.0 config | Already correct in `app.json`; Android counter cleared by `E17-34` |

**Not shipped, and why:**

| Item | Why |
|---|---|
| Stand up production, apply migrations, set secrets, sync seller identity | **B2** — no production project exists; **B1** — no credentials |
| Razorpay live: webhook, signature verification against a real delivery, live keys | **B1** |
| iOS to TestFlight + App Store review; Android to Play internal, both pointing at prod | **B1/B2.** A build pointing at staging would take real money against a test-mode account — worse than a late submission |
| Partial refunds (`E06-08`) | Out of scope per instruction; already built when the instruction arrived, parked unmerged (D2) |

**The 16 Aug iOS deadline will be missed** unless the production project and `prod.env` appear.
Everything downstream of them is one command each; nothing else is in the way.

**Test-mode keys in a production build**: already impossible and already asserted —
`REQUIRED_RAZORPAY_PREFIX.production = 'rzp_live_'` in `packages/shared/src/env.ts`, exercised by
`env.test.ts` ("refuses a test key in production"). The check runs at build config load, at Edge
Function boot, and in the unit suite. No new work was needed; I verified rather than assumed.

---

## D10 — The force-update gate, verified live on staging

Not just unit-tested. The full cycle, against the deployed function, through the anon key the app
actually uses:

| Step | Result |
|---|---|
| Floor raised to `99.0.0` with a message | accepted |
| `app_version_support('4.0.0')` | `supported: false`, **with the configured sentence** |
| `app_version_support('4.0.0-rc1')` against the same raised floor | `supported: true`, `reason: version_not_stated` |
| Floor restored to `0.0.0`, message nulled | accepted |
| `app_version_support('4.0.0')` | `supported: true` |

The third row is the one worth having done live: it proves the admit-on-unknown direction holds
under a *raised* floor, which is the only condition where getting it wrong locks anybody out. A
unit test asserts the same thing, but not against the deployed function, the real grants and the
real anon role.

**Staging is back to `min_supported_app_version = '0.0.0'`.** Confirmed by reading it back, not by
assuming the write landed. On the 19th it goes to `4.0.0` — one UPDATE, no deploy.

Also verified live: `app_version_support` is callable by **anon** (a parent must be told before
signing in), and `ops_alert` refuses anon with `42501` at the privilege layer rather than
returning an empty list.

---

## D11 — The parked partial-refund work is on a branch, not in a stash

`git stash` is local-only and one `git stash drop` from gone. Moved to
`origin/parked/e06-08-partial-refunds`, renumbered `0055` → `0057` (its old number is now the
force-update gate), with a commit message that leads on **"do not merge without reading the
header"** — because it changes behaviour that has already shipped, and two assertions in
`record_refund.test.sql` fail against it by design.

---

# PART TWO — production stood up, 2026-08-16

`prod.env` and `graybag-prod` (`bdamkuugbqjajbndjoxn`, ap-south-1) both arrived. What follows is
what was done, in order, and the two things that were caught on the way.

## D12 — Migrations, secrets, functions

- **All 56 migrations applied** to an empty prod database. `migration list` reports 56 applied,
  0 pending.
- **Schema cache verified over REST**, with the negative control: computed columns resolve,
  `cancel_order` and `record_refund` answer with their own refusal hints rather than 404,
  `app_version_support` is anon-callable, `ops_alert` refuses anon with `42501` — and a bogus
  column still returns `42703`, which is what makes the positive results mean anything.
- **7 secrets set**: `APP_ENV=production`, the three Razorpay live values, `RESEND_API_KEY`,
  `ORDER_EMAIL_FROM`, `SUPPORT_ALERT_EMAIL`. Guarded before sending — the script refuses unless
  `RAZORPAY_KEY_ID` starts `rzp_live_`.
- **12 Edge Functions deployed.**

Two values were not in `prod.env` and I decided them rather than stopping:

**`RAZORPAY_WEBHOOK_SECRET`** — generated (`secrets.token_urlsafe(32)`) and **appended to
`~/.graybag-secrets/prod.env`**, which is `0600`. It has to live somewhere durable: it must match
the Razorpay dashboard exactly, and a secret that exists only inside a Supabase project cannot be
compared against anything when the webhook starts failing.

**`ORDER_EMAIL_FROM = "GrayBag <support@graybag.com>"`** — I could not read staging's value (the
API returns hashes). `support@graybag.com` rather than `orders@`: it is the address `E20-51`
standardised on and the one published in privacy notice v3, the refund email tells parents to
reply to it, and one verified sender is one thing to get wrong instead of two.

## D13 — `platform_config.environment` was `local` on production

The column defaults to `local` so that a new database is a developer's, which is the right
default. Nothing in the migrations sets it, and standing up prod therefore left it saying `local`.

**That silently disarmed `assert_seller_identity_configured()`**, which returns early unless
`environment = 'production'`. That is `E07-20` — the guard that stops `create_checkout` taking
money while the seller identity is still a placeholder. Its own comment describes the failure it
prevents: *"every customer charged, no order created, no 5xx and no alert."*

Set to `production` and verified: `seller_identity_placeholders()` returns `[]` and
`assert_seller_identity_configured()` passes.

**Filed as `E01-19`** — standing up an environment has a step that exists only in somebody's head,
and this is the second such step found in an hour (see D14).

## D14 — `payments-webhook` deployed with `verify_jwt = true`, which would have broken every payment

Caught by listing the functions after deploying, not by anything failing — because nothing fails
until real money moves.

Razorpay signs its deliveries with our shared secret in an `x-razorpay-signature` header. It has
never heard of Supabase auth and sends no bearer token. With `verify_jwt = true` the **gateway
answers 401 before the function runs**: every capture delivered, rejected, never settled. A
customer charged with no order, and no error in any log we would think to read.

Staging has it `false` — **set by hand in the dashboard, and nowhere in version control.** No
`verify_jwt` anywhere in `config.toml`, no flag in the deploy workflow. So the setting that makes
payments work at all existed only as a manual change to one project.

Fixed at the source: `[functions.payments-webhook] verify_jwt = false` in `supabase/config.toml`,
redeployed, verified `false` on prod. `payments-drain` deliberately keeps `true` — its own header
explains that reading an unverified `role` claim is only safe because the gateway checked the
signature first.

## D15 — Razorpay live webhook registered, and signature verification proven both ways

Created via the API (`POST /v1/webhooks`), id `TPqgSBnpEdsFSL`, active, subscribed to
`payment.captured`, `payment.failed`, `refund.created`, `refund.processed`. The account had **zero**
webhooks before this.

Verification was proven rather than assumed, by signing a payload with the shared secret exactly
as Razorpay does:

| Delivery | Response | Recorded |
|---|---|---|
| Valid HMAC-SHA256 signature | `recorded` | `signature_verified = true`, `processed` |
| Wrong signature, fresh payload | `recorded_unverified` | `signature_verified = false`, `ignored` |

The second is the one that matters: a forged delivery is **recorded and not trusted**, which is
the correct fail-safe.

**Two synthetic `payment.failed` events are now in production's `payment_webhook_event`**
(`pay_SIGPROBE16AUG`, `pay_BADSIG16AUG`). Left in place deliberately — that table is the record of
what arrived, and deleting from it to tidy up is exactly the habit that makes it untrustworthy.
They reference payments that do not exist and are already terminal.

## D16 — iOS is BLOCKED, and this is the deadline item

**No Apple credentials exist anywhere.** Checked, not assumed:

- `eas build --platform ios --profile production --non-interactive` →
  *"Distribution Certificate is not validated for non-interactive builds. Failed to set up
  credentials. Run this command again in interactive mode."*
- `eas build:list --platform ios` → **every iOS build ever attempted has `errored`**, all on the
  `development` profile. No distribution certificate has ever been created on the EAS servers.
- No `AuthKey_*.p8` anywhere under `$HOME`; `~/.graybag-secrets/` holds only the Android keystore
  and `prod.env`. No `APPLE_*`, `EXPO_APPLE_*` or `ASC_*` variables in the environment.
- `eas credentials` is interactive-only — it rejects `--non-interactive` outright.

An Apple Distribution certificate can only be minted by authenticating to Apple, which needs
either an Apple ID with 2FA (a human at a device) or an **App Store Connect API key** — a `.p8`
file plus its Key ID and Issuer ID. `eas.json` already has `appleTeamId` and `ascAppId`, so the
App Store record exists; what is missing is purely the authentication.

**I did not work around this.** The only workarounds available are worse than the delay: building
unsigned produces an artefact App Store Connect will not accept, and there is no way to sign for
distribution without Apple's authorisation.

**To unblock, one of:** run `eas build --platform ios --profile production` interactively and
complete the Apple 2FA prompt, or drop an App Store Connect API key at
`~/.graybag-secrets/AuthKey_XXXX.p8` with `ASC_KEY_ID` and `ASC_ISSUER_ID` added to `prod.env`.
With either, the build and both submissions are one command.

Note also: **`eas submit` uploads to App Store Connect (which feeds TestFlight); it does not
submit for review.** Submitting for review is a separate App Store Connect action, and with an ASC
API key it can be scripted — without one it is a human in the web UI regardless.

## D17 — Android build running

`ee8dfe09-ee30-4d8c-a990-08fdda62576d`, profile `production`, version `4.0.0`, versionCode
`1786591933` — above the live Play floor of `1777726914` that `E17-34` established. Android
credentials already existed on the EAS servers, which is the only reason this one is not blocked
too.

Verified before trusting it: `eas env:exec production` resolves all four `EXPO_PUBLIC_*` variables,
so the artefact points at prod rather than shipping with no backend. The Android build log did not
echo the "loaded from the production environment" line the iOS attempt did — that is a CLI output
quirk, and it was worth two minutes to confirm rather than assume.
# Decisions — WEB thread, same run

**Two threads were told to write to this file and both did.** Everything above is the mobile /
launch thread; everything below is the web thread — the admin dashboard, the config screen,
reports, the import tooling and the deploy gate. Neither is a correction of the other. They are
kept apart rather than interleaved because each is a chain of reasoning that reads in order, and
merging them by topic would break both.

Where the two overlap, the overlap is called out: **B1 above and D-16F below are the same
blocker**, found independently by both threads within the hour — `~/.graybag-secrets/prod.env`
does not exist.

Context: production is live **19 August**. Andy imports school, dish and menu data from Bubble on
the **17th**. This run was told not to stop for questions, so every judgement call that would
normally have been a question is written down here instead, with what it cost and how to reverse
it.

These are working decisions, not `docs/decisions/` entries. Anything that survives contact with
the 17th should be promoted into its area file with a real id.

---

## D-16A — New admin Edge Functions are in scope; the payments functions are not touched

**The question.** Non-negotiable #1 and `A4` require every write to go through an Edge Function,
and ESLint fails the build on a direct `.insert()`. The standing instruction was not to touch
"the payments/edge-function code". Read strictly, that makes the whole admin dashboard read-only.

**Decided.** The instruction means *the payments thread's functions*. New admin functions are
fair game; `checkout`, `payments-*`, `settle_*` and the webhook are not opened.

**Cost if wrong.** New server surface Andy has not read. Contained: every new function is its own
file under `supabase/functions/admin-*`, and deleting the directory reverts it.

---

## D-16B — `service_days` is a new column, not a reuse of `menu_item.available_days`

`E10-06` asks for cutoffs, break times and service days. The first two existed. The third did not
exist anywhere.

`menu_item.available_days` is per-item on a menu that `menu_assignment` may point several schools
at (`D4`), so two schools sharing a menu could not have different service days — which is exactly
the position Amity, Gem and Paragon are in. Not being served on a Saturday is a property of the
school, not of the food.

Added in `0056` on all three config tables with the usual NULL-means-inherit chain, platform
default all seven days, so the migration is **inert on the day it applies**. `orderable_calendar`
honours it in the same migration, because a setting nothing enforces is worse than no setting.

---

## D-16C — Bulk import is a CLI in `tools/`, not a screen and not an Edge Function

**Decided.** `tools/bulk-import`, run by Andy from his laptop against the service role, following
the shape `tools/menu-import` and `tools/seed-kitchen-day` already set.

**Why not the admin UI.** The 17th is a bulk data-entry day against files exported from Bubble.
A browser form is the wrong instrument for a few hundred rows, and a half-finished upload in a
browser tab has no resumable state. A file plus a command has both.

**Why not an Edge Function.** Import needs to read the whole existing catalogue to diff against
it, write across five tables in one pass, and be re-runnable. That is a batch job. Doing it
through a function would mean either one enormous request or an orchestration layer, and it would
put the service role behind an HTTP endpoint that exists only for one day's work.

**The lint rule permits it.** `config/eslint-api-module.js` scopes the api-module ban to
`apps/**` and `packages/**`. `tools/**` is deliberately outside it, which is how `menu-import`
and `seed-kitchen-day` already work.

**Dry run is the default, not a flag.** `--apply` is required to write anything. `menu-import`'s
CLI header makes the same choice and says why: a plan a human reads, applied as a separate act.
Andy is doing this two days before go-live, alone, against real data.

---

## D-16D — Import matches on natural keys and never deletes

Schools match on `school.code`, dishes on `(kitchen_id, lower(name))` — which is already a unique
index — and menus on `(kitchen_id, name)`.

A row absent from the file is **left alone**, never deactivated. A partial file is the ordinary
case on an import day, and treating absence as deletion turns one wrong export into an emptied
menu. `menu-import` reached the same conclusion and put it behind `--deactivate-missing`; this
tool does not offer the flag at all, because the 17th is not the day to discover it.

---

## D-16E — Reports are the narrow version Andy asked for, and are not tagged MVP

Orders and revenue, by school, by month. Nothing else — no platform-wide analytics, no cohort
retention, no revenue-share payout view. `E10-10` and `E10-17` stay untagged in the backlog:
`CLAUDE.md` forbids this thread adding ids to the MVP list, and a direct instruction to build
something is not the same as a decision to put it in v1. Andy decides that.

---

## D-16F — Pointing the web app at production is BLOCKED and was skipped

`~/.graybag-secrets/prod.env` does not exist — the directory holds only the upload keystore. The
payments thread has not stood the project up, or has not written the file.

Nothing was guessed and nothing in `apps/web/.env` was touched, so **staging is unchanged and
still works**. What is needed is in `docs/production-cutover.md`, written during this run: the
two variables, where they go, and the one command to verify the switch. It is a five-minute job
once the file exists.

---

## D-16G — Fixing tests that were never running counted as in scope

`npm run test:all` surfaced two pgTAP suites failing, both pre-existing on this branch.
`kitchen_allergen_flags.test.sql` was contributing **zero assertions while reporting no failure** —
it aborted on its first insert and every later statement returned "current transaction is
aborted", which contains no `not ok`.

That suite is the proof that a kitchen operator at school A cannot read school B's allergy flags.
Andy made that proof the condition of shipping the feature. Leaving it broken to save time would
have meant shipping the condition unmet, so it was fixed rather than noted.

---

## D-16H — The grievance route: the name is in the website footer and nowhere else

Andy, 15 August: *"Vivek's name stays in the website footer only. Everywhere else — app-adjacent
pages, order/support copy — route to `support@graybag.com`."*

**What was already true.** `E20-51` had removed the name from the app on 15 August, and removed
`GrievanceOfficer.name` from the *type* rather than leaving it optional. `apps/web` contained no
individual's mailbox anywhere. So most of this instruction was already satisfied.

**What actually changed.** One thing: the website footer had **no name at all** — it published
the role and `grievance@graybag.com`. Andy's instruction is that this one surface carries the
name, so it now does.

**Why the split is not inconsistency.** Two real requirements pull in opposite directions. The
DPDP Act requires a Data Fiduciary to *publish* the contact details of a named person, and
`E20-52` records that notice version 2 added the name specifically because a general `info@`
alias does not satisfy that. `E20-51` records why the same name is wrong inside the app: a
personal mailbox behind a support route is unanswerable when that person is away, unchangeable
without every shipped build pointing at the wrong place, and it makes one individual the public
face of every complaint in an app-store listing. One published page carries the statutory name;
nothing a parent taps does.

**The address stays a role, not a mailbox.** `grievance@graybag.com`, not `vivek@graybag.com`,
even with the name beside it. Naming the officer is what the Act asks for; routing every complaint
into one person's inbox is the failure `E20-51` identified, and the two are separable. It also
stays distinct from `support@` — `E20-51` kept them apart so a DPDP matter is filterable out of
the order-query pile, and those run against a statutory clock.

**`docs/privacy-policy.md` §7A was NOT touched**, and that is deliberate. It names
`vivek@graybag.com`, and that is `E20-52`: `owner:andy`, risk:high, blocked on a lawyer's answer
to one question — does the DPDP grievance contact have to name a natural person, or does a titled
role with a monitored address satisfy it? The task says in as many words: *do not edit the
published wording*. A `policy_version` row is immutable once published, so changing §7A is a new
notice version that re-triggers the acceptance gate for every existing parent. `CLAUDE.md` also
forbids this thread completing an `owner:andy` task.

So `E20-52` remains open and remains Andy's. Nothing here pre-empts whichever way the lawyer
answers.

---

## D18 — Production had schema and no catalogue: the app would have opened empty

Checked after the migrations, because "56 applied, 0 pending" says nothing about whether a parent
can see a menu. Production held **zero cities, schools, kitchens, dishes, menus and break times** —
only the reference data migrations insert directly (`policy_version`, `reason_code`, `permission`,
`role_template`).

On the 19th, every parent opening the app would have met an empty school picker. The app would
have been working perfectly and completely useless, and §5.21's whole N1/N2 distinction exists
because that is indistinguishable from a bug.

**Why:** `supabase/seed.sql` is dev fixtures and says so — *"NEVER into staging or production"* —
and `db push` does not apply seeds anyway. The real catalogue lives in
`supabase/seeds/catalogue.sql` and had to be applied deliberately. `0024_onboard_real_schools`
predicts this in its own header: *"in an environment where the catalogue has not been seeded, no
row matches and this is a no-op."*

**Decision: applied `supabase/seeds/catalogue.sql` to production.** It is the right file and it is
built for this — generated from the Bubble export of 2026-08-11, every insert `on conflict do
nothing`, every id derived from the legacy Bubble id so all environments agree, and it deliberately
contains **no User, Child, Order or Dish_In_Order rows**: no data about a minor goes near it.

Verified afterwards as an **anonymous visitor**, which is the population that matters here:

| | |
|---|---|
| Schools visible | 3 — Amity International, Gem Public, Paragon Senior Secondary |
| `onboarded_at` set, `offboarded_at` null | all three |
| Menu items visible | Amity 47, Gem 36, Paragon 36 |
| Dishes / menu items / categories loaded | 79 / 83 / 8 |

Two of my probes were wrong on the way and the system was right both times — there is no
`public_school` view (the app reads `school` with a redacted column list) and `public_menu`'s
column is `name`, not `dish_name`. Worth recording only because both looked like production
failures for a moment and were mine.

**What is still missing from production data**, and is not mine to invent:

- `food_type` (veg / non-veg / egg) is **null on every dish** — `[DM-17]` is open and the
  catalogue's own header refuses to guess it: *"guessing it in this market is a trust failure, not
  a cosmetic gap."* In India, shipping a lunch app to schools without veg/non-veg marking is the
  single most likely thing to cause a complaint on day one. **This needs Andy or the kitchen before
  the 19th.**
- `dish_allergen` is empty — never derived from an ingredients list, tier S. The allergen warning
  therefore cannot fire, and the app says so rather than reassuring.
- `calories_kcal` is null; the source's ranges are preserved as text in
  `nutrition->>'calories_text'`.

---

## D19 — Android built; both submissions blocked on credentials that do not exist

**The Android build succeeded**, and it is the one genuinely shippable artefact from this run:

| | |
|---|---|
| Build | `ee8dfe09-ee30-4d8c-a990-08fdda62576d` |
| Version / code | `4.0.0` / `1786591933` (above the live Play floor `1777726914`, per `E17-34`) |
| Package | `com.Gracord.Graybag` |
| Artefact | `https://expo.dev/artifacts/eas/K1wq3wx4jpl5gMld1nG_rhjc3Is7N2jaz_P2vh4B0g4.aab` |
| Points at | production — verified via `eas env:exec production`, all four `EXPO_PUBLIC_*` resolve |

**Play submission is blocked**: `Google Service Account Keys cannot be set up in
--non-interactive mode`, and no service-account JSON exists anywhere under `$HOME` or in EAS.
Same class of blocker as iOS — a credential, not a bug.

**Andy can upload that `.aab` to the Play Console by hand today.** It is a complete, signed,
production-configured artefact. That is the fastest route to the internal track without waiting
for a service account.

### One thing this nearly hid

The first submit attempt resolved `com.Gracord.Graybag.**dev**`. That is `app.config.js` working
exactly as designed — it derives the bundle suffix from `APP_ENV`, and *"an unset or unrecognised
`APP_ENV` lands on `local`, not on production"*, which is the safe default. My shell had no
`APP_ENV`; the **build** ran on EAS with the `production` profile and produced the correct package.

Worth recording because the failure message named a package nobody intended to ship, and the
instinct is to go looking for a build problem that is not there.

### iOS remains the deadline miss

`E17-50`. No Apple credentials of any kind — every iOS build ever attempted has errored, no
distribution certificate exists on EAS, no `.p8` on disk. Not workaroundable: an unsigned artefact
is one App Store Connect will not accept.

**Both blockers are the same shape as `E01-27`**: the thing needed to ship exists only in a
console somebody has to log into. Three instances in one day — `platform_config.environment`,
`payments-webhook.verify_jwt`, and now both sets of store credentials.

---

## D20 — iOS: the Key ID and Issuer ID arrived, the private key did not

`prod.env` now carries `ASC_KEY_ID` (10 chars, well-formed) and `ASC_ISSUER_ID` (a well-formed
UUID). **The `.p8` private key itself is not on this machine.** Checked, not assumed:

- `~/.graybag-secrets/` holds `graybag-upload.keystore`, its `.bak`, and `prod.env`. No `.p8`.
- `find ~ -name "*.p8"` outside `node_modules` → **nothing**. Not in Downloads, not on Desktop.
- No PEM block inside `prod.env` either — the key was not pasted in as a variable.
- No signing identity in the login keychain (`security find-identity -v -p codesigning` →
  *0 valid identities found*), and no Apple Distribution certificate.

Two build attempts were made, not one:

1. `--non-interactive` with the ASC ids exported → *"Distribution Certificate is not validated
   for non-interactive builds."*
2. The same, plus `EXPO_APPLE_ID=andy@graycord.com` to pick up the **cached fastlane session**
   at `~/.app-store/auth/andy@graycord.com/cookie` (last written 14 Aug, so plausibly still
   valid) → identical failure.

EAS will not mint a distribution certificate without the API key; a cached web session is not a
substitute for it. **The two ids are useless on their own — the `.p8` is the credential.**

**What Andy needs to do.** App Store Connect only offers the `.p8` download **once**, at
creation. If it was not saved, it cannot be recovered and a new key must be generated:
App Store Connect → Users and Access → Integrations → App Store Connect API → generate a key with
**Admin** or **App Manager** role (a Developer-role key cannot create certificates). Then:

```
mv ~/Downloads/AuthKey_XXXXXXXXXX.p8 ~/.graybag-secrets/
# and update ASC_KEY_ID in prod.env to the NEW key's id — it will not be the current one
```

With the file in place, the build and both submissions are one command each.

**Note on build numbers.** iOS `buildNumber` has incremented 1 → 2 → 3 across the failed attempts,
because `autoIncrement` runs before credentials are checked. Harmless — `4.0.0` has never been
uploaded, so any build number is acceptable — but it explains a gap somebody might otherwise
wonder about.

---

## D21 — E01-28: the Maestro failure was not `VersionGate`, and the real cause had been there all along

Handed over as launch-blocking with `VersionGate` as prime suspect, which was reasonable — it
wraps the whole app above the tab bar, and a gate that wrongly blocks is the one failure mode that
locks every parent out with no route back.

**Cleared it with evidence.** `version-gate.test.tsx` is the file `E17-46` should have shipped and
did not: that task tested the api function and the screen, and left the component that *decides*
untested. Eleven assertions now cover every uncertain path, including the Maestro-shaped one where
the api module was never configured at all. Only an explicit `supported: false` blocks. The live
staging endpoint agrees: `4.0.0`, `null` and `"not-a-version"` all return `supported: true`.

**The real cause:** `loadClientEnv` requires `RAZORPAY_KEY_ID`, the workflow never set
`EXPO_PUBLIC_RAZORPAY_KEY_ID`, so `App.tsx` rendered `CantConnectScreen` **instead of**
`RootNavigator` — no tab bar, no `tab-menu`. And the repository had **no Actions variables at
all**, so the two Supabase vars were empty strings as well. This job has never had a backend,
which is why it has never been observed green.

**The compounding defect is the one worth remembering:** `missingClientEnvNames()` did not check
`RAZORPAY_KEY_ID`, so the diagnostic screen would have reported *nothing missing* while the app
was unusable for want of exactly that. A diagnostic that omits a required input does not merely
fail to help — it sends the reader somewhere else.

## D-16I — `food_type` is guarded at the *offer*, not on the column

79 dishes reached production with `food_type` null on every one, and 83 menu items were offering
them. `[DM-17]` left the column nullable for a good reason — the source Excel had no such field
and inventing one would be inventing a fact about food.

**Decided.** That reasoning covers a dish sitting in the catalogue; it does not cover a dish
*offered to a parent*. So the column stays nullable and `0059` guards `menu_item`: a dish can
exist unmarked, it cannot be published to a menu unmarked. The trigger fires only when
`is_active` is true, because that is how this schema says "offered" — parking a dish on next
term's menu before its details are complete is ordinary and reaches nobody.

**It does not touch the 83 rows already there.** A trigger fires on write. A migration that
retro-actively emptied two live menus would be an outage, not a guard. Those rows are what
`npm run check:launch` reports.

**It will make `tools/bulk-import` fail** on any menu row whose dish is unmarked. That is the
forcing function, and it is why the bulk editor and the CSV round trip ship in the same change —
there is never a state where the rule exists and the means to satisfy it does not.

---

## D-16J — the fastest path is "mark everything veg, then correct the exceptions"

Three ways in, because the fastest one depends on what Andy has in front of him:

1. **`/admin/menus` bulk bar** — "Select the N with no food type" → Veg, then flip the handful
   that are not. Three actions for 79 dishes. One request, not 79: the endpoint takes a list and
   groups by value, so it is one statement per distinct value.
2. **`--export-dishes dishes.csv`** — the catalogue as a CSV whose columns are exactly what
   `--dishes` reads back. A spreadsheet is the right tool for 79 rows if the answers are not
   uniform.
3. **One dish at a time**, which already existed.

The bulk endpoint accepts **only `food_type`**. A general "apply this patch to 500 rows" endpoint
is one careless caller away from retiring a catalogue, and no operator task needs it. It is
all-or-nothing: validated completely before anything is written, so a bad id at position 60 does
not leave 59 changed and the operator guessing.

---

## D-16K — the launch check reports blockers and warnings, and nothing else

`npm run check:launch` answers one question: what stops a parent ordering right now.

A **blocker** stops ordering. A **warning** degrades it. There is no third level and no
"consider" tier, because a report listing twelve things when two matter is a report that gets
skimmed on the morning it matters most. Warnings do **not** fail the exit code — a check that
fails on things you have deliberately accepted is a check you stop running.

Every finding carries the fix, not just the fault. On the 17th the person reading it is alone.

It found two production blockers on its first real run, one of which nobody knew about: **Paragon
and Gem have no break windows**, so under `P19` neither can take an order at all. Staging got
those rows from `0029`; production never did.

---

## D-16L — `E10-21` is NOT tagged `(mvp)`, and I think it should be

I tagged it, `check:mvp` refused, and it was right to.

`CLAUDE.md`: *"Never add an id to the MVP list yourself. If you believe something must be in v1,
say so and let Andy decide."* The rule exists because the backlog grew from 161 tasks to 288 by
new work quietly defaulting into scope.

So the marker came back off. **For the record: I think it belongs in v1.** Andy ranked it first
and described it as the most likely day-one complaint, and a parent who cannot tell whether a
dish is vegetarian is not a fast-follow concern in this market. But that is a scope decision with
one owner, and the work is finished either way — the tag changes the count, not the code.

One line in `scripts/check-mvp.mjs` and one marker in the backlog if Andy agrees.

---

## D-16M — the enquiry notification is best-effort, and its recipient chain ends at an address prod has

Live enquiries were going nowhere. `enquiry-submit` was **not deployed to production** (404), and
`PUBLIC_ENQUIRY_ENDPOINT` was unset in Netlify, so the site fell back to `/api/dev/enquiry` — the
dev mock. A school filling in the form on the live site would have been thanked and lost.

Both fixed: the function is deployed, the variable is set on the **production context only** (a
preview still falls back to the mock, which is right — a preview must not write real leads).

**The notification now exists** (`E12-16`). It is sent after the row is committed and its result
is discarded: the contract says an enquiry lost to a mail provider's bad minute is the worst
outcome this endpoint can produce, so nothing after the insert may turn a stored lead into an
error the visitor sees.

**It carries no phone number and no message.** Those are on the row, which has RLS. An email is
forwarded, quoted and left in inboxes. They are not on the `EnquiryNotice` interface at all, so
the compiler refuses them — a comment asking somebody not to include a phone number is not a
control.

**The recipient chain was wrong on its first deploy and that is the lesson.** It read
`ENQUIRY_EMAIL_TO ?? ORDER_EMAIL_REPLY_TO`, and production has neither. A real test enquiry was
stored and silently not announced. A notification path whose only recipient variable is one nobody
has set does nothing, and fails in the way hardest to notice: quietly, and only in production. It
now falls back to `SUPPORT_ALERT_EMAIL`, which prod does have.

**Not verified: that the email actually arrived.** This Supabase CLI has no `functions logs`
subcommand, so the send could not be observed from here. What is verified is that the row lands
(twice, on production), that the recipient chain resolves to a variable production has set, and
that every failure path logs "the enquiry IS stored". Andy should confirm one arrived.

---

## D-16N — my `E01-28` hypothesis was wrong, and the mobile thread's answer is the right one

I filed `E01-28` saying `tab-menu` never rendered and naming `VersionGate` as the prime suspect,
explicitly unconfirmed. The mobile thread diagnosed it: **the Maestro build had no backend
configured**, not a version gate.

Recorded because the ticket argued a case that turned out to be wrong, and the reasoning it used —
"`VersionGate` merged today and wraps everything above the tab bar, and the flow's first action is
to tap the tab bar" — was plausible and still wrong. What made it wrong was that I did not take
the screenshot the ticket itself recommended as the first step. The suspicion was cheap; the
confirmation was the part that mattered and I left it to somebody else.

Their diagnosis stands. Nothing in this branch depends on mine.

---

## D-16O — the deploy gate has never run, because the site has no repository

Promoting revealed something bigger than the promote. The Netlify site has **no Git repository
connected**: `build_settings.repo_url`, `provider`, `cmd` and `base` are all null, and every
production deploy to date carried no commit ref.

So `E12-30`'s gate — the `ignore` hook, the `[promote]` marker, the inverted exit codes, all of it
— **has never been evaluated**, and pull requests have never had deploy previews. The gate is
correct and its test now drives the real shell wrapper; it simply has nothing to run in.

Filed as `E12-33`, `owner:andy`: connecting a repository needs the Netlify account and GitHub
authorisation. Until then the only thing between a mistake and production is whoever types the
deploy command, and `docs/netlify-deploys.md` now says that in its first section rather than
describing an automation that does not exist.

Production was brought current by the manual route, with the production values passed to that one
build and deliberately **not** written into `apps/web/.env` — a local dev session pointed at the
live database is how somebody marks a real class delivered while testing.

### And the runbook I wrote could not be followed

It said "make an empty commit and push it". `main` is protected, so that is rejected outright with
`GH013`. The marker has to arrive as the **squash subject of a merged PR**, and merging without
`--subject` puts `Title (#nn)` on `main`, which the gate correctly ignores. Both corrected. Found
by trying to follow my own instructions, which is the only way that class of error surfaces.

### The gate's own test was pinned to today's commit

It ran the wrapper, which read the repository's `HEAD` — so it passed only while `HEAD` did not
contain `[promote]`, and failed the moment a real promote merged, reporting a gate bug that did
not exist. The wrapper now prefers an injected `COMMIT_MESSAGE` and the test pins one. Exactly the
trap `docs/learnings.md` records: assert the behaviour, never today's contents.

---

## D-16P — `0059` applied to production; migrations I own are mine to apply

Andy, 2026-08-15: *"Apply 0059 to prod… you flagged it as mine — take it. Same for any migration
you own from here."* Done, and the standing rule for this thread is now: **a migration this thread
writes, this thread applies.**

Applied inside one transaction that *proved the guard before committing* — it created the trigger,
then attempted to publish an actually-unmarked production dish and required a `check_violation`,
raising and aborting if the guard had failed to fire. Recorded in
`supabase_migrations.schema_migrations` so `supabase migration list` stays honest, and the
PostgREST schema cache reloaded afterwards. All 83 existing `menu_item` rows untouched, as
designed.

---

## D-16Q — break windows: the times stay blank, the labels do not

`P19` means Paragon and Gem take **no orders at all** on production today. The fix is their real
times, which are Andy's to supply, so `--export-breaks` writes a file with the rows and labels
ready and the **times deliberately empty**. The importer refuses a blank time, so the file cannot
be applied until a human has typed four numbers.

Pre-filling them from Amity would have been faster and wrong: it publishes a time nobody agreed
to, which is the exact refusal `catalogue.sql` makes about the legacy option set. `P20` does record
Andy ruling on 2026-08-11 that Gem and Paragon use Amity's windows provisionally — that reached
staging via `0029` and never reached production — so the document states Amity's four numbers
plainly and says that if the ruling stands, copying them across is the whole job.

**The labels are not copied.** Amity's labels *are* their own time ranges, which `check:launch`
already warns about, and propagating that to two more schools would spread a known defect across
the estate on the day it was noticed. The template offers friendly names instead, and editing
Amity's two label cells in the same file fixes the original.

### Two defects found by using it

**The export could not be re-imported.** The code was derived from the label, and production's
codes (`break-1`) do not match its labels (`"10:40AM - 11:15AM"`), so an untouched export came
back as two **creates** — duplicate windows. The exported row now carries the stored code and an
explicit code wins over a derived one.

**The template rows were missing entirely.** `snapshot()` did not read `is_active` or
`onboarded_at` on schools, so every school looked inactive and was skipped. The first export
produced two rows and no templates, which read as "nothing to do" about a problem that closes two
schools.

---

## D-16R — production could take a payment and send nothing, and nothing said so

Andy asked me to confirm the enquiry email *arrives*, not just that the row lands. It did not — and
the cause was not the enquiry.

`ORDER_EMAIL_FROM` on production was an address at **`graybag.com`**. The only verified domain on
the Resend account is **`mail.graybag.com`**. So every transactional send failed with
`403 The graybag.com domain is not verified` — **order confirmations, tax invoices, refund notices
and enquiry notifications alike**. The request still succeeded, the order still saved, and the
403 appeared only in the Edge Function log.

On the 19th that is a parent paying and being told nothing.

Proven rather than inferred: the same message sent from `hello@graybag.com` returns 403 and from
`hello@mail.graybag.com` returns 200, on the production key. `ORDER_EMAIL_FROM` is now
`GrayBag <hello@mail.graybag.com>`, and an enquiry submitted afterwards produced a real email to
`support@graybag.com` with the subject `GrayBag enquiry — …`.

**What made it findable was insisting on the arrival rather than the row.** Every previous check
had confirmed the enquiry was stored, which it always was.

`check:launch` now reads Resend's domain list: a blocker when nothing is verified, and it prints
the verified domain so the from-address is a one-line eyeball rather than an invisible assumption.
It cannot read `ORDER_EMAIL_FROM` itself — the API returns secrets hashed — so the honest
protection is that plus the canary in `docs/kitchen-day-one.md`.

---

## D-16S — the `noindex` flip is prepared and NOT pulled

Seven conditions, in `docs/production-cutover.md`, and the two that are not met are not mine:
the **DNS cutover** has not happened (the site answers only on `graybag-web.netlify.app`) and the
**legal pages are not confirmed cleared**, which is the reason the marketing site was held back in
the first place.

The one that catches people is condition 7: `PUBLIC_SITE_PUBLISHED` is read at **build** time by
`robots.txt.ts`, so setting the variable without promoting a build leaves `Disallow: /` live —
and removing the header without rebuilding leaves the two mechanisms disagreeing, which is exactly
the state having two of them is meant to prevent.
---

## D22 — iOS: the key was reported placed and is still not on the machine

Andy, with the Key ID and Issuer ID: *"the App Store Connect key at
`~/.graybag-secrets/AuthKey_435XUS53TJ.p8`"*.

**Both IDs match `prod.env` exactly**, so the configuration is right. The file is not there.
Searched, not assumed:

```
~/.graybag-secrets/            → graybag-upload.keystore, .bak, prod.env   (mtime 13:48, unchanged)
find ~ -name "*.p8"            → nothing
find ~ -iname "AuthKey*"       → nothing
~/Downloads modified <2h       → nothing
grep -rl "BEGIN PRIVATE KEY"   → nothing in Downloads, Desktop or .graybag-secrets
```

**I did not start the build**, because there is nothing to sign with and a build that fails on
credentials burns twenty minutes and increments the build number for nothing — it has already
gone 1 → 2 → 3 across earlier attempts.

**What is now pre-wired**, so this is one command when the file lands:

`eas.json` `submit.production.ios` carries `ascApiKeyId` and `ascApiKeyIssuerId` — identifiers,
not secrets, and they belong in version control so a submission is reproducible. The **path is
deliberately not committed**: it is machine-specific and would bake a home directory into the
repository. Pass it at invocation:

```bash
export EXPO_ASC_API_KEY_PATH=~/.graybag-secrets/AuthKey_435XUS53TJ.p8
export EXPO_ASC_KEY_ID=435XUS53TJ
export EXPO_ASC_ISSUER_ID=92f32c0c-4434-4bd3-91d2-7b66868a48e4
cd apps/mobile
npx eas-cli build --platform ios --profile production --non-interactive --auto-submit
```

`--auto-submit` uploads to App Store Connect, which is what feeds TestFlight. **Submitting for
review is a separate action** and EAS does not do it; with this same key it can be scripted
against the ASC API, otherwise it is a human in the web UI.

If the `.p8` cannot be found, it cannot be recovered — App Store Connect offers that download
once. Generate a new key with **Admin** or **App Manager** role (a Developer-role key cannot
create certificates) and update `ASC_KEY_ID`, which will change.

---

## D23 — E01-28: admit-on-unknown proven against PRODUCTION, under a raised floor

Previously proven against staging and in 11 component assertions. Re-run against **production**,
because that is what parents meet on the 19th, and with the floor actually raised to `99.0.0` —
the only condition in which a wrong answer locks somebody out:

| version sent | result |
|---|---|
| `4.0.0` — the real build | **blocked**, with the configured sentence. The feature works |
| missing (`null`) | **admitted**, `version_not_stated` |
| empty string | **admitted** |
| `not-a-version` | **admitted** |
| `4.0.0-rc1` | **admitted** |

Floor restored to `0.0.0` and read back rather than assumed. **Production is not gating anybody
today**; on the 19th it becomes one UPDATE.

The gated state was also rendered from the real component text and the real design tokens
(`bg.canvas #f7f8f7`, `action.primaryBg #007e3b`, `scale.h1` 28/34/600, `layout.gutter` 16) and
screenshotted with headless Chrome. **It is a reconstruction, not a device screenshot** — the app
cannot run on this machine (`E14-30`: no Xcode or Android SDK), so no simulator or emulator exists
to capture. Said plainly because a reconstruction presented as a screenshot is a claim about
evidence that is not true.

---

# PART THREE — the iOS submission, and the six items

## D24 — iOS: built, uploaded, and what actually blocked it for three builds

**Uploaded to App Store Connect: 4.0.0, build 11**, from `69ee4c59-4f62-4c80-b54f-64053985daea`.

Getting there needed four things, and only the first was expected:

1. **A pseudo-TTY.** `eas build` refuses to create credentials in non-interactive mode, and
   piping into stdin still counts as non-interactive — stdin hits EOF before the prompt appears.
   `script -q /dev/null` allocates a PTY; `expect` then answers the prompts. Without that, the
   ASC key alone changes nothing.
2. **The Apple Team Type**, which EAS asks and cannot infer. Chosen **Company/Organization** —
   Enterprise is in-house distribution and does not publish to the public App Store, and GrayBag
   Solutions Private Limited is a registered company. Apple then confirmed it:
   *"Team name: Graycord Pty Ltd (Company/Organization)"*.
3. **Reusing the existing distribution certificate** (`G9T5JTWLWM`, valid to June 2027, already
   used by dubbaa and graybag) rather than minting a second. Apple caps distribution certificates
   at two or three per team; spending one to avoid answering a prompt is a cost that lands months
   later on somebody else.
4. **`E12-30`** — the real blocker, below.

Credentials are now stored on the EAS servers, so **subsequent builds work with plain
`--non-interactive`**. The PTY dance was one-time.

## D25 — `E12-30`: the bundle reached into `docs/`, which EAS does not upload

Three iOS builds failed with the CLI reporting only *"Unknown error. See logs of the Bundle
JavaScript build phase."* The worker log, fetched via GraphQL and **brotli**-decompressed, said:

    Unable to resolve module ../../../../docs/legal/company.json
      from packages/shared/src/legal/company.ts

`packages/shared/src/legal/company.ts` (PR #51) imports `docs/legal/company.json`. `.easignore`
excludes `docs/` deliberately — 1.25 MB of prose on an 85 KB/s upload — while `packages/` is
uploaded because the app depends on it.

**`.easignore`'s own header records the identical failure for `config/`**, which "cost three
builds" and died "in the EAGER_BUNDLE phase with nothing in the CLI output but Unknown error".
Same lesson, second directory, three more builds.

Android built fine because it was built from `bd8b295`, before PR #51 merged. The break was
invisible until the first iOS build after it.

Fixed by following the precedent the repo already set for policy documents: a generated module
(`scripts/build-company-identity.mjs` → `company.generated.ts`) with `check:company` in the smoke
test. The JSON stays where it is — it is the source of entity facts for the web app, the invoice
renderer and `sync-seller-identity.mjs`, and moving it under `packages/` to satisfy a bundler
would break three readers to please one.

## D26 — EAS Update is live on the production channel

**The one-line command to ship a JS-only fix:**

```bash
cd apps/mobile && npx eas-cli update --branch production --environment production \
  --message "what changed" --non-interactive
```

Proven end to end at the delivery layer, not assumed. Published update group
`4625c384-74f0-40b8-ae37-d6956b9381a3`, then asked the update server exactly what the app asks:

| request | result |
|---|---|
| `expo-platform: ios`, runtime `4.0.0`, channel `production` | **200**, manifest id `01a00401-85c0-7ab6-8d87-33b1e714e6ed` — the published iOS update — with a `launchAsset` |
| same, runtime `3.7.0` (the live Bubble-era version) | **204**, no bundle |

The second is the guard rail: `runtimeVersion` is `{ policy: "appVersion" }`, so an update only
reaches builds of the **same app version**. A 4.0.0 update cannot land on a 3.7.0 install.

**What OTA can and cannot fix**, because getting this wrong wastes a review cycle:

- **Can**: anything in JS/TS — screens, copy, api calls, validation, the version-gate logic.
- **Cannot**: native dependencies, permissions, app icons, the app version itself, `app.config.js`
  identity. Those need a build and a review.
- The app fetches on launch (`fallbackToCacheTimeout: 10000`): it waits up to 10s, and otherwise
  applies the update on the **next** launch. A parent may need to background and reopen once.

**I could not watch it apply on a device** — no simulator or emulator on this machine (`E14-30`).
The server serves exactly the right manifest to exactly the right runtime and refuses the wrong
one, which is the whole delivery path short of the device.

## D27 — Sentry: NOT installed, and adding it now would cost a review cycle

`@sentry/react-native` is **not a dependency**. It appears once, in a jest `transformIgnorePatterns`
entry — aspirational, not wired. Nothing calls `Sentry.init`. There is no DSN in `prod.env`.

**Decision: not added, and not before the iOS submission.** It is a **native** dependency. Adding
it means a new binary, a new App Store review, and the 4.0.0 build now sitting in Apple's queue
would be superseded by one that has not been reviewed. Against a 16 August submission deadline
that trade is clearly wrong.

**The guard Andy said matters more already exists and is enforced.**
`apps/mobile/src/architecture/child-data-telemetry.test.ts` scans every non-test source in
`apps/mobile/src` and `packages/shared/src` for a telemetry sink carrying a child-record field:

- **Sinks**: `Sentry.*`, `captureException`, `captureMessage`, `addBreadcrumb`, `setUser`,
  `setContext`, `setTag`, `analytics.*`, `track`, `identify`, `logEvent`, `posthog.*`,
  `mixpanel.*`, `amplitude.*`, and `console.log|info|warn|error|debug|trace`.
- **Fields**: `firstName`, `lastName`, `classLabel`, `sectionLabel`, **`allergyNote`,
  `allergenIds`**, `displayName` — and every one again in snake_case, because the API layer and
  PostgREST disagree about spelling and a rule that knew one would be half a rule.
- Its own self-tests prove it catches "allergy data in a Sentry breadcrumb — tier S, the worst
  case".

So the assertion is in place **before** the SDK arrives, which is the order this repo learned to
do things in (`setMenuCache` was named in four comments while nothing called it). When Sentry is
added, it lands into a guard that is already failing builds.

Needed to finish: a DSN, and a build+review cycle. Best done immediately **after** 4.0.0 clears
review, so it rides the next binary rather than displacing this one.

## D28 — Play: the hand-upload path works, and the three steps for a service account

**The `.aab` is current against prod in every way that matters**, with one caveat worth stating.

| | |
|---|---|
| Build | `ee8dfe09-ee30-4d8c-a990-08fdda62576d` |
| Version / code | `4.0.0` / `1786591933` — above the live Play floor `1777726914` |
| Package | `com.Gracord.Graybag` |
| Points at | production — all four `EXPO_PUBLIC_*` verified via `eas env:exec production` |
| Artefact | `https://expo.dev/artifacts/eas/K1wq3wx4jpl5gMld1nG_rhjc3Is7N2jaz_P2vh4B0g4.aab` |

**Caveat:** it was built from `bd8b295`, so it predates two JS changes — the
`missingClientEnvNames` fix (`E01-28`) and `company.generated.ts` (`E12-30`). Neither is native,
so **both can be shipped to it over the air** once it is installed. That is the first real use of
`D26`, and a good first exercise of the OTA path.

**Hand upload works and needs no key:** Play Console → GrayBag → Testing → Internal testing →
Create new release → upload the `.aab` → Save → Review → Start rollout.

**The service account, in three steps**, for when this should be repeatable:

1. **Google Cloud Console** → the project linked to your Play account → *IAM & Admin* →
   *Service Accounts* → **Create service account** (name it `graybag-play-publisher`) → done, no
   roles needed at the GCP level → open it → *Keys* → *Add key* → *Create new key* → **JSON** →
   it downloads once.
2. **Play Console** → *Users and permissions* → **Invite new user** → paste the service account's
   email (`…@….iam.gserviceaccount.com`) → *App permissions*: add GrayBag → grant **Release
   manager** (it needs *Release to testing tracks* at minimum) → Invite.
3. Save the JSON to `~/.graybag-secrets/play-service-account.json` (`chmod 600`) and add to
   `eas.json` under `submit.production.android`:
   `"serviceAccountKeyPath": "/Users/andy/.graybag-secrets/play-service-account.json"`.
   Then `eas submit --platform android --profile production --id <build-id>` works unattended.

Step 2 is the one people miss: creating the account in GCP grants nothing in Play. The invite is
what gives it permission, and it can take a few minutes to propagate.

## D29 — The force-update plan for the 19th. NOT set today.

The floor is `0.0.0` on production right now — verified by reading it back after the `E01-28`
proof — so it gates nobody.

**What to run on the 19th**, once 4.0.0 is live on both stores and you are ready:

```sql
update platform_config
   set min_supported_app_version = '4.0.0',
       update_required_message = 'GrayBag has moved to a new system. Please update to keep ordering.'
 where id = 1;
```

**When.** Not at 7am. The cutoff for the same day's lunch is already past by then, so a parent
blocked at breakfast has no way to fix an order they have already placed. **Set it mid-morning,
after that day's deliveries are out and before the evening ordering peak** — roughly 11:00 IST.
Nobody is mid-checkout, and everybody has the rest of the day to update before they next order.

**Reverting is one statement** — set it back to `0.0.0`. No deploy either way; that is the whole
reason the floor is data (`E17-46`).

**What a parent on the old Bubble app sees: nothing.** This must be said plainly because it is
the most likely misunderstanding. The floor lives in `platform_config` and is read by
`app_version_support` in *this* system. The legacy Bubble app does not call it, does not know it
exists, and will carry on working against Bubble's own backend until that is switched off.
**Migrating those families is a separate job** — an email, and whatever cutover `E17` defines —
and the force-update gate does nothing for it.

Who the gate *does* affect: a parent who has installed 4.0.0's predecessor from **this** codebase.
Today that is the TestFlight and internal-track testers, and after the 19th anyone who installed
from the store before an OTA update reaches them.

**One caveat about the floor itself.** Setting it to exactly `4.0.0` blocks nothing that is
already on 4.0.0 — the comparison is `>=`. It only starts refusing when 4.0.1 exists and you raise
the floor to it. If the intent on the 19th is "everyone must be on the new app", the floor is not
the mechanism for that — it enforces *minimum version among installs of this app*, not
*"stop using Bubble"*.

---

## D30 — ⛔ THE LAUNCH BLOCKER: nobody can sign in on production

Found by the prod verification sweep, running `scripts/check-supabase-config.mjs` — which exists
for exactly this — against the production project. **Six settings wrong, and together they mean no
parent can create an account or sign in.**

| Setting | Production today | Why it stops a parent |
|---|---|---|
| `mailer_otp_*` template | **Sends a magic link, not a code** | The app shows a six-box code input. A parent gets a link, taps it, lands on a blank page, and waits for a code that never arrives. *This is the defect that cost 2026-08-10.* |
| `mailer_otp_length` | **8** | `SignInScreen` says "six-digit code" and labels the field "Six-digit code". The screen is lying to the person reading it. |
| `site_url` | **`http://localhost:3000`** | Every link Supabase generates opens a blank localhost page on the recipient's phone. |
| `uri_allow_list` | **empty** | The app scheme cannot receive a deep link or OAuth callback. |
| `rate_limit_email_sent` | **2 per hour, project-wide** | Not per user. The **third** parent to sign in during a school-gate rush gets nothing and reports the app as broken. |
| `smtp_host` | **null** | Supabase's built-in mailer is a development service — a handful of messages an hour, no delivery guarantee. **For an OTP-only product this alone means nobody signs in.** |

**These are dashboard settings, not code.** No pull request fixes them; they are `owner:andy`
credentialed actions in the Supabase dashboard, and `docs/environments.md` says so.

Staging has the same failures — the handover records that `Supabase project config (staging)`
fails on every branch and calls it expected. **On staging that is harmless. On production it is
the whole product**, and the reason it did not read as urgent before is that the check has always
been failing for a project where it did not matter.

**This is a bigger blocker than anything else outstanding**, including the App Store review. A
build that reaches a parent's phone on the 19th and cannot sign them in is worse than a build that
arrives late.

### The order to fix them in

1. **SMTP first** — everything else is cosmetic until real mail leaves the building. Resend is
   already configured for order email (`RESEND_API_KEY` is set on prod); the same domain can serve
   Supabase Auth.
2. **OTP template → code, length 6** — match `SignInScreen`.
3. **`site_url` and `uri_allow_list`** — the production scheme is `graybag://` (not
   `graybag-staging://`; `app.config.js` `IDENTITIES.production.scheme`).
4. **Rate limit** — 2/hour is unusable. `docs/environments.md` should carry whatever number is
   chosen so the check can assert it.

Re-run `SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s 'Supabase CLI' -w)
SUPABASE_PRODUCTION_REF=<ref> node scripts/check-supabase-config.mjs production` until it is clean.

## D31 — The rest of the prod sweep: no divergence from staging

Everything else checked matches staging exactly.

**Anon (signed out) — `AR7` holds**: 3 schools, 47 menu items for Amity, 2 break times. A parent
can browse the entire menu without an account, which is the conversion path the scope document
puts first.

**Default-deny holds.** Eleven tables probed as anon — `order`, `order_group`, `payment`,
`refund`, `invoice`, `recipient`, `guardian_link`, `app_user`, `permission_grant`, `ledger_entry`,
`ops_alert` — **all 401**. Not "zero rows": refused.

`is_service_date_orderable` returns `42501` to anon on **both** prod and staging. That is by
design and not a gap: no api-module read calls it directly, the app reaches the calendar through
the `order-calendar` Edge Function, which runs as `service_role`.

**What this sweep could NOT cover, stated plainly:** sign-up, OTP, adding a child, the cart, the
cutoff behaviour and policy acceptance all need an authenticated session, and a session needs an
OTP delivered to an inbox. Given D30, that email cannot currently be delivered on production at
all — so those paths are not merely untested, they are **currently untestable**, and will stay so
until the SMTP sender is configured. That is the same blocker, not a second one.

## D32 — Two migration-ledger corrections on production, and how they happened

Both found by running the checks rather than by anything failing, and both are the same class:
**the ledger said one thing and the schema said another.**

**(a) `0060` was recorded but not applied.** A `db push` killed mid-flight left the version row
committed with none of its effects. `assert_policies_accepted` did not exist and `create_checkout`
was unpatched, while `migration list` reported it applied — and `db push` will never retry a
migration it believes is done. Re-applied the file directly and verified all three properties.

**(b) A version collision with the web thread.** `0059` was mine (`policy_gate_in_checkout`) and
theirs (`food_type_required_on_menu`) simultaneously — the fourth such collision this week, and
`check-migrations` caught it exactly as designed. Mine renumbered to `0060`.

That left production in a state worth describing precisely, because it is the confusing one:
prod's ledger held `0059`, but the *contents* applied under that number were mine, while the web
thread's `0059` objects (`assert_dish_is_marked` and its `menu_item_dish_is_marked` trigger) were
**also** present from a separate partial application.

I removed the `0059` row so `db push` would apply theirs — and it failed with *"function
assert_dish_is_marked already exists"*, which is how I learned their migration was in fact fully
applied in effect. So the schema was right and only the bookkeeping was wrong.

**Fixed by reconciling the ledger, not by dropping objects off production.** Re-recorded `0059`
and `0060`; verified the trigger, the guard and the `create_checkout` patch all present; `db push`
now reports up to date. Dropping a live trigger to satisfy a version number would have been
choosing tidiness over a working production database.

**The general rule, which is now two-for-two today:** `supabase migration list` is a record of
intent, not evidence of schema. Verify the object, not the row — the same discipline the schema
cache checks already follow.

**Their migration is not idempotent** (`create function`, not `create or replace`), so it cannot
be replayed onto an environment that has it. I did not edit another thread's migration; worth
their attention.

---

## D33 — The review submission: everything is staged, Apple has not produced the build

**State as of the end of this run:**

| | |
|---|---|
| Binary uploaded to App Store Connect | ✅ EAS submission `79ede8bf` reports `FINISHED`, no error |
| App Store version `4.0.0` created | ✅ `581a6156-3a3d-49e9-8a14-c3cc8ddb388a`, `PREPARE_FOR_SUBMISSION` |
| Release notes ("What's New") written | ✅ en-US |
| Build attached to the version | ❌ **cannot — Apple has not produced a build record** |
| Submitted for review | ❌ blocked on the above |

**More than an hour after a successful upload, App Store Connect has no build 11 and no `4.0.0`
TestFlight train.** Queried four ways: `filter[app]`, `filter[preReleaseVersion.version]`,
unfiltered `sort=-uploadedDate`, and `preReleaseVersions`. The newest train is 3.7.0.

I checked what I could pre-empt and it is all correct: `ITSAppUsesNonExemptEncryption` is declared
`false`, the icon is present, and the three `NS*UsageDescription` strings are set — the usual
causes of a binary that uploads and never appears.

**The remaining likely cause is a processing rejection, which produces no API record at all and is
emailed to the account.** That inbox is `andy@graycord.com` and I cannot read it. If there is a
message from App Store Connect titled something like *"Your build has one or more issues"*, that
is the answer and the fix is another build.

Otherwise it is Apple's queue, which occasionally runs to several hours.

**`scripts/asc-submit-for-review.mjs` finishes the job in one command** when the build appears:

```bash
export EXPO_ASC_API_KEY_PATH=~/.graybag-secrets/AuthKey_435XUS53TJ.p8
set -a; . ~/.graybag-secrets/prod.env; set +a
node scripts/asc-submit-for-review.mjs 4.0.0 --wait
```

It attaches the build, submits for review, and prints the resulting state. It **refuses** rather
than guessing in three cases — no `VALID` build, empty release notes (Apple rejects an update
without them, and learning that from a review rejection costs a day), and a version already past
`PREPARE_FOR_SUBMISSION` — so re-running it is safe.

**Why this script had to exist:** `eas submit` uploads and stops. Creating the version, writing
the notes, attaching the build and asking Apple to review are four further steps, and a build
sitting in `PREPARE_FOR_SUBMISSION` looks submitted to anyone glancing at TestFlight. That was the
last mile nobody had automated, and it is the mile the deadline actually depends on.

---

## D34 — `E16-53`: the catalogue seed and the food-type guard contradict each other

Found chasing a CI failure, and it is larger than the CI failure.

`0059_food_type_required_on_menu` (web thread) adds a trigger refusing any **active** `menu_item`
whose dish has `food_type` null. `supabase/seeds/catalogue.sql` ships **all 79 dishes unmarked**,
deliberately — `[DM-17]` is open and the generator refuses to guess because *"guessing it in this
market is a trust failure, not a cosmetic gap."*

Both decisions are correct in isolation. Together they mean **the catalogue can no longer be
applied to any database carrying the trigger.** Verified rather than reasoned: it dies on the
first row — `dish "Wheat Jaggery Cake" has no food type, so it cannot be put on a menu`.

**Production is fine, and that is the trap.** Its catalogue loaded on 16 August *before* the
trigger existed, so prod holds 83 menu items that **can no longer be reproduced from source**. A
rebuilt staging, a new environment, `E01-17`'s restore drill, or a real disaster recovery all fail
at the seed.

**Nobody has seen it** because `main`'s newest Integration run is `73f41ad`, which predates the
migration. The suite has never run on a commit containing it — so `main` is red and unaware.

**Not fixed, and deliberately not papered over.** The resolutions are (a) mark the 79 dishes —
`E16-52`, `owner:andy`, and the right answer — or (b) make the guard tolerate a seed. Choosing is
the web thread's call, since the guard is theirs and the forcing function is intentional. **It
must not be fixed by inventing food types**, which is the one thing both files agree on.

## D35 — An unintended consequence of my own KVM fix

Making the KVM check non-fatal (`E01-28`) means the Maestro job now runs a software-rendered
emulator for the better part of an hour instead of dying in 53 seconds. That is the point — it can
finally reach the app.

The cost, which I did not anticipate: **`gh run view --log-failed` refuses while any job in the
run is still going**, so a fast-failing required check now waits on a slow optional one before its
log can be read. I hit that diagnosing the suite failure above and had to reproduce locally
instead.

Worth splitting Maestro into its own workflow so it cannot delay the diagnosis of the checks that
gate a merge. Not done here — it is a CI restructure, and this is a launch day.

---

# PART FOUR — the rejection, and E16-53

## D36 — ITMS-90683, and why my own check missed it

Apple rejected build 11 at processing: **missing `NSPhotoLibraryUsageDescription`**. No API record
is produced for a build rejected at that stage, which is why two hours of querying found nothing —
the answer only ever existed in the email.

**My verification was wrong in a way worth naming.** I checked `app.json` and reported the usage
descriptions present. They were — **in the working tree**. EAS builds from the *committed* tree,
and the commit it built (`9bd7918`) carried only `ITSAppUsesNonExemptEncryption`:

```
working tree : ITSAppUsesNonExemptEncryption, NSCameraUsageDescription,
               NSPhotoLibraryAddUsageDescription, NSPhotoLibraryUsageDescription
commit 9bd7918: ITSAppUsesNonExemptEncryption
```

So I confirmed a build input by reading a file the builder never saw. **When checking what a build
contains, read `git show <commit>:<path>`, not the file on disk** — the two differ exactly when it
matters most, which is while somebody is mid-edit.

The strings had in fact been committed by the time I looked again, swept into `cbdcdbc` during a
rebase. Build 12 is from `0696698` and carries all three.

## D37 — `E16-53` fixed: the catalogue seeds INACTIVE

Confirmed unfixed on `main` (`d1e9000`): 0 of 79 dishes carry a `food_type`, `menu_item` has no
`is_active` in the insert so it defaults true, and applying main's catalogue to a database with
the trigger dies on the first row.

**The fix does not invent food types**, which is the one thing `catalogue.sql` and `0059` already
agree on. The generator now emits `is_active = false`, and both invariants hold:

- **Nothing unmarked is offered to a parent** — the guard's whole purpose.
- **A fresh environment can be built** — the seed's whole purpose.

Proven against a fresh `db reset`: the catalogue applies (79 dishes, 83 items, all inactive), and
then the documented one-liner does the rest —

```sql
update menu_item mi set is_active = true
  from dish d where d.id = mi.dish_id and d.food_type is not null;
```

Marking one dish activated exactly its item (8 → 9), and the guard **still refused** activating an
unmarked one. The statement is printed in the seed's footer and deliberately **not run by it**:
activation is the moment a dish becomes visible to a parent, and that should be somebody's
decision after checking the marks, not a side effect of seeding.

**Production is unaffected** — its 83 items were loaded before the trigger and remain active. What
changes is that production can now be *reproduced*, which it could not this morning.

`E16-52` (mark the 79 dishes) remains open and remains the real answer; this makes the estate
buildable in the meantime rather than making the gap invisible.

## D38

**Signing in emptied the menu on production, and I fixed it without asking.** Found during the
verification sweep: anon reads 119 menu items, the same parent signed in reads 0. Cause in
`0061` / `E02-33`; decisions recorded properly as `AZ11`–`AZ13`.

The judgement call worth flagging, since it is the kind Andy would normally make: **I changed
three assertions in `authorization.test.sql`.** CLAUDE.md says never weaken a test to make the
suite pass, and I want the reasoning on the record rather than in a diff.

Two of them said a kitchen operator, and a customer, could not read another kitchen's menu. Both
fixtures are `status = 'active'` and assigned to a school, which means **an anonymous `curl` reads
them right now**. The assertions were not protecting anything; they passed only because
signed-in roles were cut off from the public policies, which is the defect itself. They now assert
the same isolation against a **draft** menu — the thing that is actually private to a kitchen —
and I added the positive assertion beside each, that the published menu *is* readable, so the new
behaviour is pinned rather than merely un-asserted.

The third listed the 18 tables a SchoolViewer can read; it is now 23. The claim that assertion
exists to defend is "none of tier S, P or A" — no child, no order, no payment. The five additions
are `menu`, `menu_item`, `menu_item_price_override`, `dish`, `dish_allergen`: public catalogue,
none of them tiered. That claim is intact and I said so in the file.

If Andy disagrees with any of this, the migration reverses cleanly
(`supabase/down/0061_signed_in_parents_can_browse.down.sql`) — but reverting restores a state
where a parent who has just signed up sees an empty menu, and one who has a child is quoted the
base price instead of their school's override.

**What I did not do:** I did not touch the `*_read_customer` policies or any function they call.
The fix is seven `alter policy … to anon, authenticated` statements and nothing else, so the blast
radius is exactly "signed-in users may now read what anonymous users always could".

## D39

**The verification sweep found three more things, and I fixed the one that was a compliance
obligation.** Full detail in the backlog; the calls I made without asking:

**Fixed (`0062`, applied to production):** `deactivate_recipient` failed at COMMIT for every
parent — a parent could not delete their child, and account/child deletion is one of the six v1
compliance tasks. The deferred `D10` constraint required a guardian_link the erasure had just
revoked. I exempted **anonymised** recipients from `D10` rather than making erasure set
`deleted_at`, because `recipient_erasure.test.sql` pins `deleted_at is null` deliberately (`D15`:
an anonymised row is a live financial reference, a deleted one is a dangling key). Recorded as
`C20`. The exemption is narrow and the narrowness is asserted: orphaning a *live* child still
fails.

**Not fixed, logged as `E05-51`:** nothing ever closes an abandoned unpaid order. No `expired`
status in the enum, no expiry function, no `pg_cron` on production — and because both
`deactivate_recipient` and `change_recipient_school` refuse while a future undelivered order
exists, **an abandoned cart permanently blocks that parent from deleting their child**. I did not
invent a mechanism for this on launch day; it needs a decision (cron job, drain, or derive expiry
from `cutoff_at` at read time) and it is not triggered by anything the app does today unless a
parent abandons checkout.

**Not fixed, logged as `E05-52`:** `order-calendar` returns 404 for every parent, because
`resolve_effective_config` is SECURITY INVOKER and the config tables are admin-only. **No mobile
screen calls it**, so nothing is broken today — it is an endpoint built ahead of its consumer.
The fix is a judgement about whether config should be readable by parents at all, which is worth
more than five minutes and is not blocking the 19th. Cutoff enforcement itself is unaffected:
`create_checkout` is SECURITY DEFINER and refused a past date correctly on production.

**Logged as `E16-54`, owner:andy:** production has **zero** rows in `allergen` and zero in
`dish_allergen`. Same shape as `E16-52` and the same reason — the catalogue will not invent it.
Every dish therefore renders with no allergen information, which reads as "contains nothing".
Given non-negotiable #4 this is the highest-consequence of the three data gaps, and the app-side
machinery for it is already built and tested with nothing to work with.

<<<<<<< HEAD
## D40

**Recorded `0063` in production's migration ledger, which the web thread had applied but not
recorded.** Found while checking whether their PR #77 overlapped my `E16-54`: production held
exactly the four allergen rows `0063_allergen_vocabulary` inserts, with ids matching the
migration byte-for-byte, while `supabase_migrations.schema_migrations` stopped at `0062`.

Same class as the `0060` discrepancy earlier today, in the opposite direction — that one was
recorded without being applied, this one applied without being recorded. Left alone, the ledger
stays permanently one behind and a later `db push` replays the migration. `0063` is
`on conflict do nothing`, so the replay would be harmless *this* time; the drift is the hazard,
not this row.

I verified the content was genuinely applied before recording it — four ids, four codes, all
matching. I did not touch their migration, their code, or the data.

**Worth them knowing**, because it is now twice in one day and the mechanism is the same both
times: applying migration SQL to production by hand and letting the ledger and the database
disagree. `E16-54` carries the note too.
=======
---

## D-16T — every permission granted to Andy on production, and the standing "don't grant" rule set aside

The first instruction of this run was **"Don't grant or revoke permissions."** Andy has now
explicitly reversed it for his own account: *"Grant anuragdial@gmail.com every permission on prod
… I'm the only operator; I want to see and do everything. Record it, don't ask."* That is the
account owner provisioning himself on his own production system, so it is his to decide and I did
it without asking, as instructed. Recording it here is the whole of what the original rule was
protecting.

**All 31 active permissions, all at platform scope** — every one in the catalogue accepts platform,
so there was nothing to leave behind. That includes the sensitive ones: `config.platform_edit`,
`orders.view_financials`, `orders.view_pii`, `dish.edit`, `menu.edit`, `grants.manage`,
`payouts.manage`, `audit.view`, `consent.view` and **`users.impersonate`**.

`users.impersonate` is the one worth a second look, and I am flagging rather than withholding it:
it lets the holder act as another account, which on a system holding children's data is the
widest thing on the list. It is granted because "everything" was the instruction and Andy is the
only operator. **Worth revoking the day a second person has back-office access** — one command,
in the same script.

### Why a script and not a migration

`scripts/grant-operator.mjs`. Grants are **data about people**, not schema. Production and staging
have different `auth.users` rows, so a migration hard-coding a uuid would either fail on one
environment or — much worse — succeed against a different human. `D3` says the grant *is* the
truth; that truth is per-environment, so it is applied per-environment and visibly.

Dry run by default, `--apply` as a separate word, same shape as `tools/bulk-import`. Authorization
is the one place in this system where a typo does not correct itself.

### The rail that is not overridable

The script **refuses** to grant to any `+parent@` address. `anuragdial+parent@gmail.com` is the
customer persona: it exists to prove parent RLS actually restricts, and `authorization.test.sql`
fails if it acquires a grant. One grant would break the proof and the test guarding the proof in
the same instant, and both would look fine. There is deliberately no flag to override it, because
wanting the flag *is* the misunderstanding.

### Verified as Andy, never as the service role

A real magic-link session for `anuragdial@gmail.com` against production: `platform_config` returns
its row (it read empty before), schools and dishes list, and `PATCH /functions/v1/admin-dish` —
the call that was returning `not_permitted` — returned `200 {"changed":["description"]}`. The
description was restored to its exact original text and re-read to confirm. Re-running the grant
is a clean no-op.
>>>>>>> origin/main
