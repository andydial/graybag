# Andy's TODO

Your tasks only — 31 open of 31.
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
- [ ] `E00-06` **[high]** Start TRAI DLT registration: Principal Entity on one operator portal (PAN, GST cert, CIN, signatory, letterhead; ~Rs 5,000)
- [ ] `E00-07` **[high]** Register DLT Header / Sender ID GRYBAG as Transactional / Service Implicit
- [ ] `E00-08` **[high]** Register 5 DLT content templates: OTP login, order confirmation, pickup code, refund confirmation, order cancelled
- [ ] `E00-10` **[high]** Accountant: obtain GSTIN, confirm SAC code (996331 assumed), confirm CGST/SGST split for Mohali / SAS Nagar
- [ ] `E00-11` **[high]** Accountant: confirm whether the school's 10% revenue share attracts 18% GST on the school's invoice to GrayBag
- [ ] `E19-03` **[high]** VAG Rounded Next licence check — confirm the licence permits app embedding and webfont use. If not, the entire design system needs a different typeface before E13-01
- [ ] `E20-01` **[critical]** Confirm DPDP obligations that apply to GrayBag with a lawyer or the accountant — children's data, verifiable parental consent, grievance officer, breach reporting timelines

## Needed within 2–3 weeks

- [ ] `E00-09` Open account with SMS provider (MSG91 or Gupshup); link DLT Entity ID, Header and Template IDs
- [ ] `E00-12` Confirm whether menu Price in the Excel is GST-inclusive or exclusive (cart currently adds 5% on top)
- [ ] `E00-13` Verify direct access to Apple Developer account and Google Play Console independent of Bubble
- [ ] `E00-14` Locate original dish images (Bubble CDN URLs die on migration); inventory what is missing
- [ ] `E00-15` Export a full Bubble data dump (users, children, orders, dish_in_order, schools, kitchens, menus) — hand it over; the build side inspects and reports on it in E19-04
- [ ] `E00-18` Check whether any legacy prepaid card / wallet balances exist off-system for early users; if so they must be migrated as opening ledger credits (see E16-15)
- [ ] `E01-00` One-off: authorise the GitHub (gh auth login) and Supabase CLIs on your machine — after this the build side creates and manages both

## Decisions to make (no rush, but they gate later work)

- [ ] `E09-12` Decision parked: default delivery mode (classroom bulk vs counter pickup) until real usage data exists. Both are supported
- [ ] `E18-01` Decide: parent subscribes in-app vs school buys in bulk and bills through school fees
- [ ] `E18-02` Decide: auto-generate daily orders vs subscription acts as prepaid credit with daily dish selection
- [ ] `E18-03` Decide: meal-pack composition (e.g. 20 meals = main + drink + dessert) and whether the customer chooses dishes
- [ ] `E18-04` Decide: unused meals at period end — expire, roll over, or refund
- [ ] `E18-05` Decide: mid-period cancellation and pro-rata refund policy
- [ ] `E18-06` Decide: per-school / per-kitchen subscription pricing (near certain to be needed across cities)

## Later — release and rollout

- [ ] `E12-10` Make the DNS change at the registrar when the cutover plan is ready
- [ ] `E13-09` Review the motion spec with Andy once, before app UI work starts
- [ ] `E17-01` Confirm Play App Signing / upload key status (low risk — mandatory since Aug 2021, so almost certainly enabled)
- [ ] `E17-04` Submit the Apple App Privacy questionnaire and Google Data Safety form — answers drafted for you from E20; you sign them off in the consoles
- [ ] `E17-06` TestFlight build + Play internal testing track, ~15 beta users invited
- [ ] `E17-12` Support plan for the first two weeks (who answers, how fast, what the common issues will be)

---

Full backlog: `backlog/` (markdown) or open `backlog.html` for the overview.
