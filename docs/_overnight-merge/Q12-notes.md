# Q12 — store submission pack: overnight-merge notes

Produced by the Q12 worker (store-submission pack). This file collects the cross-cutting
output that Q12 is not allowed to write directly into the shared planning/docs files while
parallel workers are running. Whoever merges the overnight run should fold these into
`docs/open-questions.md`, `docs/decisions.md`, `docs/learnings.md` and the relevant
`planning/backlog/*.md` epics.

The only file Q12 itself produced is `docs/store-submission.md`.

---

## The one blocking cross-check (read this first)

`docs/privacy-policy.md` did **not** exist at Q12's HEAD — it is being drafted in parallel by
the Q11 worker. Every App Privacy / Data Safety answer in `docs/store-submission.md` was
therefore derived from `docs/dpdp-compliance.md` (the tier S/P/A classification, §2.2) and
`docs/data-model.md` §13.3, **not** from the privacy policy.

**Both stores require the declared data collection to match the linked privacy policy exactly.**
Apple rejects for App Privacy answers that contradict the policy; Google's Data Safety form
says in terms that it must be consistent with the privacy policy. So there is a hard
cross-check task before Andy submits — captured as `E17-14` below and flagged at the top of
`docs/store-submission.md` §0.

---

## New open questions

Proposed ids continue the `SS-xx` space (store submission). None have been written to
`docs/open-questions.md` — merge them under a new "Raised by the store-submission pack (Q12)"
heading.

- **[SS-01]** — *Which Data Safety "purpose" values do we actually claim for phone number and
  email?* Google's taxonomy forces each data type into a fixed purpose list (App functionality,
  Analytics, Fraud prevention, Account management, etc.). Phone (OTP) is clearly "Account
  management" + "App functionality". Email is "App functionality" (receipts/invoices). The
  question is whether we also tick "Fraud prevention" for phone, which is defensible (OTP is an
  anti-fraud control) but widens the declaration. **Recommendation:** App functionality +
  Account management only; do not claim Fraud prevention or Analytics against contact data, to
  keep the label minimal and honest. **Blocks launch? No** — it is a wording choice within an
  honest range, resolvable at submission.

- **[SS-02]** — *Do we declare "Data shared with third parties" for the Razorpay payer prefill?*
  Under both stores' definitions, "sharing" means transfer to a third party. The paying adult's
  phone + email are sent to Razorpay as `prefill` (payments-design §3.7). Razorpay is arguably a
  *processor* (App functionality) rather than a party we "share" with for their own purposes —
  but DP-04/§2.1 of dpdp-compliance flags Razorpay may be an **independent fiduciary** (its own
  KYC/fraud/regulatory purposes), which under the store definitions leans towards "shared".
  **Recommendation:** declare payer phone + email as **shared** with the payment processor for
  "App functionality / to complete the payment", which is the conservative, honest reading and
  matches DP-04's uncertainty. Confirm against the final privacy policy and `E20-11`
  processor review. **Blocks launch? No**, but must be consistent with the policy.

- **[SS-03]** — *App Privacy: is declared allergy data "Health & Fitness → Health"?* Apple's
  data-type list has a "Health" type under "Health & Fitness". A child's declared allergies are
  health data (tier S). We collect it, it is linked to the user's identity, and it is not used
  for tracking. **Recommendation:** declare "Health" collected, linked to identity, purpose
  "App functionality", **not** used for tracking. There is no genuine ambiguity here — it is
  included so the merger does not "simplify" it away. **Blocks launch? No.**

- **[SS-04]** — *Do the store consoles need the grievance-officer contact, and is that the same
  as the App Store "privacy contact"?* The four `«…-PENDING-E20-21»` grievance tokens
  (dpdp-compliance §7.2, owner:andy `E20-21`) are unresolved. The privacy policy URL that both
  stores require will contain them. **Recommendation:** no store field needs the officer's name
  directly, but the privacy-policy URL must resolve them before submission — already covered by
  `E20-21` + `E20-22`. Noted here only so the store submission is not blocked on a *store*
  question when it is really an `E20-21` question. **Blocks launch? Yes, transitively** — a
  production privacy-policy URL containing a `«…-PENDING-…»` token must not ship (`E20-22`), and
  the store listing links that URL.

---

## Learnings

- **The store data-safety declarations trace one-to-one to the tier S/P/A model.** Writing them
  was mechanical once `docs/dpdp-compliance.md` §2.2 existed: tier S = Health (allergies),
  tier P = child name/class/section, tier A = adult phone/email/name. The store forms do not
  have a "child vs adult" distinction, so both children's and adults' identifiers collapse into
  the same store "data type" rows — the child-specific protection lives in the app and the
  policy, not in the label. Record this so nobody later tries to encode the S/P/A tiers into the
  store form, which has no field for it.

- **"Data linked to you" vs "not linked" (Apple) is decided by whether it sits against an
  account.** Everything GrayBag collects is linked (there is an `app_user` row and a
  `guardian_link`). There is no anonymised collection. Crash data via Sentry is the only
  candidate for "not linked", and only because §5.3 + PY8 + E20-10 scrub all tiers out of it —
  so Sentry crash data is declared "Diagnostics, not linked, not used for tracking".

- **Neither store label has a place to say "we deliberately do NOT collect X".** The value of
  the deliberate non-collection (no child DOB, no child photo, no precise location, no
  advertising ID, no tracking — dpdp §2.2, §3.3 s.9) is that it makes the label *short*: "No" to
  the Tracking section, "No" to Location, "No" to Advertising. The absence is the asset.

- **App Store "Account deletion" URL is now mandatory.** Apple requires apps that support
  account creation to also offer in-app account deletion AND a web URL to request it. GrayBag
  has in-app deletion (`E03-08`, dpdp §6.5 erasure pipeline) — so the store answer is "yes,
  account deletion is supported", and the URL can point at the grievance/Settings→Privacy flow.
  Captured as `E17-15`.

---

## Decisions

Proposed for `docs/decisions.md` under a new "Store submission" group. These are *mechanism /
presentation* choices about the store declarations, honest and low-stakes, but worth recording
so they are not silently reversed at submission time:

- **SUB1 — The store data-safety declarations are generated from the tier S/P/A model, and the
  privacy policy is the single source of truth they must match.** If the policy and the label
  ever disagree, the policy wins and the label is corrected, never the reverse. Same instinct as
  the `api/` module rule and the token-source rule: one source, derived outputs.

- **SUB2 — Declare conservatively: when a data type could honestly be declared either collected
  or not, declare it collected; when a purpose could be read broadly or narrowly, declare it
  narrowly.** Over-declaring collection is safe (worst case the app looks slightly more
  data-hungry than it is); under-declaring collection is a policy violation and a takedown risk.
  Over-declaring *purpose* (e.g. claiming Analytics on contact data) invites scrutiny we do not
  need. So: broad on "what", narrow on "why".

- **SUB3 — GrayBag declares NO tracking (Apple ATT) and NO advertising ID.** There is no
  cross-app/cross-site tracking, no ad SDK, no advertising identifier, and s.9 of DPDP forbids
  profiling a child (dpdp §3.3). This means no ATT prompt is required. Recorded because adding
  any analytics/attribution SDK later would flip this and require an ATT prompt + a label
  change — it must be a conscious decision, not a dependency someone adds.

---

## Proposed new backlog tasks

Append to the named epics — never renumber. All are unowned build/prep work except where
tagged `(owner:andy)` (submission and console actions only Andy can perform).

**Epic E17 (Release & Cutover)** — `E17-03`/`E17-04` already cover "prepare listing copy and
draft the store answers" and "Andy submits". These are the gaps Q12 found:

- `E17-14` (risk:high) Cross-check `docs/store-submission.md`'s App Privacy and Data Safety
  answers against the **final** `docs/privacy-policy.md` (Q11) once it exists, and reconcile any
  divergence. The store answers were derived from `docs/dpdp-compliance.md`, not the policy,
  because the policy did not exist when they were drafted. **Blocks `E17-04`.**
- `E17-15` Wire the App Store "account deletion" support answer + URL and the Play Store
  "Data deletion" URL to the in-app erasure flow (`E03-08` / `E20-18`), so both stores' deletion
  requirements point at a real, reachable path.
- `E17-16` Produce the actual screenshot assets from the shot-list in
  `docs/store-submission.md` §5, on the required device sizes, once the app shell (`E14`) and
  design system (`E13`) render real screens. Use synthetic/sentinel child data only — never a
  real child's name, class or allergy in a store screenshot (DPDP tier S/P; CLAUDE.md #4).
- `E17-17` Verify the store listing text against each store's field length limits (App Store
  30-char name / 30-char subtitle / 100-char promotional text; Play 30-char title / 80-char
  short description / 4000-char full description) before submission.

**Epic E20 (Compliance)** — one prep item:

- `E20-24` Confirm the third-party-recipient list declared in the store Data Safety form
  (Razorpay, Supabase, SMS provider, Sentry, push) matches the processor register in
  `docs/dpdp-compliance.md` §9 and the `E20-11` review, so the label, the policy and the DPA
  register cannot drift apart.
