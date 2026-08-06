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

- [ ] `E04-01` Dish CRUD with structured **allergen tags** parsed from the Allergens column (not free text)
- [ ] `E04-02` Menu + MenuItem model with per-menu pricing and `available_days`
- [ ] `E04-03` MenuAssignment: school <-> menu with validity dates; supports shared and per-school menus
- [ ] `E04-04` (risk:high) **Excel importer**: validate, preview a diff, then apply. Never silently overwrite
- [ ] `E04-05` Importer supports optional columns `image_filename`, `available_days`, per-school price override; drops `Category - ORIG`; keeps `Category`
- [ ] `E04-06` Bulk image upload from a folder alongside the import file, matched by filename
- [ ] `E04-07` Image pipeline: resize to 3 sizes, AVIF/WebP, served from CDN with long cache headers
- [ ] `E04-08` (risk:high) `menu_version` incremented on any change to an assigned menu
- [ ] `E04-09` Tiny `GET /menu/version?school=X` endpoint (a few bytes) the app calls on open
- [ ] `E04-10` (risk:high) App-side menu cache: store menu JSON + version locally, refetch only on version change
- [ ] `E04-11` Read-only offline: cached menu and past orders browsable with no network
- [ ] `E04-12` Category browse tabs **plus** search — needed at 50 items ("cold coffee" must be findable)
- [ ] `E04-13` Migrate the 3 existing menus and re-source or re-upload all dish images
