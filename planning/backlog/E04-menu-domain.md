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
- [ ] `E04-14` Expose `food_type` through `public_menu` — the view never selected it, so the mark cannot reach the app at all even once it is set. `packages/shared/src/menu/types.ts` already declares `foodType: FoodType | null`, so the client is typed for a field the read path does not carry. Bumps `school_menu_version` (`MC*`), because a cached menu without the column must not render as "not stated"
- [ ] `E04-15` Load the returned veg/egg/non-veg marking sheet (`tools/food-type-sheet/`) into `dish.food_type`, matching by name with the six duplicate names resolved per `docs/bubble-recon-findings.md` §9. Plan-then-apply like the menu importer; blank stays blank
- [ ] `E04-16` Make `food_type` structurally required — add `not_stated` to the enum and set the column `not null` with **no default**, so a dish cannot be created without someone choosing. Two migrations: `ALTER TYPE … ADD VALUE` cannot run in the transaction that uses it (same constraint `M9` hit with `bank`). Depends on `E04-15`
- [ ] `E04-17` (risk:high) School-level menu restriction, **enforced server-side**: `school.allowed_food_types`, a refusal at menu assignment, a refusal at menu-item edit for menus already assigned to a restricted school, a filter in `public_menu`, and a checkout refusal with its own error code. A menu belongs to a *kitchen* and is shared across schools (`menu.kitchen_id`, `menu_assignment`), so this cannot be done by editing the menu. `not_stated` must fail closed. Needs allow-and-deny tests on all four paths (non-negotiable #2). Backs the website's written commitment that a school's menu contains only what it agreed to
- [ ] `E04-18` Interim guard until `E04-17` lands: refuse creation of any `non_veg` dish. One trigger, dropped by `E04-17`. The website's commitment cannot be broken while no non-veg dish exists, so this converts a promise-breaking risk into a build-order dependency

