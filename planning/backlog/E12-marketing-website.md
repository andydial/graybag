---
id: E12
title: Marketing Website
phase: 6
risk: low
status: in-progress
depends_on: [E02, E03, E13]
summary: graybag.com rebuilt — static, fast, beautiful, on brand. Same codebase as the admin app.
---

## Context

Getting fully off Bubble includes the public website. Largely static but it needs to look considerably better than the current one.

## Tasks

- [x] `E12-01` (mvp) Home page rebuilt on brand from the Graybag Design Package
- [x] `E12-02` (mvp) Find-out-more / interest submission form (replaces `findoutmoresubmission`)
- [ ] `E12-03` Investor submission form (replaces `investorsubmission`) — creator-only visibility
- [x] `E12-04` (mvp) Privacy policy, refund policy, terms, and the **DPDP grievance officer contact** (`E20-07`) — required by both app stores and by law
- [ ] `E12-05` App store badges and deep links to the mobile app
- [ ] `E12-06` (mvp) Back-office login entry point (admin / kitchen)
- [x] `E12-07` SEO, meta tags, sitemap, favicon, social preview images
- [x] `E12-08` Lighthouse performance **and accessibility** budgets enforced in CI, with actual threshold numbers
- [x] `E12-09` (mvp) Deploy to Netlify and prepare the graybag.com DNS cutover plan — **deployed 2026-08-14 to `https://graybag-web.netlify.app`.** `/signin`, `/kitchen` and `/orders` are reachable from any device and verified against staging: signed out, `/kitchen` redirects to sign-in; signed in it reads 34 orders across 5 classes, and `/orders` reads 35 across 2 schools. **The marketing pages ride along on the same build and are held out of search**, because they carry claims still waiting on legal review: `robots.txt` now defaults to `Disallow: /` unless `PUBLIC_SITE_PUBLISHED=true`, and `X-Robots-Tag: noindex, nofollow` is set on every response. Both are removed at the cutover, not before. DNS cutover itself is `E12-10` and is Andy's. **Continuous deploy is not connected** — that needs the GitHub repo authorised to Netlify, which only Andy can do; today's deploy was a manual upload of `dist`
- [ ] `E12-10` (owner:andy) (mvp) Make the DNS change at the registrar when the cutover plan is ready
- [ ] `E12-11` (owner:andy) Get **written** agreement from Amity International, Gem Public and Paragon Senior Secondary before naming any of them on the website (`[WEB-02]`). The names were pulled from the page on 2026-08-11 and a test fails if one reappears; the section now offers a kitchen visit instead
- [x] `E12-12` (owner:andy) Name the address enquiries are emailed to, for `ENQUIRY_NOTIFY_EMAIL` (`[WEB-03]`) — answered 2026-08-11: `andy@graybag.com`, Cc `vivek@graybag.com`. Recorded in `docs/enquiry-submission-contract.md` §6
- [ ] `E12-13` (owner:andy) Commission dish photography — every existing photo is 120px and no larger original exists (`[WEB-01]`); also closes `E16-29`'s three permanent 403s and unblocks the app's dish-card treatment
- [ ] `E12-14` (owner:andy) (risk:medium) Confirm what may be stated about food safety and the FSSAI registration (`[WEB-04]`)
- [ ] `E12-15` Build the `enquiry` table, RLS and the `enquiry-submit` Edge Function to `docs/enquiry-submission-contract.md` — owned by the `supabase/` thread, not by `apps/web`
- [ ] `E12-16` Wire `check:a11y` into the CI workflow — it is in `npm run test:all` but the GitHub Actions job does not run it yet
- [ ] `E12-17` Replace the drawn hero phone illustration with a real app screenshot once the app has screens worth showing
- [ ] `E12-18` Re-check the published policy pages the moment `E20-01` resolves the `«PENDING»` tokens — the production build gate (`E20-22`) will start passing and the pre-launch notice must come off deliberately
- [ ] `E12-19` Re-shoot or re-frame the food section once real photography exists (`E12-13`) — the five category cards are laid out to take a proper photograph, and the 96px cap comes off the moment there is one worth showing

