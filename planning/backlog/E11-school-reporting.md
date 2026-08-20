---
id: E11
title: School Reporting — Monthly PDF
phase: 6
risk: low
status: not-started
depends_on: [E07]
summary: A monthly PDF emailed to each school. Aggregates only, no child-level PII. Designed to sell the benefit of the partnership.
---

## Context

Decided against a school login portal — the PDF lands in the principal's inbox instead of waiting to be discovered.

## Tasks

- [ ] `E11-01` Monthly aggregate report per school: orders, revenue, school's share earned
- [ ] `E11-02` Historical month-on-month trend and cumulative total paid to date
- [ ] `E11-03` **Aggregates only** — no individual child names or allergies
- [ ] `E11-04` Designed on brand, presenting the partnership benefit (supporting underprivileged kids)
- [ ] `E11-05` Automated monthly email to the school contact, with the PDF attached
- [ ] `E11-06` Admin can preview, regenerate and manually re-send any month
- [ ] `E11-07` Reports computed from the **partitioned and indexed** tables of `E02-11`. Materialised aggregates stay deferred to `E18-22` until volume demands them
- [x] `E11-08` **A growth report — registrations over time and by school.** Andy: *"All registered users - registrations per date - registrations per school etc. Want to be able to see exactly how the registrations / growth is tracking. Would be good to have some basic graphs / visuals."* `/admin/growth`, requiring `users.view` at platform scope, deliberately separate from `/reports` — that one answers "what did this school order" for a school, this answers "is the product growing" for us, and `E10-10` exists to stop the monthly report quietly growing into something nobody agreed to. **Every number is a count and nobody is named**: `fetchGrowth` selects three columns per child (`id`, `school_id`, `created_at`) and the types have nowhere to put a name, so non-negotiable #4 is enforced at the boundary rather than in a template — `recipient_read_admin` *would* return every column. Five headline figures, a cumulative line with a per-day bar row on the same axis, and a per-school table. **A family is counted once per school**, however many children they have there: two siblings is one family, and counting two overstates reach by exactly the families most likely to be a reference. Days with no signups are plotted, because charting only the days that had one turns a flat fortnight into steady growth. Dates are **IST calendar dates** — bucketing a `timestamptz` by its UTC date files every signup after 18:30 IST under yesterday. Charts are hand-rolled inline SVG: the site ships zero third-party assets and the CSP is `script-src 'self'`, so a chart library is not an option, and a polyline is twenty lines. **"Signed up, no child yet" is on the headline row** because `AR7` makes signup-to-first-order a primary goal and an account with no child cannot order at all — that number is whether onboarding works. 3,230 B of JS against a 10,000 budget
- [ ] `E11-09` Growth by **month** as well as by day, once there is more than one month of data to compare. Deliberately not built now: with seventeen days of history a month view is one bar
