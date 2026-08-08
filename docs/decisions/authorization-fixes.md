# Decisions — Authorization fixes

`AZ8`–`AZ10` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

Made in `E02-08` / `E02-09`, on the first execution of `supabase/tests/authorization.test.sql`.

| # | Decision | Why |
|---|---|---|
| AZ8 | **Fulfilment access to `recipient_allergen` is bound to `kitchen` or `school` scope, never `platform`** (`0004`, `auth_recipient_has_fulfilment_order`) | `auth_has_permission` treats a platform-scope grant as satisfying any scope check, so `platform_admin`'s `orders.view_pii` opened the kitchen fulfilment policy on every child who had ever ordered — contradicting §7.2's stated model and non-negotiable #4. Fulfilment happens at a kitchen; it never happens at the platform, so the policy now says that positively rather than inheriting scope widening |
| AZ9 | **`auth_recipient_has_visible_order` is left unchanged and the new function sits beside it** | The old function is still correct for `recipient` itself, which is tier P (name, class, section) and where platform-admin access *is* intended. Narrowing it globally would have removed access the model deliberately grants — the fix belongs at the one policy whose data class demands it |
| AZ10 | **The allowed scopes are enumerated positively (`school`, `kitchen`) rather than excluding `platform`** | `city` is not reachable today because `0001` restricts `orders.view_pii` to `{platform,kitchen,school}`. An exclusion list would silently admit `city` the day that restriction changes; an inclusion list fails closed |
