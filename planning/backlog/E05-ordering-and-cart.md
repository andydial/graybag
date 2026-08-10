---
id: E05
title: Ordering & Cart
phase: 3
risk: high
status: not-started
depends_on: [E02, E04]
summary: Recipients, cart, cutoff enforcement, break/drop time selection, and order creation.
---

## Tasks

- [ ] `E05-01` (risk:high) (mvp) Recipient management: add/edit a dependent (name, class, section, allergies), self-declared school from the onboarded list. Includes **parental consent capture** (`E20-02`)
- [ ] `E05-02` (mvp) Change school on a dependent or on self, from onboarded schools only
- [ ] `E05-03` Support a customer with dependents at **multiple schools**
- [x] `E05-04` (mvp) Cart: add/remove/quantity, per-line special comments, optimistic UI
- [x] `E05-05` (risk:high) **Allergen warning** when adding a dish that conflicts with the recipient's declared allergies
- [ ] `E05-06` (mvp) Break / drop time selection per school; supports different times for different class groups later
- [x] `E05-07` (risk:critical) (mvp) **Cutoff enforcement** — midnight by default, resolved via the config chain, enforced server-side not just in the UI
- [ ] `E05-08` (mvp) Order for a future date; calendar shows which days are orderable
- [x] `E05-09` (mvp) Order creation snapshots dish name, price, allergens, cutoff and break time
- [ ] `E05-10` (mvp) Order history with reorder
- [ ] `E05-11` (mvp) Order cancellation by the customer (before cutoff) moves the order to `cancelled`. The **refund path itself lands with `E06-09`**, not here
- [x] `E05-12` (risk:high) (mvp) Concurrency: two devices submitting the same cart must not create duplicate orders (idempotency key)
- [x] `E05-13` (mvp) `POST /checkout/preflight` — re-runs every checkout guard (cutoff, price, availability, allergens, wallet balance) and returns the server's prices without writing. Advisory only; §8.1 of `docs/order-lifecycle.md` says why it is never a guard
- [ ] `E05-14` (risk:high) **Abandoned-checkout sweeper** — every 5 minutes, close `order_group`s left at `pending_payment` past the TTL. Must reconcile each non-terminal attempt against Razorpay *before* cancelling, reverse the wallet hold and release any capacity decrement. TTL is `[OL-03]`
- [x] `E05-15` (risk:high) **`calendar.test.sql` test 11 fails depending on the clock.** "inside `min_advance_order_days` the day is refused as `too_soon`" gets `cutoff_passed` instead. Found 2026-08-10 and **it is not a regression** — it fails identically on `main` at `543415a`, before migrations `0012`/`0013`, so it has been failing since whenever the date last rolled onto a weekend. Two things are wrong and only one of them is the test: the fixture assumes a weekday, and `orderable_calendar` reports only the *first* reason a day is unorderable, so a day that is both too soon and past its cutoff reports whichever branch is checked first. **Fixed 2026-08-10, and the precedence was not the problem.** `orderable_calendar` reports `cutoff_passed` before `too_soon` deliberately — "you have missed it" is more actionable than "wait" — and that is correct and unchanged. The **fixture** was wrong: with a two-day lead the only `too_soon` days are today and tomorrow, and tomorrow's cutoff is 23:00 *today*, so from 23:00 onwards the day is both too soon and past its cutoff. The lead is now four days and the assertion uses `current_date + 3`, whose cutoff is in the future at every hour of every day. Precedence is still asserted, by the test that was already there. **The suite had been green only because it rarely ran late enough in the day.**
- [x] `E05-16` (risk:critical) (mvp) **Nothing creates a `recipient` or a `guardian_link`, so no order can be placed by a real user.** `create_checkout` correctly refuses every request from the app with `not_authorized` — there is no link. Found 2026-08-10 when the order path was finished and had nobody to run it for. `E05-01`/`E05-02` are the tasks, and the reason they are not simply "next" is that adding a child is where consent is captured (`E20-01`, `[DM-12]`), which is blocked on the DPDP legal question. **Decide whether v1 captures consent at child creation or defers it** — building the flow twice is the expensive outcome. Staging deliberately carries no children (`seeds/staging-menu.sql`), so this is not a seeding gap
- [x] `E05-17` **"Your children" — a parent could add a child and then never see them again.** `E05-01` built the form and nothing that lists what it wrote, so a mis-typed class was uncorrectable, a parent had no way to tell whether the add had worked, and `E05-02`'s change-school flow had no row to start from. Found 2026-08-10 while wiring the recipients UI. The read goes through `guardian_link` (`D10`) and names its columns — `recipient` carries `allergy_note`, tier S, and a policy filters rows, never columns
- [x] `E05-18` Change a child's school from their row on that list: the existing `Sheet` + `SchoolPicker`, calling `changeRecipientSchool`. The `future_orders_exist` refusal is shown as itself, never as a generic failure — `D19` means the parent has to go and cancel those days first, and "something went wrong" does not tell them that

- [ ] `E05-19` **Nothing sets the order target** — who a lunch is for and which day. `OrderTargetContext` is the seam the dish detail screen was built against and it is permanently `null` today, so add-to-cart offers "add a child" instead of a line. Filling it is `E05-01`/`E05-03` (who) and `E05-06`/`E05-08` (when). Found 2026-08-10 while building the dish detail screen
- [x] `E05-20` (risk:critical) (mvp) **Nothing ever created an `app_user` row, so signing in denied everything.** `auth_is_live_user()` gates every authenticated policy and reads `app_user`; a real parent who signed in had no row, so the school picker emptied the moment they signed in and adding a child died on a foreign key. Found 2026-08-10 by `scripts/order-path-check.mjs` walking the whole path against staging. Migration `0018`: a trigger on `auth.users`, and `phone_e164` nullable because v1 has no phone OTP
- [x] `E05-21` (risk:critical) (mvp) **Every real order failed on staging with `21000: DELETE requires a WHERE clause`.** `create_checkout` cleared its temp table with an unqualified DELETE; hosted Supabase loads `safeupdate` and a local `supabase start` does not, so 24 pgTAP assertions passed while no order could be placed through PostgREST. Migration `0019`. Found 2026-08-10 by `scripts/order-path-check.mjs`
