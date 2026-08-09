# Decisions — Environments and secrets

`EN1`–`EN5` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

Made in `E01-07`. The rotation *inventory* and cadence stay in `docs/secret-rotation-policy.md`;
these are the mechanism choices that sit under it.

| # | Decision | Why |
|---|---|---|
| EN1 | **`local` and `staging` share the one Razorpay test account; only production is live** | There is no third Razorpay account to have, so the rule collapses to a single checkable sentence — *staging must never hold a live key* — rather than a matrix nobody remembers |
| EN2 | **The test/live key rule is a load-time assertion in `packages/shared/src/env.ts`, checked in three places: before secrets are sent, at Edge Function boot (`E06-14`), and in the unit suite** | Principle 4 of the rotation policy says test/live isolation is a rotation concern, not just a deploy concern. One check at deploy time would not catch a value changed by another route; one check in tests would not catch a bad value at all. The three together mean there is no path that sets a live key in staging quietly |
| EN3 | **`loadClientEnv()` throws if a server-only secret is merely *present*, not just if it is used** | A client build that can *see* `SUPABASE_SERVICE_ROLE_KEY` is one careless `process.env` reference from shipping the credential that bypasses RLS. Failing on presence turns a code-review question into a build failure. `E01-18` asserts the same property on the built bundle; this asserts it at the source |
| EN4 | **Secrets are written by `npm run secrets:set -- <env>` from a gitignored per-environment file, never through a provider dashboard** | Hand-editing is how the legacy app ended up with a live key in an export. A dashboard has no validation, no record of what changed, and no way to tell afterwards whether staging and production diverged. The script validates before a single value leaves the machine |
| EN5 | **The secrets file must name its own environment, and the script refuses if it disagrees with the command line** | `secrets:set -- staging` pointed at a file of production values is one typo, and it is the typo that moves real money. The file declaring `APP_ENV` makes the two halves check each other |

## Added by `E14-11`, 2026-08-09 — the client half, and OTA

`EN1`–`EN5` cover **server** secrets: what lives where, and `npm run secrets:set` pushing a
gitignored `.secrets.<env>.env` to the Edge Function tier. Nothing covered the **client**
values that ship inside the bundle, and hand-swapping those before each test is the practice
`A7` set out to end.

| # | Decision | Why |
|---|---|---|
| EN6 | **`apps/mobile/.env.staging` and `.env.production` hold the `EXPO_PUBLIC_*` values; `npm run dev:mobile[:prod]` copies the chosen one onto `.env` at start. You edit those files, never `.env`** | Lifted from the Dubbaa project rather than re-solved, on Andy's instruction — it is a working answer to the key-swapping problem and re-deriving it would have cost a day to arrive somewhere similar. The indirection is what makes it work: `.env` is overwritten on every start, so an edit there is lost, and the only durable place to put a value is the per-environment file. Two files for two trust levels — publishable `EXPO_PUBLIC_*` here, server secrets in `.secrets.<env>.env` (`EN4`) — and `EN3` already fails the build if a server-only name appears on the client side |
| EN7 | **A development build refuses to run against production unless `EXPO_PUBLIC_ALLOW_PROD=true`** | `EN2` catches a *mismatched* environment — a live Razorpay key with `APP_ENV=staging`. It cannot catch a correctly configured production environment being used by a dev build, because nothing about that is inconsistent: every check passes. The failure is silent and expensive: a developer testing checkout creates a real order for a real child, charges a real card, and the screen looks identical. The flag lives only in `.env.production`, and anything other than the exact string `true` fails closed — `ALLOW_PROD=1` is somebody guessing at the syntax, and guessing right by accident is worse than being told. The guard throws rather than returning a boolean, because a boolean invites an `if` somebody forgets |
| EN8 | **`runtimeVersion` is `appVersion`, so an OTA update only reaches builds carrying the same app version** | This is the safety property of the whole feature. `nativeVersion` or a fixed string would let a bundle expecting a new native module ship to a binary without one — which crashes on launch, for everyone, with no way to push a fix except a store release. The cost is that a native change forces a real build, and that cost *is* the guarantee. Asserted in `app-config.test.ts`, because it is invisible until it is wrong |
| EN9 | **Fetching an update never applies it. `applyUpdateNow` is separate and may not be called from a timer, a focus listener or an app-state change** | Reloading under a user is the one thing OTA can do that a store release cannot, and doing it mid-checkout is how a payment lands in a state nobody can reconcile (`L4`, `[OL-05]`). A downloaded update applies itself at the next cold start, which is a moment nobody is mid-anything. `E14-12`'s force-upgrade is the separate mechanism for when waiting is not acceptable |
| EN10 | **An update check never surfaces an error to the user** | It is not something they asked for. The app they have works, and the right behaviour on a bad network is to carry on with it (`P8`, `MC3`) — failing loudly would turn a routine offline moment into an error screen. Every failure becomes a return value; the function cannot throw |
| EN11 | **Each build profile gets its own update channel, and the build number comes from EAS (`appVersionSource: remote`)** | Two profiles sharing a channel means an internal build's bundle reaches customers. Taking the build number from the repo instead of EAS lets two machines mint the same one, which the stores reject at submit — after the build has been paid for and waited on |

**Still owed by Andy:** the App Store Connect app id (`ascAppId`). Deliberately absent from
`eas.json` rather than guessed — it is not needed until the first `eas submit`, and a wrong one
submits to somebody else's listing.

**The rollback path is in `apps/mobile/src/updates/ota.ts`**, next to the code, because the
moment you need it is the worst moment to be reading documentation. In short: there is no undo,
you publish the previous good commit as a *new* update on the same channel. A bad **native**
build is a store rollback instead, and during cutover `R3`'s 30-day Bubble break-glass outranks
both.
