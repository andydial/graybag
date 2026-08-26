# E21 — Screen design: every screen built to the prototype

**Why this epic exists.** "Every screen gets the prototype treatment" lived only in a
conversation. Nothing counted it and nothing failed if it silently did not happen — which is
exactly how `E13` shipped tokens, we both ticked "design done", and the app stayed a wireframe
for weeks. This epic makes it countable.

**One task per screen in the `docs/ux-spec.md` §5 catalogue.** Each names the states it must be
compared against, because the happy path is the one that always gets built and the empty, error
and unreachable states are the ones that quietly do not.

## Definition of done — the same for every task here

A screen is done when **all** of these are true:

1. It is built to `docs/prototype/graybag-prototype.html` — the prototype **is** the acceptance
   criteria, not a mood board. Deep-link each state and compare.
2. **Every state named in the task** has been rendered and compared, not just the happy path.
3. It has been seen **on a device**, over Metro or a build. Not a simulator screenshot alone.
4. Its Maestro coverage ships in the **same PR** (`E14-24`), not afterwards.
5. Recipient-neutral copy from one code path — "For you" / "For Aarav" (`0022`,
   `docs/self-ordering-costing.md`). No screen says "your child" where an adult may be reading.
6. Dynamic type checked at `AX5`, per ux-spec §3.5.

**Not done** means: built, but not compared against its states, or not seen on a device. Say so
rather than ticking it.

## Progress, 2026-08-10

**Ten screens are built and on a device. None is ticked**, and that is the point: the definition
of done above says *every* state compared, and calling a screen finished because its happy path
looks right is the exact mistake `E13` made.

They are tracked as open with a **BUILT** note rather than a third checkbox state — the build
script understands `[ ]` and `[x]` only, and a `[~]` silently dropped all ten from the totals,
which is precisely the quiet miscount this epic exists to prevent.

Built this session: Menu, Dish detail, Add child, Sign in, Email OTP, Home, Choose school,
Orders, Children, Account. Not started: Order detail, Checkout/payment, Order confirmed, Policy
gate, Can't connect, Splash, Support.

## Tasks

- [ ] `E21-01` (risk:high) (mvp) **Cart** — ux-spec §5.7. States: empty · loaded · signed-out · no
      recipient · repricing · price-changed · cutoff-passed · item-unavailable · offline ·
      restored-after-kill · error. *Partly built (`b34e957`); not yet compared against every state
      on a device, and the cutoff, break time and allergen lines are absent pending E05-29/30/31*
- [ ] `E21-02` (risk:high) (mvp) **BUILT 2026-08-10 — states not yet all compared.** **Menu** — §5.5. States: loading (six skeleton cards) · loaded ·
      empty-unpublished · empty-search · empty-category · error · offline/stale · partial
      (allergens failed → flags suppressed and said so) · AX5 single column
- [ ] `E21-03` (risk:high) (mvp) **BUILT 2026-08-10 — states not yet all compared.** **Dish detail** — §5.6. States: loading · loaded · no photo (pattern
      tile) · signed-out · no recipient · allergen clash unconfirmed · allergen clash confirmed ·
      cannot-check · kitchen-declared-none · nothing-declared · unavailable · cutoff passed ·
      offline. **Includes `E05-32`: adding to cart must not require a recipient**
- [ ] `E21-04` (risk:high) (mvp) **BUILT 2026-08-10 — states not yet all compared.** **Add child / Add someone** — §5.10. States: empty form · invalid ·
      saving · saved · school-not-served · consent missing · allergy details without consent ·
      offline · error
- [ ] `E21-05` (mvp) **Edit child** — §5.10.1. States: loading · loaded · invalid · saving · saved ·
      school change blocked by undelivered orders · allergen consent being withdrawn · removing ·
      offline · unreachable · error
- [ ] `E21-06` (mvp) **BUILT 2026-08-10 — states not yet all compared.** **Sign in** — §5.8. States: default · email sent · cancelled · error · offline.
      Must keep the "New here?" line — a screen offering no visible way to create an account
      reads as broken
- [ ] `E21-07` (mvp) **BUILT 2026-08-10 — states not yet all compared.** **Email OTP** — §5.9 and §5.9.1. States: awaiting · verifying · wrong code ·
      expired · resend cooling down · resent · too many attempts · offline · **returned from
      background** (digits, timer and pending address survive)
- [ ] `E21-08` (mvp) **BUILT 2026-08-10 — states not yet all compared.** **Home** — §5.4. States: signed out · signed in no recipient · one recipient ·
      several · loading · menu unpublished · offline · error
- [ ] `E21-09` (mvp) **BUILT 2026-08-10 — states not yet all compared.** **Choose school** — §5.3. States: loading · loaded · empty search · empty list ·
      error · offline. Carries the merged welcome header (§6.1.1 cut 1)
- [ ] `E21-10` (mvp) **BUILT 2026-08-10 — states not yet all compared.** **Orders list** — §5.14. States: loading · loaded · empty · signed out · offline ·
      error
- [ ] `E21-11` (mvp) **Order detail** — §5.15. States: loading · loaded · cancellable · not cancellable
      (with the reason) · cancelling · cancelled · refund pending · refunded · refund failed ·
      offline · error
- [ ] `E21-12` (mvp) **BUILT 2026-08-10 — states not yet all compared.** **Your children / Who you order for** — §5.16. States: loading · loaded · empty ·
      unreachable · error
- [ ] `E21-13` (mvp) **BUILT 2026-08-10 — states not yet all compared.** **Account** — §5.17. States: signed out · signed in. Keeps the build label
      (environment + commit)
- [ ] `E21-14` (mvp) **Checkout and payment** — §5.11, §5.12. States: preflight running · ready ·
      each refusal code in §7 · submitting · handing off · sheet dismissed · failed · succeeded ·
      **payment_pending (waiting, never a tick)** · app killed mid-payment
- [ ] `E21-15` (mvp) **Order confirmed** — §5.13. Single state, unreachable until settlement confirms
- [ ] `E21-16` (mvp) **Policy acceptance gate** — §5.19. States: not required · required · accepting ·
      error. Blocks writes, never browsing
- [ ] `E21-17` (risk:high) (mvp) **Can't connect** — §5.20. The screen that separates "we cannot reach
      GrayBag" from "this school has no menu". States: unreachable · unconfigured (names the
      missing variables, non-production only)
- [ ] `E21-18` (mvp) **Splash** — §5.1. States: default · slow start · unconfigured → 5.20 · update
      required → 5.19
- [ ] `E21-19` (mvp) **Support** — §5.18. Grievance officer contact (compliance). States: loaded · error
- [ ] `E21-20` (mvp) A count in `planning/backlog.html` of screens designed versus stubbed, so "how
      much of the app looks like the product" is answerable at a glance rather than by reading
      this file
- [x] `E21-21` **The meal-pack plan, written before any code.** `docs/meal-packs-plan.md`. Andy, 2026-08-26: *"This is the highest-consequence feature we've built, because it takes money up front for food not yet served… tell me your plan for the schema and the concurrency control, and the GST treatment you intend to implement."* Four tables (`meal_pack_offer`, `meal_pack_offer_school`, `meal_pack`, `meal_pack_redemption`), with `unique (order_id)` on redemptions so "this order spent two meals" is unrepresentable rather than merely checked. Concurrency is one atomic `update … where meals_remaining >= p_meals`, safe at READ COMMITTED because a blocked transaction re-evaluates its `WHERE` against the committed value; the `>= 0` constraint is the backstop, not the mechanism. Multi-pack spending locks `order by expires_at, id for update`, which is simultaneously the deadlock prevention and the oldest-first business rule. Ledger: **a pack sale is a liability, not revenue** — cash in credits `platform:deferred_revenue:meal_packs`, and revenue is recognised only at redemption, which is the direct answer to the double-count question, with the invariant *deferred-revenue balance = sum(meals_remaining × meal_value_paise)* as the test. GST goes behind `platform_config.pack_tax_point`, and the load-bearing detail is that the value is **stamped onto the pack at sale** so a later flip changes the future without rewriting packs already sold
- [ ] `E21-22` (owner:andy) **Confirm the GST tax point for prepaid packs, and confirm no pack sells on production until then.** A validation only Andy can make — it is his accountant's answer. Two positions, both to be built and both tested: **sale** (the pack is a voucher for identifiable goods, GST on the pack price at purchase, redemption adds no tax — what the prototype copy currently states) or **redemption** (GST at the time the food is supplied). The flag is `platform_config.pack_tax_point`; flipping it changes future sales only. Also needs confirming: the ledger treatment in §5 — sale as deferred revenue, revenue at redemption, breakage at expiry — since it is the accounting answer to *"a redeemed meal must never appear as revenue a second time"*
- [x] `E21-23` **`0068` — the meal-pack schema.** Four tables plus plan-level idempotency, applied clean to a full local rebuild of all 69 migrations. `unique (order_id)` on `meal_pack_redemption` makes "this order spent two meals" unrepresentable; `meal_pack_plan` keyed on the client's idempotency key makes a retried confirmation return the first result rather than creating four more orders (Andy's amendment 1 — `unique (order_id)` does not cover it, because the retry creates NEW orders). `tax_point`, `net_price_paise` and the tax split are **stamped onto the pack at sale** so a config flip changes the future without rewriting packs already sold. No refunds is a **trigger** on `refund`, not a check in an Edge Function, because a trigger also refuses psql — and the three cancelled orders on production exist because a terminal can do what code refuses to. Extends `ledger_account_normal_balance_matches_type` (`0013`/`0035`) to teach it the two new liability types rather than working around it
- [x] `E21-24` **`0069` — spending, returning, eligibility and the invariant.** `spend_meal_pack_meals` is the only way meals leave a pack: one guarded `update … where meals_remaining >= p_take`, locking `order by expires_at, id for update` so the deadlock prevention and the oldest-first rule are the same line. All-or-nothing — a short plan raises and rolls back, because half a plan is worse than a refusal when the parent cannot see which half. Eligibility reads the **persisted order lines** and the offer's configured category, never a client flag. `check_meal_pack_ledger_invariant` returns both legs (deferred revenue and deferred tax) so the `sale` mode asserts its tax leg is zero on **both** sides rather than skipping it, and uses `ledger_balance()` rather than hand-rolling a second sign convention
- [x] `E21-25` **The concurrency proof, with teeth.** Four tests over genuinely separate `psql` connections; against the real implementation 4/4 pass, against an unprotected one 4/4 fail. **The first version was worthless and passed anyway**: it used `pg_advisory_xact_lock` for the barrier, which is EXCLUSIVE, so the racers queued and ran one at a time. Mutation-checking took two rounds to expose — removing the `>= p_take` guard left it green (the `>= 0` constraint was catching the overdraw), and only dropping that constraint **as well**, leaving nothing protecting the balance, proved the racers had never raced. Fixed by having the gate hold the exclusive lock and the racers take **shared** ones. Skips loudly with a named reason when no database is reachable, so "0 concurrency tests ran" can never be misread as "concurrency is proven"
- [ ] `E21-26` (risk:high) **A pack purchase does not fit `order_group`'s totals invariant.** Found while writing `E21-25`'s fixture: `assert_order_group_totals` is a deferred constraint trigger requiring a group's totals to equal the sum of its member `order` rows, and a pack purchase has **no member food orders** — it is money for meals not yet chosen. So a real purchase either carries zero totals (and the payable no longer describes what was charged) or trips the trigger at COMMIT. `payment.order_group_id` is `not null`, so a pack cannot simply bypass the group and still use the Razorpay path. Needs a decision before the buy surface is built: teach the assertion that a pack-purchase group stands alone, or give packs their own payment linkage. **Not to be solved by weakening the assertion silently** — it is one of the money invariants, and the concurrency fixture only sets zero totals because it is a fixture
