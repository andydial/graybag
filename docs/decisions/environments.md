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
