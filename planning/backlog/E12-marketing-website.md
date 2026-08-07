---
id: E12
title: Marketing Website
phase: 6
risk: low
status: not-started
depends_on: [E02, E03, E13]
summary: graybag.com rebuilt — static, fast, beautiful, on brand. Same codebase as the admin app.
---

## Context

Getting fully off Bubble includes the public website. Largely static but it needs to look considerably better than the current one.

## Tasks

- [ ] `E12-01` (mvp) Home page rebuilt on brand from the Graybag Design Package
- [ ] `E12-02` (mvp) Find-out-more / interest submission form (replaces `findoutmoresubmission`)
- [ ] `E12-03` (mvp) Investor submission form (replaces `investorsubmission`) — creator-only visibility
- [ ] `E12-04` (mvp) Privacy policy, refund policy, terms, and the **DPDP grievance officer contact** (`E20-07`) — required by both app stores and by law
- [ ] `E12-05` (mvp) App store badges and deep links to the mobile app
- [ ] `E12-06` (mvp) Back-office login entry point (admin / kitchen)
- [ ] `E12-07` (mvp) SEO, meta tags, sitemap, favicon, social preview images
- [ ] `E12-08` (mvp) Lighthouse performance **and accessibility** budgets enforced in CI, with actual threshold numbers
- [ ] `E12-09` (mvp) Deploy to Netlify and prepare the graybag.com DNS cutover plan
- [ ] `E12-10` (owner:andy) (mvp) Make the DNS change at the registrar when the cutover plan is ready
