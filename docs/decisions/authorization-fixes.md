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

### One owner, derived rather than enumerated — `E02-39`, 2026-08-28

Andy: *"Stop granting me permissions one at a time. I want one owner account — mine — that holds
everything by construction… my preference is that the owner is derived rather than enumerated: a
single recorded account against which permission checks pass, not a list of grants somebody keeps
in step."* Approved in full on 2026-08-28, boundary included. The design and the DDL are in
`docs/proposals/E02-39-derived-platform-owner.md`; these are the decisions inside it.

| # | Decision | Why |
|---|---|---|
| AZ14 | **The owner derives permissions and never relationships.** The short-circuit goes in `auth_has_permission` — the one function every `auth_can*` resolves through — and deliberately *not* in `auth_can_reach_recipient`, `auth_can_manage_recipient` or `auth_can_order_for_recipient` | Those three answer whether a live `guardian_link` exists: a relationship a parent created, not a permission anyone holds. Putting the owner in them would make one account the implicit guardian of every child, reading every allergy note and free-text medical detail on the one table whose entire design is that access follows a link somebody actually made. Children's data is regulated under the DPDP Act (non-negotiable #4) and there is no lawful basis in "it was easier". Andy, approving: *"convenience is not a lawful basis"* |
| AZ15 | **Its own single-row table, not a `platform_config` key** | `platform_config` is writable by anyone holding `config.platform_edit`. An owner stored there is a permission that grants itself every other permission, which is the one shape this must not have. The table has **no write policy at all** — ownership moves by migration or `service_role`, and by nothing a screen can do |
| AZ16 | **Exactly one, at the storage layer.** `only_one boolean primary key default true check (only_one)` | A `unique` index on a constant column, or a trigger counting rows, are both conventions that hold until somebody writes the row a different way. A primary key that admits one value and a check that admits one value cannot be circumvented by any insert |
| AZ17 | **The owner is still subject to `is_disabled` and `deleted_at`**, exactly as a grant holder is | Otherwise the most powerful account on the platform is the one account that cannot be switched off. `auth_is_owner()` joins `app_user` for the same reason `auth_has_permission` does |
| AZ18 | **Ownership moves only by migration, with a stated reason, into an append-only history** | Difficulty is not visibility. A migration is reviewable and diffable; the `reason` column is `not null` so it cannot move unexplained; the history trigger records both directions so "who was the owner in March" has an answer |
| AZ19 | **No test may run as the owner**, and the short-circuit's own test uses a throwaway owner inside a rolled-back transaction | Andy's second guard, and it is the failure we already hit: the parent screens were once diagnosed with an account holding 31 grants, which proved nothing about a parent. An implicit superuser that the suite runs as would mask every broken policy at once. A pgTAP assertion checks the owner's id does not carry `-7e57-`, the marker every seeded fixture user carries |
| AZ20 | **`auth_is_back_office()` and `auth_has_any_grant()` get the owner too**, and this is flagged rather than assumed because each is a widening | Neither routes through `auth_has_permission`; they answer "is this person back office at all" and widen reference-data reads. Left alone, the owner would hold every permission and still fail them — a strange partial experience rather than a safe one |
| AZ21 | **The client half ships first and is inert.** `auth_is_owner()` is called through a wrapper that reads `PGRST202`/`42883` as `false`, and `fetchPlatformOwner()` reads `PGRST205`/`42P01` as `null` | `E02-36`'s lesson applied in advance: a client and a migration that must land together will land in the wrong order eventually. "There is no such function" is not a failure, it is the truthful answer *"there is no owner yet"* — so the back office behaves identically before and after, and neither half can break the other. Nothing else is swallowed: a network failure still throws, because a failed read and a real answer are different facts |
| AZ22 | **The owner is labelled `Owner — everything, by construction`, and never borrows a job name** | Andy: *"Don't let it borrow a job name it isn't."* It holds none of Platform admin's twenty-two grants, so calling it Platform admin would be `E10-64`'s bug in reverse — a confident label for permissions the account does not hold. It also gets its own section on `/admin/people`, because `fetchAccess` lists accounts that *hold* something and would otherwise leave the most powerful account invisible on the screen whose entire job is answering who can do what |
