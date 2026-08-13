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

- [ ] `E10-01` (mvp) School onboarding wizard: name, address, city, is-college, kitchen, contact, break times
- [ ] `E10-02` (mvp) Kitchen management: create, activate/deactivate, assign schools
- [ ] `E10-03` (mvp) Menu management UI: create menu, add/remove/edit dishes, activate/retire, assign to schools
- [ ] `E10-04` (mvp) Excel menu upload with validation, diff preview and apply (front end for E04-04)
- [ ] `E10-05` Dish image management
- [ ] `E10-06` (risk:medium) (mvp) **Config UI with visible inheritance** — e.g. `Cutoff: 12:00 AM (platform default)` with an "Override for this school" toggle. Covers cutoff, revenue share %, break times, price overrides
- [ ] `E10-07` (mvp) User management: search, view, disable, assign back-office grants
- [ ] `E10-08` (mvp) Order dashboard across all kitchens with refund capability
- [ ] `E10-09` Revenue share / payout report with edit-before-confirm and mark-as-paid
- [ ] `E10-10` Business metrics: orders per day, revenue, active users, per-school breakdown
- [ ] `E10-11` Audit log of admin actions (who changed a price, who issued a refund)
- [ ] `E10-12` (mvp) Single web app, three permission levels (PlatformAdmin, KitchenOperator, SchoolViewer) — not three apps
- [ ] `E10-13` (risk:medium) **View-as-user** debugging: an admin can see exactly what a given customer sees, to diagnose a failed order without asking them for screenshots
- [ ] `E10-14` In-app support contact route (from the app to a queue Andy actually reads), with the order correlation ID attached automatically
- [ ] `E10-15` (owner:andy) **Get an enrolled-child count from each school**, with the date it was given and who gave it. `docs/product-metrics.md` §3 option (a): one integer per school per academic year, asked during the onboarding conversation that already happens. Without it **school penetration cannot be computed** — and the proxy (children registered with GrayBag) reports a number that *rises when adoption stalls*, so it must not be substituted. A credentialed action: it is a conversation with the school, which only Andy has
- [ ] `E10-16` **Hold the enrolled-child count.** `school.enrolled_children_count int null`, `enrolled_count_as_of date null`, `enrolled_count_source text null` — nullable on purpose, so a school without one shows *absent* rather than zero. Admin field with the as-of date required whenever the count is set; a count older than one academic year renders with its date. Prepared for `E10-15`, and buildable before it
- [ ] `E10-17` **Build the six metrics of `docs/product-metrics.md` (`P17`)** as server-side queries: activated users, weekly active orderers, orders per active orderer per week, AOV in paise, school penetration, cohort retention at N+4/N+8/N+12. Constraints are part of the task, not decoration — no column of `recipient` selected or joined for filtering, `recipient_id` counted but never described, small-number suppression built into the query rather than the template, integer paise throughout, an immature cohort cell rendered *not yet* rather than 0%, and school penetration rendered "no enrolled count" where `E10-16`'s column is null
