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
- [x] `E12-15` Build the `enquiry` table, RLS and the `enquiry-submit` Edge Function to `docs/enquiry-submission-contract.md` — **taken by the web thread on 2026-08-14** on Andy's instruction, after the `supabase/` thread did not pick it up. Only `supabase/migrations/0050_enquiry.sql`, `supabase/down/0050_enquiry.down.sql`, `supabase/functions/enquiry-submit/` and one line of `packages/shared/src/payments/cors.test.ts` were touched. Deployed and verified against staging on every path: 204 preflight, 201 stored, 202 honeypot (stored nowhere), 422 validation, 303 for the no-JavaScript form post, and an open redirect refused. Email lowercased, phone normalised, message trimmed to `null`. **The notification email is `E12-20`** — §6 makes it best-effort and forbids it failing the request, and `E08` owns the mail infrastructure
- [ ] `E12-20` **One email per stored enquiry** — `docs/enquiry-submission-contract.md` §6. From `GrayBag <orders@graybag.com>`, Reply-To `support@graybag.com`, to `ENQUIRY_NOTIFY_EMAIL` Cc `ENQUIRY_NOTIFY_CC` (seed to andy@ and vivek@), subject `New school enquiry — <school>, <city>`, body every field plus a `mailto:` so replying is one tap. **Best-effort: it must never fail the request** — the row is the record, and an enquiry lost because a mail provider had a bad minute is the worst thing this endpoint can do. Blocked on `E08`'s transactional mail, or reuse the provider `E07-05` needs for GST invoices
- [ ] `E12-21` (owner:andy) **Set `PUBLIC_ENQUIRY_ENDPOINT` in Netlify** to the deployed function URL. Until then the live form posts to the dev mock and production submissions go nowhere — `docs/enquiry-submission-contract.md` §8 item 1, the one genuinely blocking handover
- [x] `E12-22` (risk:high) **The internal drafting note was being published on all three policy pages.** A parent opening `/terms` read "⚠ DRAFT FOR LEGAL REVIEW — DO NOT PUBLISH AS-IS", "Nothing here has been checked by a lawyer", two internal task ids and an instruction about CI — live on the Netlify deploy. Worse than an unresolved token: a token reads as a mistake, this reads as a statement about the document's standing, and it was the first thing on the page. The renderer now strips the preamble blockquote — the one before the first `##`, where a note lives and no authored quote does — in both `apps/web/src/lib/policy.ts` and `scripts/build-policy-docs.mjs`, so the website and the app agree. Covered by `policy.test.ts`. Fixing it also removed the `«ANGLE-BRACKET»` false positive that would have blocked a production build for ever, since that token existed only inside the note
- [ ] `E12-23` (owner:andy) **Internal task ids remain in the published policy bodies** — `E06-33` in the refund policy's change log, `E00-10` in the privacy policy's, and six in `terms.md`. These are authored body content rather than a preamble note, and deleting text from a legal document is a decision, not a rendering fix: some change-log entries are legitimately public ("what changed in version 2") and the citation is not. Decide per line whether to cut the id, reword it, or keep it
- [x] `E12-24` **The placeholder register** — `docs/placeholder-register.md`, one checklist of every `«…-PENDING-…»` token on a surface we publish, each with what it is, what it needs and who can supply it, plus `npm run check:placeholders` so it cannot go stale. **10 block a production build, all in `docs/terms.md`; 12 more sit on documents that will publish but are not built yet.** The privacy and refund policies have none — both are the lawyer-drafted text already published for the legacy app. A bare grep returns 33 and is useless: most are the convention described in prose, superseded drafts, or test fixtures, so the register counts published surfaces only. **The production guard stays** (Andy, 2026-08-14)
- [ ] `E12-25` **The legal name, registered address and GSTIN are separate tokens in two documents.** Filling them means answering the same question twice and hoping the copies match — and an invoice whose GSTIN disagrees with the terms is worse than either being blank. They should come from one source that both documents cite. Not folded into `E12-24` deliberately: it changes how two published documents are assembled, which is worth doing on purpose rather than in the same pass as writing the list
- [ ] `E12-26` **`docs/gst-invoicing.md`'s placeholders must block a build once `E07` renders invoices from it.** An invoice is a published document and its five tokens include the GSTIN and the SAC code. Today nothing fails, only because the invoice path is not wired to the file yet — which is the weakest possible reason for a guard not to exist


- [ ] `E12-16` Wire `check:a11y` into the CI workflow — it is in `npm run test:all` but the GitHub Actions job does not run it yet
- [ ] `E12-17` Replace the drawn hero phone illustration with a real app screenshot once the app has screens worth showing
- [ ] `E12-18` Re-check the published policy pages the moment `E20-01` resolves the `«PENDING»` tokens — the production build gate (`E20-22`) will start passing and the pre-launch notice must come off deliberately
- [ ] `E12-19` Re-shoot or re-frame the food section once real photography exists (`E12-13`) — the five category cards are laid out to take a proper photograph, and the 96px cap comes off the moment there is one worth showing

