# Progress

Newest handover at the top. Assume the reader has forgotten everything.

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
