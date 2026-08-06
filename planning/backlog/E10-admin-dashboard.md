---
id: E10
title: Admin Dashboard
phase: 5
risk: medium
status: not-started
depends_on: [E02, E04, E07]
summary: The backend Andy needs to run the business — school onboarding, menu management, config, users, money.
---

## Tasks

- [ ] `E10-01` School onboarding wizard: name, address, city, is-college, kitchen, contact, break times
- [ ] `E10-02` Kitchen management: create, activate/deactivate, assign schools
- [ ] `E10-03` Menu management UI: create menu, add/remove/edit dishes, activate/retire, assign to schools
- [ ] `E10-04` Excel menu upload with validation, diff preview and apply (front end for E04-04)
- [ ] `E10-05` Dish image management
- [ ] `E10-06` (risk:medium) **Config UI with visible inheritance** — e.g. `Cutoff: 12:00 AM (platform default)` with an "Override for this school" toggle. Covers cutoff, revenue share %, break times, price overrides
- [ ] `E10-07` User management: search, view, disable, assign back-office grants
- [ ] `E10-08` Order dashboard across all kitchens with refund capability
- [ ] `E10-09` Revenue share / payout report with edit-before-confirm and mark-as-paid
- [ ] `E10-10` Business metrics: orders per day, revenue, active users, per-school breakdown
- [ ] `E10-11` Audit log of admin actions (who changed a price, who issued a refund)
- [ ] `E10-12` Single web app, three permission levels (PlatformAdmin, KitchenOperator, SchoolViewer) — not three apps
- [ ] `E10-13` (risk:medium) **View-as-user** debugging: an admin can see exactly what a given customer sees, to diagnose a failed order without asking them for screenshots
- [ ] `E10-14` In-app support contact route (from the app to a queue Andy actually reads), with the order correlation ID attached automatically
