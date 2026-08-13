---
id: E14
title: Mobile App Shell & Performance
phase: 3
risk: high
status: not-started
depends_on: [E13, E01]
summary: React Native + Expo shell, navigation, the api/ module discipline, and the performance work that matters — mostly **slow and unreliable networks**, which is the real constraint; devices are mid-range, not bottom-tier.
---

## Locked decisions

- **React Native + Expo**, TypeScript. Reanimated for UI-thread animation, Skia where custom motion is needed.
- **Rule:** every backend call goes through a single `api/` module. Reads use the Supabase client, **writes always go through Edge Functions**. This is what keeps "add a dedicated API server later" a config change rather than a rewrite.
- Bundle IDs are fixed and must match exactly: iOS `com.gracord.graybag`, Android `com.Gracord.Graybag` (note the capitals).

## Tasks

- [x] `E14-01` (mvp) Expo project scaffolded with the existing bundle IDs, app icon and splash from the brand package
- [x] `E14-02` (risk:critical) (mvp) **Enforce the `api/` module rule** — lint rule that fails the build if a screen imports the Supabase client directly, or if any privileged key reaches the bundle (`E01-18`)
- [x] `E14-03` (mvp) Navigation structure: Home / Menu, Cart, Orders, Profile
- [x] `E14-05` (mvp) List virtualisation for the menu; no jank at 50+ items with images
- [x] `E14-06` (mvp) Image loading: progressive, cached to disk, correct size for the device, never re-downloaded
- [ ] `E14-07` (mvp) Cold start budget set to the **numbers produced by `E19-02`** and enforced in CI as a failing gate
- [ ] `E14-08` (mvp) Optimistic UI on cart actions; sync in the background
- [x] `E14-09` (mvp) Network resilience: retries with backoff, clear offline state, no infinite spinners
- [ ] `E14-10` Read-only offline mode wired to the menu cache and cached order history
- [x] `E14-11` (mvp) OTA updates via EAS Update, with a rollback path
- [ ] `E14-12` Force-upgrade mechanism for breaking changes (replaces the legacy `update_app` view)
- [ ] `E14-13` E2E test suite on a real device profile in CI
- [ ] `E14-14` (mvp) Screens rebuilt to the new design system — Home, Menu, Dish detail, Cart, Checkout, Orders, Order detail, Profile, Dependents, Login, Signup, T&Cs
- [x] `E14-15` **Safe-area frame at the shell**, applied where routes are registered rather than screen by screen — the first iOS build drew every screen from y=0, under the status bar
- [x] `E14-16` **Real tab bar icons.** All four tabs fall through to React Navigation's default placeholder triangle; there is no icon set in the project at all
- [x] `E14-17` Placeholder screens say something a parent can read. They currently ship developer notes to the device ("Browsable signed out", "Never a wall — the tab still opens")
- [x] `E14-18` (risk:critical) **A non-worklet function called from inside a worklet aborts every release build.** Two gates: a lint rule with an allowlist, and a test asserting the allowlisted names carry `__workletHash`. Found by the first iOS build crashing on any screen with a `TextField`

- [ ] `E14-19` (risk:critical) One `ListState` type — `loading | data | empty | unreachable | forbidden | stale` — that every list screen must exhaust, so a screen cannot render "nothing here" for a backend it could not reach (ux-spec §5.21)
- [ ] `E14-20` (risk:high) Build the Can't-connect screen (ux-spec §5.20) and route an unconfigured or unreachable client to it, instead of letting every screen fail in its own way
- [ ] `E14-21` (risk:high) Separate the collapsed empty/error/forbidden/stale states listed in the ux-spec §5.21 audit table — menu, menu allergens, children, orders, school picker
- [ ] `E14-22` (risk:critical) Persist the cart to disk on every mutation and restore it before first render; ids, quantities, child and service date only — never prices, never a child's name (ux-spec §5.7.1)
- [ ] `E14-23` (risk:high) Make the email-OTP screen survive backgrounding and process death — digits, timestamp-anchored resend timer, pending address, and the interrupted checkout intent; clipboard auto-fill that never auto-submits (ux-spec §5.9.1)
- [ ] `E14-24` (risk:critical) Maestro: the ux-spec §6.1 flow against a real build and real staging, in CI — launch, pick a school, see dishes, open one, add to cart, sign in, add a child, place an order. Asserts the screen count so a re-added step fails CI
- [ ] `E14-25` Run the §6.1 Maestro flow a second time at the largest accessibility text size
- [ ] `E14-26` A connectivity source (NetInfo or equivalent). Six screens now take a `stale`/`offline` prop that **nothing supplies**, so every offline state is unreachable in the real app — they can only infer it from a request that already failed, which is too late to pre-disable a button
- [ ] `E14-27` `ListRow` needs a `leading` slot, a `tone`, and an `accessibilityLabel` override. Three screens have now hand-rolled its geometry rather than use it: Orders (its merged label drops the status word), Children (no leading slot), Account (no danger tone)
- [ ] `E14-28` Swap the connectivity probe for a real link-layer signal (NetInfo or `expo-network`) when a new dev-client build is due. `ConnectivityContext` measures whether our backend is reachable, which is the more useful question but a weaker one — it can only learn from a request or a probe. Native module, so it cannot ship to an installed dev client
- [ ] `E14-29` Extend the orphan guard to catch defect 4: an exported module in `packages/shared` that nothing imports. The current guard covers contexts, providers, stores and injection seams in `apps/mobile/src` — E13's unconsumed design tokens were none of those, so it would not have caught them
- [ ] `E14-30` (owner:andy) (risk:high) **Install Xcode or the Android SDK on the build machine so Maestro can run.** `E14-24`'s flow has still never executed: there is no simulator, no emulator and no Maestro binary on this machine, so the e2e net cannot be proven at all. Ten screens are now shipping behind a test suite that has never run once
- [ ] `E14-31` (owner:andy) **Add `/Volumes/Data` to Docker Desktop's file sharing** (Settings → Resources → File Sharing). Without it `supabase test db` bind-mounts `supabase/tests` as an empty directory and pg_prove runs zero files while exiting 0 — `npm run test:all` was green on nothing until 2026-08-11. `scripts/test-db.sh` no longer depends on that mount (it runs the suite through `psql` over TCP), so this is not blocking anything; it is worth doing so `npx supabase test db` behaves as documented when reached for directly
- [ ] `E14-33` **The orphan guard does not notice when a known orphan stops being one.** `KNOWN_ORPHANS`'s stale-key check asserts the key is still *produced by the scan*, not that the prop is still *unwired* — so an exemption for something since fixed sits there forever, silently exempting a prop that could become an orphan again with nobody told. Found wiring `E20-36`: deleting the three `PolicyGateScreen` entries by hand was the only thing that proved the gate now has a caller. Make a fixed orphan fail the guard and name itself
- [x] `E14-34` **Five dead navigations and a one-way school choice.** `navigate('Tabs')` from a screen already inside the tabs is a no-op, so Home's "Open the Menu", its choose-a-school prompt, its retry, the Orders empty state and Order detail's back-to-menu all did nothing — and all typechecked, because `Tabs` was `undefined` in the param list and the nested form was not expressible. `Tabs` is now `NavigatorScreenParams<TabParamList>`. Separately: `SchoolPicker` unmounts once a school is set, so the choice was invisible and permanent — the menu now names its school and offers Change
- [ ] `E14-35` **A guard for the dead-navigation class.** `reachability.test.ts` proves every route has a `navigate('X')` somewhere; it cannot see that `navigate('Tabs')` from inside `Tabs` moves nobody. Five buttons were dead for weeks with a green reachability suite. Assert that a tab route is only ever navigated to with a `screen` param, or find the general form
