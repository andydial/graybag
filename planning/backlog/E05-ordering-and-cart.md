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

- [ ] `E05-01` (risk:high) Recipient management: add/edit a dependent (name, class, section, allergies), self-declared school from the onboarded list. Includes **parental consent capture** (`E20-02`)
- [ ] `E05-02` Change school on a dependent or on self, from onboarded schools only
- [ ] `E05-03` Support a customer with dependents at **multiple schools**
- [ ] `E05-04` Cart: add/remove/quantity, per-line special comments, optimistic UI
- [ ] `E05-05` (risk:high) **Allergen warning** when adding a dish that conflicts with the recipient's declared allergies
- [ ] `E05-06` Break / drop time selection per school; supports different times for different class groups later
- [ ] `E05-07` (risk:critical) **Cutoff enforcement** — midnight by default, resolved via the config chain, enforced server-side not just in the UI
- [ ] `E05-08` Order for a future date; calendar shows which days are orderable
- [ ] `E05-09` Order creation snapshots dish name, price, allergens, cutoff and break time
- [ ] `E05-10` Order history with reorder
- [ ] `E05-11` Order cancellation by the customer (before cutoff) moves the order to `cancelled`. The **refund path itself lands with `E06-09`**, not here
- [ ] `E05-12` (risk:high) Concurrency: two devices submitting the same cart must not create duplicate orders (idempotency key)
