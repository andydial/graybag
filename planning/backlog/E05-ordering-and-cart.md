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
- [ ] `E05-03` (mvp) Support a customer with dependents at **multiple schools**
- [ ] `E05-04` (mvp) Cart: add/remove/quantity, per-line special comments, optimistic UI
- [ ] `E05-05` (risk:high) **Allergen warning** when adding a dish that conflicts with the recipient's declared allergies
- [ ] `E05-06` (mvp) Break / drop time selection per school; supports different times for different class groups later
- [ ] `E05-07` (risk:critical) (mvp) **Cutoff enforcement** — midnight by default, resolved via the config chain, enforced server-side not just in the UI
- [ ] `E05-08` (mvp) Order for a future date; calendar shows which days are orderable
- [ ] `E05-09` (mvp) Order creation snapshots dish name, price, allergens, cutoff and break time
- [ ] `E05-10` (mvp) Order history with reorder
- [ ] `E05-11` (mvp) Order cancellation by the customer (before cutoff) moves the order to `cancelled`. The **refund path itself lands with `E06-09`**, not here
- [ ] `E05-12` (risk:high) (mvp) Concurrency: two devices submitting the same cart must not create duplicate orders (idempotency key)
- [ ] `E05-13` (mvp) `POST /checkout/preflight` — re-runs every checkout guard (cutoff, price, availability, allergens, wallet balance) and returns the server's prices without writing. Advisory only; §8.1 of `docs/order-lifecycle.md` says why it is never a guard
- [ ] `E05-14` (risk:high) (mvp) **Abandoned-checkout sweeper** — every 5 minutes, close `order_group`s left at `pending_payment` past the TTL. Must reconcile each non-terminal attempt against Razorpay *before* cancelling, reverse the wallet hold and release any capacity decrement. TTL is `[OL-03]`
