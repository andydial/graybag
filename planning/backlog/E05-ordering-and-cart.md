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
- [x] `E05-16` (risk:critical) **Nothing creates a `recipient` or a `guardian_link`, so no order can be placed by a real user.** `create_checkout` correctly refuses every request from the app with `not_authorized` — there is no link. Found 2026-08-10 when the order path was finished and had nobody to run it for. `E05-01`/`E05-02` are the tasks, and the reason they are not simply "next" is that adding a child is where consent is captured (`E20-01`, `[DM-12]`), which is blocked on the DPDP legal question. **Decide whether v1 captures consent at child creation or defers it** — building the flow twice is the expensive outcome. Staging deliberately carries no children (`seeds/staging-menu.sql`), so this is not a seeding gap
- [x] `E05-17` **"Your children" — a parent could add a child and then never see them again.** `E05-01` built the form and nothing that lists what it wrote, so a mis-typed class was uncorrectable, a parent had no way to tell whether the add had worked, and `E05-02`'s change-school flow had no row to start from. Found 2026-08-10 while wiring the recipients UI. The read goes through `guardian_link` (`D10`) and names its columns — `recipient` carries `allergy_note`, tier S, and a policy filters rows, never columns
- [x] `E05-18` Change a child's school from their row on that list: the existing `Sheet` + `SchoolPicker`, calling `changeRecipientSchool`. The `future_orders_exist` refusal is shown as itself, never as a generic failure — `D19` means the parent has to go and cancel those days first, and "something went wrong" does not tell them that

- [ ] `E05-19` **Nothing sets the order target** — who a lunch is for and which day. `OrderTargetContext` is the seam the dish detail screen was built against and it is permanently `null` today, so add-to-cart offers "add a child" instead of a line. Filling it is `E05-01`/`E05-03` (who) and `E05-06`/`E05-08` (when). Found 2026-08-10 while building the dish detail screen
- [x] `E05-20` (risk:critical) **Nothing ever created an `app_user` row, so signing in denied everything.** `auth_is_live_user()` gates every authenticated policy and reads `app_user`; a real parent who signed in had no row, so the school picker emptied the moment they signed in and adding a child died on a foreign key. Found 2026-08-10 by `scripts/order-path-check.mjs` walking the whole path against staging. Migration `0018`: a trigger on `auth.users`, and `phone_e164` nullable because v1 has no phone OTP
- [x] `E05-21` (risk:critical) **Every real order failed on staging with `21000: DELETE requires a WHERE clause`.** `create_checkout` cleared its temp table with an unqualified DELETE; hosted Supabase loads `safeupdate` and a local `supabase start` does not, so 24 pgTAP assertions passed while no order could be placed through PostgREST. Migration `0019`. Found 2026-08-10 by `scripts/order-path-check.mjs`

- [ ] `E05-22` (risk:high) Collapse `order_group` per `docs/order-lifecycle.md` §14 — one child, one service date per checkout is decided (ux-spec §8.5). Retire the multi-date checkout paths rather than leaving them unreachable
- [ ] `E05-23` (risk:high) Implement the cutoff grace window `L9` — `cutoff_at + grace`, per-kitchen config, default 15 minutes; settlement after it is refused and auto-refunded. Test both sides of the boundary
- [ ] `E05-24` Merge the checkout review into the cart and drop the Welcome screen (ux-spec §6.1.1) — 11 screens to 8 on the first-order path

- [ ] `E05-25` (risk:critical) Audit every allergen surface against a null child — dish card flag, dish detail, cart line. A warning naming a child must be impossible to render when no child is selected (ux-spec §5.6)
- [ ] `E05-26` (risk:high) The allergen second-confirm is its own surface naming the child and the allergen, not an "Add anyway" button label (ux-spec §5.6)
- [ ] `E05-27` Per-line kitchen note — 140-char cap, best-effort copy, allergy-language diversion to Edit child (ux-spec §5.6.1, `P12`). **Sequenced after `E13-27` Edit child**, not blocked on it
- [ ] `E05-28` Remove every co-guardian and read-only-child surface per `AR8`; `can_order` stays in the schema defaulted true

- [ ] `E05-29` (risk:high) Put the break time on the cart line so the cart can show it. ux-spec §5.7 requires the break to be visible before paying, and it is neither on `CartLineInput` nor returned by `fetchRecipients` — today the block says the break is confirmed with the kitchen rather than inventing one
- [ ] `E05-30` (risk:high) An `api/` calendar read so the cart can show the real cutoff. Until it exists the cart shows no cutoff at all, because a cutoff we have not resolved is a promise about when ordering closes that we cannot keep (ux-spec §5.21)
- [ ] `E05-31` (risk:critical) A child-allergens read so the cart and menu can warn. `fetchRecipients` deliberately withholds them (tier S), so allergen warnings are absent everywhere today — and absent must never be rendered as "safe"

- [x] `E05-32` (risk:critical) **Adding to cart requires a child, which breaks `R1`/`AR7`.** `DishDetailScreen` renders "Add a child" instead of "Add to cart" when no recipient is selected — confirmed on `ux-spec-and-prototype`, not a stale-build artefact. The child belongs at checkout (§5.6). Requires moving `recipientId` and `serviceDate` off `CartLineInput` and onto the cart, which is the shape the one-recipient-one-date decision already implies
- [x] `E05-33` (risk:critical) A test that fails if **any** pre-checkout action requires a session or a recipient — a structural guard over the menu, dish detail and cart, not a fix to one screen. Andy: "I want it structurally impossible rather than fixed once"

- [ ] `E05-34` Move `recipientId` and `serviceDate` off `CartLineInput` and onto the cart itself. `E05-32` made them nullable per line, which unblocks the wall and is honest, but one-recipient-one-date (`AR8`) means they are cart properties — two lines cannot legitimately disagree about who the order is for

- [ ] `E05-35` Put the break time on the recipient or the cart line so Home's "Delivering to" card and the cart can name it. Both say it is confirmed with the kitchen rather than inventing one — honest, but it is the one fact a parent checks to be sure the lunch reaches the right classroom

- [ ] `E05-36` Switching recipient must ask before discarding a non-empty cart (ux-spec F9). It switches silently today — a parent with four dishes in the cart who taps the wrong row loses them with no warning and no undo
