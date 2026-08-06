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
