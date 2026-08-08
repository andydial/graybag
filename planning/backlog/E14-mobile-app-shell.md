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
- [ ] `E14-03` (mvp) Navigation structure: Home / Menu, Cart, Orders, Profile
- [ ] `E14-05` (mvp) List virtualisation for the menu; no jank at 50+ items with images
- [ ] `E14-06` (mvp) Image loading: progressive, cached to disk, correct size for the device, never re-downloaded
- [ ] `E14-07` (mvp) Cold start budget set to the **numbers produced by `E19-02`** and enforced in CI as a failing gate
- [ ] `E14-08` (mvp) Optimistic UI on cart actions; sync in the background
- [ ] `E14-09` (mvp) Network resilience: retries with backoff, clear offline state, no infinite spinners
- [ ] `E14-10` Read-only offline mode wired to the menu cache and cached order history
- [ ] `E14-11` (mvp) OTA updates via EAS Update, with a rollback path
- [ ] `E14-12` Force-upgrade mechanism for breaking changes (replaces the legacy `update_app` view)
- [ ] `E14-13` E2E test suite on a real device profile in CI
- [ ] `E14-14` (mvp) Screens rebuilt to the new design system — Home, Menu, Dish detail, Cart, Checkout, Orders, Order detail, Profile, Dependents, Login, Signup, T&Cs
