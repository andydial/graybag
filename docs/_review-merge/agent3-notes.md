# Agent 3 review-merge notes — authorization model, 0002, authz tests

Scope: only `docs/authorization-model.md`, `supabase/migrations/0002_rls_policies.sql`,
`supabase/tests/authorization.test.sql`. Findings #10, #14, #15, #16, #27 from
`docs/overnight-review.md` §2.10/§2.11.

**Headline correction.** Three of the five findings describe an *earlier* state of the repo.
The 0002 / test files on disk already implement most of what the review said was missing. The
review's own instrument was wrong for one of them: `grep -c '^revoke\|^grant' 0002` returns 0
because **every** `revoke`/`grant` in 0002 is indented, inside a `do $$` block, or issued via
`execute format(...)` — none begins at column 0. A case-insensitive `grep -icE 'revoke |grant '`
returns 25. So I did **not** re-add duplicate SQL (that would have created conflicting
definitions once E02-18 runs `supabase start && supabase test db`). I updated the docs to record
the true state and added the one genuinely-missing test.

## Findings fixed

### Finding #10 (§2.10) — `effective_config_public()` — E02-20
- **Already implemented** in `0002` §1.7 (lines ~454–480): a `SECURITY DEFINER` wrapper over
  `resolve_effective_config()` returning only the customer-safe fields (omits `revenue_share_bps`
  and `sac_code`), gated on `auth_can_reach_school() OR auth_school_is_public() OR
  auth_can('orders.view','school',…)`, granted `execute` to `authenticated`/`service_role` in
  §14's per-function loop. Already exercised by test Part 8 (`§9` items 25–26).
- **Doc change** (`authorization-model.md`): §3's trap paragraph reworded from "§7.6 fixes this
  with" to state the wrapper **exists in `0002` §1.7** and is exercised by the suite; §14 table
  row marked **done** and re-tagged E02-20 (was E02-10). No SQL added — it was already there.

### Finding #14 (§2.11) — §10 GRANT/REVOKE second layer — E02-21
- **Already implemented** in `0002` §14 (lines ~1246–1372): `revoke all … from anon` on tables/
  sequences/functions + `alter default privileges … revoke … from anon`; a `do $$` loop
  `revoke insert, update, delete` on the 37 class-3 tables from `authenticated`; a per-function
  loop `revoke all … from public` then `grant execute … to authenticated, service_role` over all
  27 helper functions. Already asserted by test Part 1 (`has_table_privilege` for anon and every
  class-3 table).
- The finding is a **false positive from an anchored grep** (see headline). No SQL added.
- **Doc change**: §14 table row marked **done**, re-tagged E02-21 (was E02-08), with the grep
  false-negative explained in the section preamble so it is not re-raised a third time.

### Finding #16 (§2.11) — the `[AZ-02]` self-enforcing tripwire — E02-23
- The `[AZ-02]` orders.view/orders.view_pii tripwire **already existed** in test Part 9 (role
  templates + live grants, city scope excluded).
- **What I added** (`authorization.test.sql`, Part 9): a **§10 forbidden-write-grant tripwire** —
  the sibling the review's framing asks for ("a test that FAILS the moment a forbidden grant …
  that would bypass RLS appears"). Two assertions:
  1. a `set_eq` asserting `authenticated` holds a write privilege on **exactly** the non-class-3
     public tables (the positive complement of Part 1's negative class-3 assertion), defined
     structurally as `public tables NOT IN tests_class3` so it cannot drift;
  2. an `is_empty` set-form restatement that no class-3 table carries INSERT/UPDATE/DELETE for
     `authenticated`, so a single new grant names its own table on failure.
  Together with Part 1 these pin the write surface from both sides: any `GRANT INSERT ON "order"
  TO authenticated`, or any class-3 table drifting out of the revoke list, now fails CI.
- Part 9 header comment updated to name both tripwires. Doc §14 marked **done** (E02-23).

### Finding #27 (§2.11) — last-4-phone search must be an Edge Function — E09-13
- Already stated in prose in doc §7.2 and `0002` comment, but referenced the stale `E09-07` and
  did not spell out the return shape.
- **Doc change** (`authorization-model.md` §7.2 callout + §14 row): now explicit — served by an
  **Edge Function** returning **only a match boolean / the matching orders' last-4**, never the
  phone number and never a `SELECT` on `app_user`; enforced today by the *absence* of any
  kitchen-scoped `app_user` policy; re-tagged **E09-13** (E09-07 builds the search UI, E09-13
  owns the mechanism).
- **Code change** (`0002` §7.2 comment): matching rewording, same substance.

## Backlog tasks completed

I do not edit `planning/backlog/*` (isolation rule), so these are *status assertions* for the
merge owner to reconcile:

- **E02-20** (`effective_config_public()`) — **fully implemented already in `0002`**; my work
  was documentation truth-up + test-coverage confirmation. Nothing left to build.
- **E02-21** (§10 privilege revokes) — **fully implemented already in `0002`**; documentation
  truth-up only. Nothing left to build.
- **E02-23** (self-enforcing tripwire) — **fully implemented**: `[AZ-02]` tripwire pre-existed;
  I **added** the §10 forbidden-write-grant tripwire. Complete.
- **E09-13** (last-4 as Edge Function) — **spec only, not built**. The *rule* is now stated
  unambiguously in doc §7.2/§14 and the `0002` comment, and is enforced defensively by the
  absence of a kitchen `app_user` policy. The actual Edge Function is application code outside
  my three files — remains open build work for E09-13.

## Deferred to task / open question

- **E02-22 — storage buckets.** Bucket **creation** SQL already exists in `0002` §15 (guarded
  `insert into storage.buckets … on conflict do nothing`, skipped when the storage extension is
  absent). I did **not** add or duplicate it. Bucket **policies** are correctly *absent* — a
  private bucket with RLS on and nothing to permit denies everyone; the one public bucket
  (`dish-images`) is served by the CDN without consulting RLS. What is genuinely **not built**,
  and I deliberately did **not fabricate**, is the **signed-URL discipline**: the Edge Functions
  that mint short-lived signed URLs for `invoices`/`reports`/`imports` after checking
  `auth_owns_group()` / `invoices.view` / `reports.view`. `invoice.pdf_asset_id`
  (`gst-invoicing.md` §8 note 6) depends on it. In real environments buckets are provisioned via
  the storage API/CLI, so this is a provisioning + Edge-Function task, **E02-22**, not schema
  SQL. Recorded in doc §14 as a separate "not built" row. **Merge owner: create/confirm E02-22**
  as "three private buckets reached only by signed URL + one public CDN bucket, plus the
  signed-URL Edge Functions".

## Proposed learnings

For `docs/learnings.md` (I do not edit it — isolation):

1. **"Stated in one doc, assumed implemented in another" is the review's own failure mode too.**
   Findings #10/#14/#15 flagged controls as missing that were already in `0002`. The corpus had
   `authorization-model.md` §14 still saying "work this document creates" for things Q04 had
   since written into `0002`, so a later reader (the review) trusted the spec's TODO list over
   the migration. Fix applied: §14 now carries a **Status** column pointing at the concrete
   `0002` section, so the spec's task list and the migration cannot silently disagree again. The
   general rule: **a spec that lists "work to do" must be updated in the same PR that does the
   work, or it becomes a source of phantom findings.**
2. **Anchored greps lie about SQL that lives inside `do $$` blocks.** `grep -c '^revoke\|^grant'`
   returned 0 on a file with 25 revoke/grant statements, because Supabase migration idiom puts
   them indented, inside `do $$ … $$`, or behind `execute format(...)` (needed to guard on
   `pg_roles` existence and to loop over table lists). Any "does this migration contain X"
   check must be case-insensitive and must not anchor to column 0. A grep is not a substitute
   for reading the section.
3. **Two-sided privilege assertions.** Asserting only "class-3 tables have no write grant" leaves
   the door open to a forbidden grant on a *non*-listed table. Pinning the write surface needs
   both the negative (class-3 denied) and the positive complement (exactly the non-class-3
   tables allowed), defined structurally off one shared list so they cannot drift apart.

## Could not resolve → open question

None new. The one judgement call — whether to add storage-bucket **policy** SQL — I resolved as
"no": private buckets take no policy by design, and the missing piece (signed-URL Edge Functions)
is application code, correctly deferred to E02-22 rather than fabricated as schema SQL. This
matches `0002`'s existing style, which already creates the buckets but writes no `storage.objects`
policies and says so explicitly in its §15 comment.
