# Progress

Newest handover at the top. Assume the reader has forgotten everything.

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

### The Android build

`eas build --profile preview --platform android` — version **2.0.0**, build **1**, project `@anuragdial/graybag`.

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

Done: `E05-04`, `E05-07`. Half done: `E05-08` (server yes, calendar UI no).

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
