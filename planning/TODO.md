# Andy's TODO

Your tasks only — 42 open of 47.
Everything here is a **decision**, a **validation**, or something only you have the
credentials to do. Everything else is build work and is not your problem.

Generated — do not edit. Tick things off in the dashboard
(`node scripts/serve-backlog.mjs` then http://localhost:4321/backlog.html#mine),
or tell Claude Code "done E00-01". This file is here so you can read your list
in VS Code or on GitHub without opening anything.

---

## Do now — these block everything else

- [ ] `E00-01` **[critical]** Rotate the live Razorpay key (rzp_live...) — it is in cleartext in the .bubble export file
- [ ] `E00-02` **[critical]** Rotate the Stripe test secret key and the 2 Bubble marketplace plugin app secrets found in the same file
- [ ] `E00-04` **[high]** Check whether Bubble's Data API is exposed publicly; if so, disable it (Order and Child data are currently world-readable)
- [ ] `E00-05` **[high]** Tighten Bubble privacy rules as a stopgap on the live app: Order (currently everyone can search/view all), Child, Dish_In_Order, Temp
- [ ] `E00-10` **[high]** _(fast-follow)_ Accountant: obtain GSTIN, confirm SAC code (996331 assumed), confirm CGST/SGST split for Mohali / SAS Nagar
- [ ] `E00-11` **[high]** _(fast-follow)_ Accountant: confirm whether the school's 10% revenue share attracts 18% GST on the school's invoice to GrayBag
- [ ] `E20-01` **[critical]** _(fast-follow)_ Confirm DPDP obligations that apply to GrayBag with a lawyer or the accountant — children's data, verifiable parental consent, grievance officer, breach reporting timelines
- [ ] `E20-25` **[high]** _(fast-follow)_ Lawyer to review and approve the allergy liability ([PP-03]) and liability cap ([PP-04]) wording in docs/terms.md §8 and §10 — health-and-safety language, must not ship unreviewed. Rides with E20-01

## Needed within 2–3 weeks

- [x] `E00-12` Confirm whether menu Price in the Excel is GST-inclusive or exclusive (cart currently adds 5% on top)
- [ ] `E00-13` Verify direct access to Apple Developer account and Google Play Console independent of Bubble
- [ ] `E00-14` Locate original dish images (Bubble CDN URLs die on migration); inventory what is missing
- [ ] `E00-15` Export a full Bubble data dump (users, children, orders, dish_in_order, schools, kitchens, menus) — hand it over; the build side inspects and reports on it in E19-04
- [ ] `E00-18` Check whether any legacy prepaid card / wallet balances exist off-system for early users; if so they must be migrated as opening ledger credits (see E16-15)
- [ ] `E00-19` _(fast-follow)_ Decide the customer self-cancellation window ([PP-01]) and the post-delivery refund stance ([PP-02]) for the refund policy. These are the final customer-facing values docs/refund-policy.md is blocked on; drafts ship with tokens until set
- [ ] `E00-22` _(fast-follow)_ (risk:critical) (mvp) Fix the four failing Supabase auth settings on staging — npm run check:config names them: OTP length 8 → 6, Site URL still localhost:3000, empty redirect allow-list, and an email rate limit of 2 per hour (project-wide, so the third parent signing in at the school gate gets nothing). Dashboard only; no PR can fix these
- [ ] `E00-21` _(fast-follow)_ (risk:high) (mvp) A real SMTP sender before production — Supabase's built-in email is a handful of messages an hour with no delivery guarantee, and for an OTP-only product that means nobody can sign in. Resend/SES/Postmark with SPF and DKIM
- [x] `E01-00` One-off: authorise the GitHub (gh auth login) and Supabase CLIs on your machine — after this the build side creates and manages both
- [ ] `E01-20` _(fast-follow)_ (risk:high) Put the staging Supabase credentials into GitHub Actions secrets — SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD and the staging project ref. E01-04 created the project, but the values were never supplied, so Deploy to staging has failed on every run since 2026-08-08 (supabase link --project-ref ""). CI's required checks are unaffected and green; nothing has ever actually deployed
- [ ] `E01-21` _(fast-follow)_ Supply the staging client env values — the staging Supabase URL and anon key, plus the Razorpay test key id (rzp_test_…), either into apps/mobile/.env.staging (from .env.staging.example) or as EAS environment variables. Without them a staging build compiles but opens to an app that cannot reach any backend, so there is nothing to look at on a handset. EAS builds from a git archive, so a gitignored .env.staging is not uploaded — for a real device build these must be EAS env vars, not a local file
- [ ] `E20-21` _(fast-follow)_ Decide and supply the named grievance officer: name, designation, email and published address. E20-07 cannot publish a placeholder, and the four «…-PENDING-E20-21» tokens in docs/dpdp-compliance.md §7.2 block launch

## Decisions to make (no rush, but they gate later work)

- [ ] `E09-12` _(fast-follow)_ Decision parked: default delivery mode (classroom bulk vs counter pickup) until real usage data exists. Both are supported
- [x] `E09-15` (risk:high) Decide whether the kitchen packing list and per-class delivery sheet surface a parent's per-line note. Answered 2026-08-10: yes — P12
- [ ] `E18-01` _(fast-follow)_ Decide: parent subscribes in-app vs school buys in bulk and bills through school fees
- [ ] `E18-02` _(fast-follow)_ Decide: auto-generate daily orders vs subscription acts as prepaid credit with daily dish selection
- [ ] `E18-03` _(fast-follow)_ Decide: meal-pack composition (e.g. 20 meals = main + drink + dessert) and whether the customer chooses dishes
- [ ] `E18-04` _(fast-follow)_ Decide: unused meals at period end — expire, roll over, or refund
- [ ] `E18-05` _(fast-follow)_ Decide: mid-period cancellation and pro-rata refund policy
- [ ] `E18-06` _(fast-follow)_ Decide: per-school / per-kitchen subscription pricing (near certain to be needed across cities)

## Later — release and rollout

- [ ] `E03-18` **[high]** _(fast-follow)_ Decide the support policy for the ~15 people who appear to hold two accounts under different spellings of the same school domain (ais.amity.edu vs ais.amity.edu.in vs aismohali.amity.edu) — found by E19-04. As email strings they are distinct and will migrate to distinct accounts, which is correct; but each of those parents will see their children and order history split across two logins. This is a support-model decision, not a data fix: do not merge them automatically — ais.amity.edu and ais.amity.edu.in may be genuinely separate mailboxes, and a wrong merge shows one parent another family's child Post-cutover (SC3) — only migrated accounts can hold two
- [ ] `E10-15` _(fast-follow)_ Get an enrolled-child count from each school, with the date it was given and who gave it. docs/product-metrics.md §3 option (a): one integer per school per academic year, asked during the onboarding conversation that already happens. Without it school penetration cannot be computed — and the proxy (children registered with GrayBag) reports a number that *rises when adoption stalls*, so it must not be substituted. A credentialed action: it is a conversation with the school, which only Andy has
- [ ] `E12-10` Make the DNS change at the registrar when the cutover plan is ready
- [ ] `E13-09` Review the motion spec with Andy once, before app UI work starts
- [ ] `E13-14` _(fast-follow)_ DS-01 — approve the "500 rule": #00af52 stays the identity colour but functional green moves to primary-700 #007e3b for fills and text. White on #00af52 is 2.90:1 and fails every WCAG bar, so the mocks cannot ship as drawn. This changes what every button, price and field label looks like. Options and the recommendation are in docs/open-questions.md; the consequences are worked through in docs/design-tokens.md §2.1. E13-15 changed what is being asked, and Andy must be told this before he answers: the brand guidelines' Colour Usage Guide assigns #00AF52 to "Buttons & CTAs in UI" in as many words, so approving the 500 rule means deviating from the brand book on one line, not just from the mocks. The case for doing it is that the brand document contains no contrast analysis anywhere — it was written for packaging, presentations and social. The dark-ink-on-green alternative now also contradicts the brand's five approved logo-on-colour pairings, which put white on #00AF52
- [ ] `E14-30` _(fast-follow)_ (risk:high) Install Xcode or the Android SDK on the build machine so Maestro can run. E14-24's flow has still never executed: there is no simulator, no emulator and no Maestro binary on this machine, so the e2e net cannot be proven at all. Ten screens are now shipping behind a test suite that has never run once
- [x] `E16-21` _(fast-follow)_ ~~Re-extract Child.Parent from Bubble with real ids~~ — closed 2026-08-08 by AR1: Child.Parent was never used. Its emptiness is the accurate state, not export damage, so there is nothing to re-extract. Parent↔child is derived from Order instead (order-parent + child), and a child nobody has ordered for correctly has no parent. Andy confirmed this in conversation
- [ ] `E16-29` _(fast-follow)_ Decide what happens to the 3 dish photos that return a permanent 403 and cannot be sourced from Bubble — Aloo Chana Chaat, Tomato/Cucumber Cheese Sandwich, Brown Wheat Pasta with Mushroom and Pesto. New photography, or ship them with a category placeholder
- [ ] `E16-34` _(fast-follow)_ Decide the treatment of the 1 Cancelled order that carries a payment id — money was taken and the order cancelled, and legacy had no refunded status to express what happened next. Confirm whether a refund was issued outside the system; if not, it is an opening ledger credit under E16-16
- [ ] `E16-37` _(fast-follow)_ Decide what to do with the 746 roster children who have no recoverable parent — bulk-imported by the school on 2025-09-21, each with a unique school-code, none linked to an account. Migrate them as unlinked records for parents to claim in-app, or leave them behind and re-import from a fresh school roster
- [ ] `E16-39` _(fast-follow)_ Tell the kitchen that no allergy data is migrating — Child.allergies is empty on all 1,115 legacy rows, so every allergy record in the new system starts blank. They may believe they hold this data
- [ ] `E16-45` _(fast-follow)_ Settle four calorie conflicts. The legacy catalogue holds two rows for each of Blueberry Muffin (400-430 vs 240–340), Lemon Ice Tea (90-120 vs 80–140), Peach Ice Tea (100-130 vs 100–160) and Cold Coffee (160 vs 250–350). The import preserves both figures in dish.nutrition and leaves calories_kcal null rather than choosing — publishing a calorie count nobody measured is the same failure as guessing food_type. A validation: somebody has to say which is right, and only the kitchen knows
- [ ] `E17-01` _(fast-follow)_ Confirm Play App Signing / upload key status (low risk — mandatory since Aug 2021, so almost certainly enabled)
- [ ] `E17-04` (risk:critical) BLOCKED ON E20-35/E20-10 — do not submit while an unscrubbed Sentry is wired up. Answering "not collected" then is a false statement to two app stores. Submit the Apple App Privacy questionnaire and Google Data Safety form — answers drafted for you from E20; you sign them off in the consoles
- [ ] `E17-06` TestFlight build + Play internal testing track, ~15 beta users invited
- [ ] `E17-12` Support plan for the first two weeks (who answers, how fast, what the common issues will be)
- [ ] `E17-26` _(fast-follow)_ Register an iOS device UDID for internal-distribution builds — eas device:create. The staging profile is distribution: internal, which on iOS is ad-hoc: it needs an Apple Developer login (interactive, with 2FA) and at least one registered device, neither of which can be done unattended. Android needs nothing here — EAS generates the keystore itself
- [ ] `E17-27` _(fast-follow)_ App Store Connect app id (ascAppId) for eas submit. Deliberately absent from eas.json (see docs/decisions/environments.md) — a guessed value submits to somebody else's listing. Not needed until the first submit
- [x] `E17-31` _(fast-follow)_ Create an App Store Connect API key so submissions do not need a 2FA prompt. App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys → generate a key named graybag-eas-submit with the App Manager role. The .p8 downloads once and once only. See docs/release-testflight.md for exactly what to do with the three values. A credentialed action: it needs Account Holder or Admin on the Apple account

---

Full backlog: `backlog/` (markdown) or open `backlog.html` for the overview.
