---
id: E04
title: Menu Domain — Import, Versioning, Caching
phase: 3
risk: high
status: not-started
depends_on: [E02]
summary: Dishes, menus, per-school assignment, Excel import with allergens, and the version-based cache that makes the app feel fast.
---

## Context

Today: 1 kitchen, 3 menus, 3 schools; largest menu is 50 items. Menu changes are rare, which is exactly what makes version-based caching effective.

Source Excel columns: `Item No. | Menu Item | Description | Ingredients | Calories | Portion/Weight | Allergens | Category | Category - ORIG | Price`.

## Tasks

- [ ] `E04-01` (mvp) Dish CRUD with structured **allergen tags** parsed from the Allergens column (not free text)
- [x] `E04-02` (mvp) Menu + MenuItem model with per-menu pricing and `available_days`
- [x] `E04-03` (mvp) MenuAssignment: school <-> menu with validity dates; supports shared and per-school menus
- [x] `E04-04` (risk:high) (mvp) **Excel importer**: validate, preview a diff, then apply. Never silently overwrite
- [x] `E04-05` (mvp) Importer supports optional columns `image_filename`, `available_days`, per-school price override; drops `Category - ORIG`; keeps `Category`
- [x] `E04-06` (mvp) Bulk image upload from a folder alongside the import file, matched by filename
- [ ] `E04-07` (mvp) Image pipeline: resize to 3 sizes, AVIF/WebP, served from CDN with long cache headers
- [x] `E04-08` (risk:high) (mvp) `menu_version` incremented on any change to an assigned menu
- [x] `E04-09` (mvp) Tiny `GET /menu/version?school=X` endpoint (a few bytes) the app calls on open
- [x] `E04-10` (risk:high) (mvp) App-side menu cache: store menu JSON + version locally, refetch only on version change
- [ ] `E04-11` Read-only offline: cached menu and past orders browsable with no network
- [x] `E04-12` (mvp) Category browse tabs **plus** search — needed at 50 items ("cold coffee" must be findable)
- [ ] `E04-13` (mvp) Migrate the 3 existing menus and re-source or re-upload all dish images

- [ ] `E04-15` Swap the menu cache's in-memory store for AsyncStorage so it survives a restart. Needs the native dependency and therefore a new dev-client build, which is why `installMenuCache` ships with an in-memory store first
- [ ] `E04-16` Move `fetchMenuVersion` onto the `menu-version` Edge Function instead of reading `school_menu_version` directly. The function runs with `service_role`, so its answer cannot itself be filtered away by a grants problem — which is what the empty-menu-vs-refused-read distinction depends on

- [ ] `E04-20` **"My school is not listed" has no handler.** `SchoolPicker.onRequestSchool` is accepted and never passed, so a parent whose school is not on the list has no way to say so — and with three schools live, most visitors are in exactly that position
