# Decisions — Authorization fixes

`AZ8`–`AZ13` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

Made in `E02-08` / `E02-09`, on the first execution of `supabase/tests/authorization.test.sql`.

| # | Decision | Why |
|---|---|---|
| AZ8 | **Fulfilment access to `recipient_allergen` is bound to `kitchen` or `school` scope, never `platform`** (`0004`, `auth_recipient_has_fulfilment_order`) | `auth_has_permission` treats a platform-scope grant as satisfying any scope check, so `platform_admin`'s `orders.view_pii` opened the kitchen fulfilment policy on every child who had ever ordered — contradicting §7.2's stated model and non-negotiable #4. Fulfilment happens at a kitchen; it never happens at the platform, so the policy now says that positively rather than inheriting scope widening |
| AZ9 | **`auth_recipient_has_visible_order` is left unchanged and the new function sits beside it** | The old function is still correct for `recipient` itself, which is tier P (name, class, section) and where platform-admin access *is* intended. Narrowing it globally would have removed access the model deliberately grants — the fix belongs at the one policy whose data class demands it |
| AZ10 | **The allowed scopes are enumerated positively (`school`, `kitchen`) rather than excluding `platform`** | `city` is not reachable today because `0001` restricts `orders.view_pii` to `{platform,kitchen,school}`. An exclusion list would silently admit `city` the day that restriction changes; an inclusion list fails closed |

## `AZ11`–`AZ13` · public catalogue reads, `E02-33` / `0061`

Made on 2026-08-15, during the production verification sweep. An anonymous visitor read 119 menu
items on production; the same parent one second after signing in read **zero**.

| # | Decision | Why |
|---|---|---|
| AZ11 | **The public browse policies are addressed `to anon, authenticated`, not `to anon`** (`0061`) | PostgREST serves any JWT-bearing request as `authenticated`, and a role that is not `anon` cannot match a policy addressed to `anon`. Signing in therefore *removed* access that every anonymous request already had, leaving only the `*_read_customer` policies — scoped to schools the parent has a child at, which for a new parent is none. `AR7` says adding a child must not be a wall in front of browsing the menu; this was that wall, moved to just after the parent commits, where it is worse. Predicates are untouched: a signed-in parent sees exactly what a visitor sees, and every row admitted was already world-readable |
| AZ12 | **A published menu is public data, and no role is protected from reading it** | `authorization.test.sql` asserted that a kitchen operator could not read another kitchen's menu, and that a customer could not read another kitchen's. Both fixtures were `status = 'active'` and assigned, so **anon reads them from any browser** — the assertions were describing the bug in `AZ11`, not a property. They now assert the same isolation against a **draft** menu, which is what is genuinely private to a kitchen. Changing a test to match reality is only legitimate when the old claim was false; it was, and the evidence is that an anonymous `curl` returns the row. Recorded here rather than left in a commit message because "we relaxed three authorization assertions" is exactly the sentence that must never be discovered later without its reasoning |
| AZ13 | **The `anon_*` policy names are kept even though they now serve `authenticated` too** | `authorization.test.sql` §12 pins the permissive-policy inventory by name, so renaming seven policies means editing the inventory in the same breath as changing what it asserts — on launch day, to improve a label. The name records which migration introduced a policy, not who it serves. Revisit only if the inventory is being touched for another reason |

**The class of bug, which is the part worth carrying forward.** Three of the four `MENU_CACHE_EPOCH`
bumps now have the same cause: an authorization change that reaches the app as `200 []`. PostgREST
cannot distinguish "refused" from "empty", so every one of these looks like a content problem and
none of them moves a menu version. `MenuUnreadableError` exists for it, the epoch table exists for
it, and it still took a manual sweep as a clean parent to find this one. The general lesson:
**any policy change must be verified as the least-privileged real principal, not as the account
doing the verifying** — which is `E02-32`'s rule, and the only reason this was caught before the
19th.
