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
