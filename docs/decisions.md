# Decision log

Every decision made during planning, with the reasoning. If you want to change one,
read the reasoning first.

## Architecture

| # | Decision | Why |
|---|---|---|
| A1 | **React Native + Expo** for mobile, not Flutter | Flutter has a genuine edge in animation on bottom-tier Android and Shorebird gives it OTA. But Claude Code produces better TypeScript than Dart, Flutter Web is unusable for the marketing site (so web is TS either way), and EAS Build/Submit/Update is materially simpler for a solo non-developer. Output quality beat the framework's ceiling. |
| A2 | **Supabase in Mumbai (`ap-south-1`)** for Postgres, Auth, Storage, Edge Functions | ~2ms to Mumbai vs ~200ms to the US, per request. Runs on AWS ap-south-1, not consumer Indian infrastructure. Data residency for free. Fewest vendors. |
| A3 | **No separate API server in v1** | Edge Functions cover it. Kept cheap to add later by the `api/` module rule (A4). |
| A4 | **All app backend calls go through one `api/` module**; reads may use the Supabase client, **writes always via Edge Functions** | Makes "add a dedicated API server" a base-URL change, not a rewrite. Enforced by a lint rule. |
| A5 | **Netlify** for the marketing site + admin web | Static/edge, global CDN. Netlify Functions are *not* used for the API — they have no India region. |
| A6 | **Razorpay only**; Stripe removed entirely | Stripe was half-wired and adds a whole surface for no benefit. |
| A7 | **Two environments (staging + prod) plus PR previews** | Eliminates the current practice of hand-swapping Razorpay keys to test. Costs ~$0–10/month. |
| A8 | **Sentry + Better Stack**, both wired into Claude Code via MCP | Andy is not a developer. Supabase is an official Claude connector; Sentry has an official MCP server. Failures can be investigated by describing them in English. |

## Data model

| # | Decision | Why |
|---|---|---|
| D1 | **One ordering role: Customer.** Parent / CollegeStudent / SchoolStaff are deleted | The legacy enum mixed *who you are* with *what you can do*. |
| D2 | **School lives on the Recipient, not the user.** Recipient = self or a dependent | Solves teachers ordering for themselves, uni students, parents with kids at two schools, and a parent who is also a teacher — with no role logic. |
| D3 | **Back office uses scoped grants**, not a role enum: KitchenOperator, SchoolViewer, PlatformAdmin | Lets `orders.mark_delivered` be split from `orders.refund` so a Delivery role can exist later with no migration. |
| D4 | `Menu` owned by Kitchen + `MenuAssignment(school, menu, dates)` | Replaces three competing legacy paths (School.menu, Kitchen.default_menu, School_Menu). Supports shared and per-school menus. |
| D5 | **Config resolution chain**: platform → kitchen → school | Cutoff (midnight default), prices, break times, revenue-share %. Resolved at write time and snapshotted onto the order, so no read-time cost and order history stays correct. |
| D6 | **Ledger from v1** (append-only credits/debits with reason codes) | Refunds-to-wallet, school revenue share and future subscriptions are all the same primitive. Retrofitting a ledger after money has moved is painful. |
| D7 | **Structured allergen tags from day one** | The source Excel already has an Allergens column, so the data exists. Enables allergy warnings at add-to-cart nearly free. |
| D8 | **Authorization default-deny with a dedicated test suite** | The legacy app exposed all orders and all child records publicly. This must be impossible to regress. |
| D9 | Reporting partitioned/indexed by city + kitchen from day one | Multi-city expansion is expected; a Chandigarh report must never scan Delhi data. **Under challenge** — `DM-05` in `docs/open-questions.md` argues for index-now / partition-later and proposes rewording this to "*scoped* by city + kitchen". Do not treat the partitioning half as settled until Andy rules. |
| D10 | `guardian_link` is the **only** authorization path from a user to a recipient. `recipient.created_by_user_id` exists for audit and must never appear in an RLS policy | The legacy model had two parallel parent→child links (`Child.Parent` list and `Guardian_Link`), so there were two answers to "may this user see this child" and they could disagree. One path means one answer. Follows from D2 and E02-14. |
| D11 | Back-office **grants are the source of truth**; role templates (KitchenOperator, SchoolViewer, PlatformAdmin, DeliveryAgent) are only bundles that expand into grants at assignment time. Editing a template never retroactively changes anyone's access | Keeps D3's promise that `orders.mark_delivered` can be split from `orders.refund` with no migration, while making onboarding one click. Access changes stay explicit and audited. |
| D12 | Razorpay **signatures are verified server-side and then discarded** — never stored | The legacy `Temp` table held payment signatures in an unbounded, world-readable table. Nothing downstream needs them, and storing them creates a credential-shaped asset with no owner. |
| D13 | **Percentages are integer basis points** (`_bps`, 0–10000) everywhere, mirroring the integer-paise rule. 10% revenue share is `1000` | Same reasoning as paise: no float ever touches money, including the multiplier. |
| D14 | Invoice numbers come from a **counter row locked `FOR UPDATE`**, never a Postgres `SEQUENCE`, and are allocated only after payment capture | Sequences are explicitly non-transactional — a rolled-back transaction consumes its value and leaves a hole, which is exactly what M3's gapless requirement forbids. Serialisation is inherent to gapless numbering and is irrelevant at a few thousand invoices a month. |
| D15 | Personal data is **never hard-deleted** where an invoice or ledger entry depends on it. Deletion sets `deleted_at` (access stops immediately) then anonymises in place; a child's allergy data is deleted outright | Reconciles app-store account deletion and DPDP erasure with statutory invoice retention. Cascading deletes would destroy the books. The retention *numbers* remain open (`DM-15`). |
| D16 | Idempotency is enforced by **database constraints, not application logic** — unique `(customer, idempotency_key)` on the checkout, unique `(provider, provider_event_id)` on webhooks, unique `(source_type, source_id, reason_code)` on ledger transactions, and a unique partial index preventing a second captured payment per checkout | Logic gets refactored; constraints do not. E06-04's "the same event must never double-credit" should be impossible, not merely handled. |
| D17 | **RLS is enabled on every table in the *initial schema* migration, with no policies at all.** The policies themselves arrive in `0002_rls_policies.sql` | Enabling it in the same migration that creates the tables means that if `0002` is ever missing, delayed, half-applied or rolled back, the failure mode is "nobody can read anything" rather than "anyone can read everything". The legacy app failed the other way round: `Order` was readable by any visitor and ten types including `Child` had no rules at all. Default-deny has to be the resting state of the database, not a thing a second migration adds. Follows D8 |
| D18 | Closed value sets that the target ERD's enum inventory (§13.1) does **not** name — device platform, notification channel and category, notification delivery status, payout line kind — are `text` with a `CHECK`, not new enum types | The ERD is the source of truth for the schema, and inventing four enum types it does not list would be exactly the kind of quiet divergence that makes the document stop being trustworthy. `CHECK` constrains the same values and is cheaper to extend (`ALTER TYPE … ADD VALUE` cannot run in the transaction that adds it). Revisit only if the ERD adds them. |

## Auth

| # | Decision | Why |
|---|---|---|
| U1 | **Google / Apple / email-OTP sign-in — no phone OTP, no passwords.** *Supersedes the original "Phone + OTP" decision.* Google Sign-In is primary; Sign in with Apple on iOS (Apple requires it once Google is offered); email OTP via Supabase `signInWithOtp` for non-Google addresses. Phone OTP becomes a fast-follow *addition*, not a replacement. Mobile number stays a **profile field** (kitchen contact + last-4 search), never a login credential. Back-office unchanged (email). | DLT SMS registration had weeks of lead time on the launch critical path — Google/Apple/email have none. Cheaper (no ~Rs 0.15/OTP, no SMS account). Lower friction for an Android-heavy audience already signed into Google. Removes an account-takeover migration risk: the legacy `mobile` field is a *number* type that already lost leading zeros and `+91`, whereas Bubble exports email, so `E03-16` matches on email unambiguously. Email infra (SPF/DKIM/DMARC) is already required for GST invoices (`E07-05`), so the work is shared, not extra. DLT registration (`E00-06`…`E00-09`) continues *off* the critical path for future order-update SMS. |
| U2 | **No password migration** | Bubble cannot export password hashes — a hard limitation. Everyone re-authenticates once regardless, so switching to OTP costs nothing extra. |
| U3 | Long-lived refresh tokens (90–180 days) with silent refresh | Returning users rarely re-authenticate, keeping friction (and, for email OTP, message volume) low. Android SMS Retriever now rides with the phone-OTP fast-follow (`U1`), not v1. |
| U4 | **Sender identity for all transactional mail** (OTP, confirmations, invoices) | From `GrayBag <orders@graybag.com>`; Reply-To `support@graybag.com` (parents reply — it must reach a human); no `no-reply@` addresses. Exactly **one** SPF record on the domain — extend the existing Google Workspace record, never add a second (two SPF records fail silently and are the commonest cause of spam-foldering). DMARC starts `p=none`, tighten to `p=quarantine` after two weeks of reports. Shared infra with `E07-05`. |

## Product

| # | Decision | Why |
|---|---|---|
| P1 | School attendance is **self-declared** | Schools refused to maintain the roster. School code is dead. |
| P2 | **No holiday-calendar blocking** in v1 | Kitchen/Admin refunds to wallet instead. |
| P3 | **No per-dish capacity limits** in v1, but the counter table is designed | A `(menu_item, service_date, remaining)` row with an atomic decrement costs less than the order insert. Not a `COUNT(*)`. |
| P4 | Delivery: **bulk mark-delivered per class** + **4-digit pickup code** for counter collection + name / last-4-phone fallback | No QR printing. Pickup code goes in the confirmation email and on the invoice, so children without phones are covered. |
| P5 | Default delivery mode **parked** | Depends on real usage patterns (whole-school vs a few orders per class). Both are supported. |
| P6 | School reports = **monthly PDF emailed**, not a portal | Lands in the principal's inbox rather than waiting to be discovered. Far cheaper to build. |
| P7 | **One web app** for marketing site, admin, kitchen ops and school reports | Cheaper than three; can be split later. |
| P8 | **Read-only offline** in v1 | Offline *ordering* needs conflict handling (price change, sold out, cutoff passed) and is not worth delaying launch for. |
| P9 | **Push + email only.** No WhatsApp in v1 | Deferred, not rejected. |
| P10 | **English only** | |
| P11 | **Device tier de-emphasised.** Audience is private schools in tier-1 cities, so mid-range Androids, not bottom-tier | The real performance constraint is **network**, not CPU. Keep the menu cache, skeletons, optimistic UI, image sizing and offline reads; drop the obsession with the cheapest handsets |

## Money

| # | Decision | Why |
|---|---|---|
| M1 | **GrayBag is seller of record**; kitchens are paid monthly | Determines who invoices the parent and how GST flows. |
| M2 | 5% GST, shown as **CGST 2.5% + SGST 2.5%** | Place of supply Mohali / SAS Nagar — intra-state. Cart currently shows a single lump "5% tax", which is not compliant. |
| M3 | **Gapless sequential invoice numbers per financial year** | Statutory. Failed payments must not burn numbers — needs deliberate design. |
| M4 | School revenue share **10% default, editable per school by Admin only** | Via the config chain (D5). |
| M5 | Razorpay **MDR on refunds comes out of the school's share** | Andy's decision. |
| M6 | Settlement is **manual bank transfer**; Razorpay Route deferred | Admin report computes what is owed, allows an edit, then mark-as-paid. |
| M7 | **Refund to wallet by default**, refund-to-source as an option | Instant vs T+5 days, and cheaper. Wallet *top-up* UI is deferred; the balance and the ledger are not. |
| M8 | Any tax incurred on the school share comes **out of the agreed 10%** | GrayBag pays no tax on top of the share. |

## Design system and motion

Made in Q05 while writing `docs/design-tokens.md` and `docs/motion-system.md`. The brand
palette, the typeface and the nine mock screens come from `Graybag_Design Package` and are
givens; everything below is a choice about how to build on them.

| # | Decision | Why |
|---|---|---|
| S1 | **The motion catalogue is closed.** Fourteen entries, `M01`–`M14`. New screens implement from it; they do not invent. An `M15` requires a line in this file naming the genuinely new interaction | Fluidity is not more motion, it is the *same* motion everywhere. An open catalogue reopens as a per-component free-for-all within about three sprints, and the result is the "flying bird" feel the rebuild exists to remove. A reviewer should reject a bespoke animation the way they reject a hard-coded hex |
| S2 | **Four duration tokens (0 / 120 / 200 / 320ms) and a hard 350ms ceiling.** No other duration exists; a numeric literal fails lint | The network is the constraint, not the CPU (P11). Animation time is added *on top of* an already-long wait, so a 400ms transition is not elegant — it is 400ms of extra nothing. Below ~100ms the user cannot learn where the new thing came from; above ~350ms the motion stops being a cue and becomes a wait |
| S3 | **Three easing curves, named by role** — `standard` (on screen before and after), `enter` (arriving), `exit` (leaving) — not by shape | Makes choosing a curve a mechanical question about the content rather than a matter of taste, which is what stops a fourth curve appearing. `linear` is permitted in exactly one place, `M03`'s shimmer, because a loop with easing visibly pulses |
| S4 | **Exactly one spring, `spring.pop`, allowed in exactly one place: the cart badge (`M06`).** Any `withSpring` outside that module fails the build | A spring is a fourth *kind* of motion — no fixed duration, it overshoots, and it composes badly with the three curves. It is allowed once because adding to cart is the only action whose confirmation appears somewhere other than where the user is looking, so it must attract the eye. Everywhere else, attracting the eye is a bug. Note the deliberate asymmetry with `E13-04`, which asked for three easing curves: three curves is what §3 delivers, and the spring is named separately so its single use site is obvious |
| S5 | **Skeletons for every first load. No spinners anywhere, and never a full-screen blocking spinner** | On an unreliable connection a skeleton shows the *shape* of what is coming, which reads as progress; a spinner reads as a stall. The rule that makes it work is geometric: a skeleton's boxes must match the real content's boxes exactly, so nothing shifts when the data lands. Two deliberate non-skeletons: empty states and error states are real compositions |
| S6 | **The 500 rule.** `#00af52`, `#ffbb39`, `#b3cf3f` and `#e5ea98` are **identity** colours, not ink — logo, pattern, illustration, brand fields with nothing legible on them. Every functional use of a brand hue is one or more steps darker | White on `#00af52` is 2.90:1 and fails everything, including the 3:1 a control boundary needs. This keeps the brand exactly as supplied while making the product legible, instead of the alternative — changing the brand green, or shipping an accessibility defect that `E13-10` would fail CI on anyway. **Needs Andy's validation once: `DS-01` / `E13-14`** |
| S7 | **Components import semantic roles (`bg.surface`, `text.price`, `action.primaryBg`), never ramp steps (`primary-700`)** | It is what makes a future dark mode a second mapping file rather than a rewrite (`DS-03`), and it is what makes a contrast test possible at all — the test walks the role map, which a component reaching directly into a ramp would escape |
| S8 | **One token source, two outputs, no third.** `packages/shared/src/design/` is authored once; mobile imports the objects, web generates CSS custom properties from the same modules at build time. A Figma file, if one appears, is downstream | Two hand-maintained copies of a palette diverge, and the divergence is invisible until someone screenshots both products side by side. Same reasoning as the `api/` module rule (A4) |
| S9 | **The back office is deliberately near-motionless** — five of the fourteen patterns, no stagger on tables, static skeletons with no shimmer | A kitchen operator marking forty orders delivered before a break is using a work tool in a hurry. Motion there is a tax on time, and a shimmer over a table of numbers is actively harder to read than the word "Loading" |
| S10 | **No runtime animation player** — no Lottie, no Rive, no animated illustration, no confetti | It is a dependency, a bundle cost on a network-constrained product, and a standing invitation to break S1. The one celebratory moment in the mocks ("congratulations, your account is complete") is a static composition and stays one |
| S11 | **Light mode only in v1** | Not in the mocks and not in the package; it roughly doubles the contrast surface to design and test. S7 is what keeps the door open. `DS-03` |

### Taken on reading the brand guidelines — `E13-15`, 2026-08-09

`00_Graybag_Brand Guidelines.pdf` had never been read; `docs/design-tokens.md` was provisional
on that fact (`DS-05`). It has now been read in full. The rule going in was **the brand document
wins on anything about the brand**, and these are the four places that rule actually bit. The
per-change table is §0 of `docs/design-tokens.md`.

| # | Decision | Why |
|---|---|---|
| S12 | **The type scale is derived from the brand's four bands, not merely checked against them.** Main Heading Semi Bold 48–32, Heading Semi Bold 32–28, Subheading Medium 24–20, Body Regular 16–12. Mobile sits at the bottom of each band: 32 / 28 / 24 / 20, body 16–12 | Three tokens were outside every band — `h3` 18 and `bodyLg` 17 in the unspecified 20–16 gap, `overline` 11 below the floor. Sizes are the cheapest thing in a design system to move and the most expensive to argue about later, so they move now, before `E13-01` writes them into code and `E13-03` builds components on them. The 11pt `overline` also contradicted this file's own "12 is the floor" sentence, sitting one line below it — reconciliation found a bug that was already here, which is the argument for doing reconciliation before code rather than after |
| S13 | **There is no Bold in the product. The three bundled weights are Regular 400, Medium 500, SemiBold 600** | The brand's hierarchy uses Semi Bold for headings and Medium for subheadings; Bold appears in the specimen but in none of the four levels. The count stays at three, so `E19-03`'s licence question does not grow — it changes which three files it names, which only matters if the answer is priced per weight. `label` and `button` keep 600 in the Body band: they are UI chrome at 13 and 16 points, the brand hierarchy has no row for a button, and small type needs mass on a mid-range phone in daylight |
| S14 | **The brand's Colour Usage Guide is adopted as four new role tokens** — `bg.surfaceAccent` and `border.accent` (`#E5EA98`: "light UI surfaces (cards, containers)", "soft separators"), `nav.itemActive` (`#145F48`: "secondary UI elements (tabs, toggles, footers)"), `badge.bg`/`badge.fg` (`#FFBB39`: "UI highlights (notifications, badges)") | These are UI instructions the brand gave and the token file had not picked up — the tab bar was heading for grey ink and cards for plain white. Adopting them costs nothing and it is the difference between a product that matches the brand book and one that merely uses its hexes. Each arrives with its contrast measured, which is how the trap was caught: **`text.link`/`text.price` on `bg.surfaceAccent` is 4.09:1 and fails AA** — a price on a lime card must be `forest-500`. `E13-13` asserts that as a forbidden pair rather than leaving it to review |
| S15 | **`radius-none` is restricted to elements with no visible corner.** Containers, image frames and backgrounds are always rounded | The brand's Shapes & Geometry page names rounded corners as identity-critical and shows a square-cornered rectangle as its one ✗. This file had allowed `radius-none` on full-bleed images, which is right only when the image bleeds off every edge — a hero whose bottom edge lands inside the layout is an image frame and gets `radius-lg`. No numbers changed; the rule for choosing between them did |

### The failing role pairs, and why they were all the same mistake — `E13-17`, 2026-08-09

`DS-06` listed five semantic-role pairs failing the bar `E13-13` will assert, and filed them
under "Needs Andy — brand" on the assumption that fixing them meant repainting brand colours.
Walking the whole §2.9 map found eight, and found that they are one error repeated.

| # | Decision | Why |
|---|---|---|
| S16 | **An ink token is chosen against the darkest surface it may legitimately sit on, never against white** | `neutral-500`, `danger-600` and `amber-700` were each picked by measuring against `neutral-0`, each passed there, and each failed somewhere real: a placeholder's home is inside an input on `neutral-100` (4.2280), error text's home is the `danger-50` banner it exists to pair with (4.4441), warning text lands on the muted fill (4.4057). That is one mistake made three times, and it is the kind that only shows up when you enumerate rather than reason. Stating it as a rule is what stops the fourth |
| S17 | **The ink moves, never the bar and never a brand hue.** `text.tertiary` → `neutral-600`, `text.secondary` → `neutral-700` (to keep three visible steps), `text.danger` → `danger-700`, `text.warning` → `amber-800`, and `nav.itemInactive` / `status.warning` / `status.danger` follow their ink. `neutral-500` and `amber-700` stop being text colours | Six of the seven values are greys, an error red and a warning brown — **none is in `02_Colour Palette` and none is visible as "the brand changing"**, which is why this did not need Andy despite being filed as though it did. The alternative, lightening `bg.surfaceMuted` so the old ink passed, would have moved a surface every screen uses in order to save one grey |
| S18 | **`bg.surfaceBrandStrong = primary-700` is added, and `bg.surfaceBrand` is narrowed to controls and large text** | White on `primary-600` is 3.85 — legal for a control boundary and large text, illegal for body text — and `bg.surfaceBrand` was *defined* as the green field that carries things. The role map had **no legal body-text colour for any green surface**, which is not a tuning problem, it is a hole. Adding the surface fixes it without weakening `text.onBrand`, and it introduces no new colour: `primary-700` is what `action.primaryBg` already is. It is `DS-01`'s consequence applied to a surface, so it stands or falls with `E13-14` |
| S19 | **The contrast test asserts a declared list of pairs, plus a second list asserted to keep failing** | A cross-product of inks against surfaces yields 78 "failures", nearly all meaningless — white on white, a focus ring on the dark band. A test that flags those is a test someone switches off, and then it protects nothing. The forbidden list matters as much as the legal one: `text.price` on a lime card (4.09), `border.default` as a control boundary (2.28), `neutral-500` as any ink — each is a combination a component would plausibly reach for, and a test that only checks legal pairs never notices a new illegal one. Both lists are §9.1 |
| S20 | **Ratios are compared at full float precision with `>=`, never at two decimal places** | Four wrong numbers in this file share one cause: rounding before judging. `forest-600` on `primary-600` (`E13-16`), then `forest-500` on `amber-500` at **4.4994**, `neutral-500` on `neutral-50` at **4.4969**, `primary-700` on `primary-100` at **4.4734**. Every one prints as a pass. The two-decimal figure is for humans; the assertion uses the float |

**One of those is worth reading twice.** `forest-500` on `amber-500` is the pair the **brand
guidelines themselves recommend** — their Colour Usage Guide puts `#145F48` on "Text on
yellow/light backgrounds". It misses AA by six ten-thousandths. Text on brand amber is
`forest-700` (7.40), which honours the instruction and is legal. The brand document is right
about the *direction* and has no way to be right about the *number*, because it contains no
contrast analysis anywhere — which is the same fact that governs `DS-01`.

**What the brand document did *not* settle, and what got worse.** Its Colour Usage Guide assigns
`#00AF52` to **"Buttons & CTAs in UI"** in as many words. `S6`, the 500 rule, puts the button
fill at `primary-700` because white on `#00af52` is 2.90:1. **`DS-01` is therefore no longer a
correction to the mocks — it is a documented deviation from the brand guideline**, and that is
what `E13-14` now asks Andy to approve. It was not resolved here: `E13-15`'s mandate was to
reconcile, the brand document contains no contrast analysis to weigh against, and the change is
visible on every screen in the product. Recorded in §2.1 and §2.11 of the token file so that
nobody re-derives the conflict from scratch and quietly picks a side.

## Order lifecycle

Made in Q06 while writing `docs/order-lifecycle.md`, which is the specification `E05` and `E06`
are built from. Everything below is a choice about *how* the order and its money move; the
states themselves come from `E06-05` and the enums in `0001_initial_schema.sql`.

| # | Decision | Why |
|---|---|---|
| L1 | **`"order"` is the state machine; `order_group.status` is derived by trigger and is never written directly by an Edge Function** | Two independently-writable status fields describing the same money is how you end up with a group that says `paid` over three orders that say `cancelled`, with no way to tell which is right. Also means `[DM-01]` landing on two levels costs almost nothing — the machine is on `"order"` in either shape |
| L2 | **The legal-transition table is hard-coded inside the trigger function, not stored in a table**, and the same trigger writes the `order_event` row | Which transitions are legal is not configuration. A `order_status_transition` table is data, and data is editable by whoever holds the grant — the entire point of the trigger is that no grant can make `pending_payment → delivered` happen. Writing the history in the trigger rather than the caller is what makes "every status change has exactly one event" true rather than aspirational |
| L3 | **Payment state is monotonic on a capture rank (`created` 0 → `authorized` 1 → `captured` 2), and the refund axis is derived from completed refunds rather than transitioned** | Webhook delivery is not ordered. `payment.authorized` arriving after `payment.captured` is normal, and a handler that assigns the inbound event's status downgrades a captured payment — after which the order is `paid`, the invoice is issued, and nothing looks wrong until the month-end reconciliation finds a hole |
| L4 | **The database transaction commits before the Razorpay order is created**, not after | The two orderings fail differently. Razorpay-first can leave a customer charged against a checkout we have no record of, which needs a manual reconciliation against their dashboard to even discover. Database-first leaves a group with no payment attempt, which the customer's retry or the sweeper closes. Choose the recoverable failure |
| L5 | **`paid` means captured, never authorized. Nothing is prepared or delivered against an authorization** | An authorization is a promise; a kitchen that cooks against one is extending credit it did not agree to. Related: `[OL-01]` recommends auto-capture, which makes `authorized` a state we barely see |
| L6 | **Cutoff enforcement always compares `now()` (from Postgres) against `order.cutoff_at`, the value snapshotted at write time** — never against a re-resolution of the config, never against a client clock | Follows `D5`. An admin changing the cutoff at 9pm must not retroactively invalidate an order placed at 8pm, and a device clock is not evidence. One clock, one place, one snapshot |
| L7 | **A price or cutoff change discovered inside the checkout transaction aborts the checkout.** The server never charges an amount the app did not display | Charging a different number from the one on screen when the customer tapped Pay is a chargeback, and at scale a regulatory problem. The cost is one extra tap on a rare event. Recorded as `[OL-06]` because the alternative is to forbid same-day price edits instead |
| L8 | **`paid → delivered` is legal without passing through `preparing`** | `E09-05` is "mark all delivered per class, one tap" — a kitchen operator clearing forty orders before a break will never mark anything `preparing`. A state machine that forces a step nobody performs gets worked around, and the workaround is worse than the missing state. `preparing` stays because `E08-04` notifies on it |

## Payments integration

Made in Q07 while writing `docs/payments-design.md`, the specification `E06`'s provider-facing
half is built from. `docs/order-lifecycle.md` decides *when* money may move; everything below is
a choice about *how* it moves across the Razorpay boundary. All of it is provisional until
`E19-01` returns — §12 of the payments design lists the twenty statements it must confirm.

| # | Decision | Why |
|---|---|---|
| PY1 | **There are three Razorpay secrets, not one, and the key secret and the webhook secret must never be set to the same value** | They authenticate opposite directions: the key secret proves we are us when we call Razorpay; the webhook secret proves Razorpay is Razorpay when it calls us. Making them equal turns a leak of either into a leak of both. They are also the HMAC keys for two *different* signatures over two *different* messages, which is the single most common way to get this integration wrong |
| PY2 | **The webhook endpoint's only guaranteed job is to record the event durably. It answers `200` to everything — including a bad signature, an unknown event type and its own processing failure — and we own the retry from that moment** | A `4xx` makes Razorpay retry a request we will never accept; a `5xx` on an unknown type buys a retry storm that buries the real events. The single exception is a failure of the *insert itself*, where their retry is the only remaining copy. The cost of owning retry is that the 5-minute sweep over `pending`/`failed` needs its own liveness alert, not just an error alert |
| PY3 | **A misconfigured webhook secret is indistinguishable from an attack, and needs its own alert** | Under PY2 a wrong secret fails 100% of webhooks, records each one, acts on none and returns `200`, so Razorpay stops retrying. No 5xx appears anywhere and Sentry stays quiet; settlement still works for customers who stay in the app, so the symptom is "*some* payments are late" — worsening as UPI intent app-switches take their share. `E15-05` therefore splits: a few failures against a background of successes is probing (warn); ~100% since a deploy, **or zero verified events in a window in which orders were placed**, is our configuration (page). The second half also catches a webhook that was never registered, which produces no rows to compute a rate from |
| PY4 | **The client is never a source of truth about money, and a verified signature does not change that** | A verified `razorpay_signature` proves the callback body was not tampered with. It does not prove the payment captured. So `/verify` verifies and then **fetches the payment from Razorpay's API**, and `GET /checkout/:group/status` reconciles against the provider rather than reporting our own row. Follows `E06-03` |
| PY5 | **`refund.destination` is a request, not a guarantee — one logical refund may become two rows** | An order paid partly from wallet has only the card portion at the provider, so "refund it all to source" is not partially possible, it is impossible. The wallet-funded portion goes back to the wallet and the rest to the requested destination, capped at what source actually captured. `[PAY-02]`. The alternative — proportional across both — is defensible in accounting and impossible to explain to a parent |
| PY6 | **Refund arithmetic never re-derives tax. A full-line refund equals `invoice_line.total_paise` exactly; a full-group refund equals `invoice.total_paise` including `round_off_paise`; a partial-quantity refund floors per unit and the last unit carries the remainder** | The invoice is the document of record and its numbers were fixed when it was issued. Re-deriving means a later change to the `[DM-19]` rounding rule silently changes the refundable amount on historical orders. The last-unit-carries-the-remainder rule is what makes refunding a line one unit at a time sum to exactly the line total |
| PY7 | **Reconciliation is three tiers on three clocks, and only one break class self-heals** | In-flight (minutes) asks "is this attempt still alive"; daily (transaction) asks "does our set equal Razorpay's"; settlement (cash) asks "did the money arrive". Conflating them gives a job too slow to catch a stuck payment or too noisy to read. Only B3 — captured at the provider, not with us — is fixed automatically, because it has exactly one correct response. Everything else alerts and waits: a job that "fixes" a discrepancy it does not understand destroys the evidence needed to find out why |
| PY8 | **Nothing identifying a child ever crosses to Razorpay, and it is a test, not a rule** | Non-negotiable #4 applies to payment processors as much as to Sentry. `notes` carries `order_group_id`, `correlation_id` and `order_ref`; `prefill` carries the paying adult's phone and email, because they are the payer. `E06-25` asserts a sentinel recipient name appears in no outbound request body and no stored payload — because this is exactly the rule a well-meaning "let's add the child's name so support can find it" PR breaks in one line |
| PY9 | **An orphan Razorpay order is acceptable, which is what makes `L4`'s ordering safe** | If the Orders API call succeeds and our insert then fails, a provider order exists that we have no row for. It is harmless because **the client only ever learns a `razorpay_order_id` from a response we successfully returned** — so an order created by a call whose response never returned is unpayable. Break class B1 in the daily reconciliation is the check on that reasoning |

## Menu import

Made in Q08 while building `tools/menu-import/`, the prototype that proves the spreadsheet
format before `E04-04` is built. The source workbook is **not in the repository** (`[MI-01]`),
so everything below is a choice about how the importer behaves, not a claim about the data.

| # | Decision | Why |
|---|---|---|
| MI1 | **A blank `Allergens` cell means *unknown*, never *none*.** `allergens_declared_none` is true only when the cell says so explicitly; a blank cell imports with no tags **and a warning** | These are the same JSON — an empty tag list — and they are opposite facts. A kitchen that has not filled the cell in has told us nothing, and rendering that as "no allergens" at add-to-cart is precisely the failure `D7` exists to prevent. Making the distinction a stored field rather than an inference is what stops it being lost the first time someone writes `if (!dish.allergens.length)` |
| MI2 | **What fails a row versus what merely warns is decided by whether being wrong could hurt someone**, not by how confident the parser is | Unparseable calories become `null` with a warning, because a missing calorie count harms nobody and a *guessed* one is worse than none. An unrecognised allergen fails the row outright. So does anything about money. The rule is written down because the natural instinct when an import strands 30 rows is to relax whichever check is loudest, and it must be obvious which checks are not available for relaxing |
| MI3 | **Every row below the header is accounted for: a dish, a rejection, or a counted blank.** `accepted + rejected + skipped == rows_below_header` is asserted by a test | A menu importer that quietly drops the four rows it did not understand produces a menu that is *almost* right, which is the hardest kind of wrong to notice. Unrecognised *columns* are reported for the same reason. Follows the same instinct as `D17` — the resting state must be loud |
| MI4 | **Zero dependencies. `.xlsx` reading is ~300 lines of `node:zlib` in `src/zip.mjs` and `src/xlsx.mjs`** | The repo has no `node_modules` and no lockfile, and this has to run for a non-developer with `node` and nothing else. Cost accepted: no ZIP64, no `.xls`, no `.csv`, and **no styles — so date cells are not interpreted**. No column in this format is a date; that is the first thing to fix if one is ever added. It throws a clear message on each rather than misreading |
| MI5 | **The importer never decides anything the data model has left open.** `food_type` is `null` on every dish (`[DM-17]`) and `price_is_tax_inclusive` is `null` on every dish (`[DM-20]`), both emitted explicitly rather than omitted | An importer is the most tempting place in the system to quietly settle an open question, because it is the only place that has to produce a value for every field. Writing the null explicitly, and emitting a file-level notice on every run, means the gap stays visible instead of being answered by whatever the first consumer defaults to |
| MI6 | **The allergen synonym table carries kitchen vocabulary, not textbook vocabulary** — `paneer`, `maida`, `til`, `kaju`, `sarson`, `atta`, `dahi` | The people who write the Allergens column write what they cook with. A table that only knows "milk" and "wheat" pushes every real cell into the unmapped bucket, and a validator that fails everything gets switched off |

## GST and invoicing

Made in Q09 while writing `docs/gst-invoicing.md`, the specification `E07-01`…`E07-08` are built
from. `M1`–`M8` fix the commercial terms; everything below is a choice about the **document**
that records them. All of it is provisional on `E00-10` in one specific way: §2 of that document
lists the placeholders, and `G3` is the rule that stops them shipping.

| # | Decision | Why |
|---|---|---|
| G1 | **GST rounding is per line, per tax component, half-up — resolving `[DM-19]`.** The invoice is the sum of its lines and never recomputes tax; it transcribes `order_line.tax_cgst_paise` and `tax_sgst_paise` | It was never a free choice. `order_line` already carries integer-paise tax, the group's totals are asserted to be the sum over its lines, and `order_group.payable_paise` is the number Razorpay was charged — so per-invoice rounding would produce an invoice that disagrees with the bank statement by a few paise on any invoice with an odd count of fractional lines, and `round_off_paise` would become a permanent fudge factor instead of an exceptional residual. Consequence worth asserting in a test: `round_off_paise = 0` under tax-exclusive pricing |
| G2 | **CGST and SGST are each computed independently from the taxable value. Never compute 5% and halve it** | They are two separate levies on the same base and the return is filed with the two figures separately; there is no statutory "5%" to halve. Halving a rounded 5% gives *unequal* halves — CGST ₹3.12 and SGST ₹3.13 at identical rates on an identical base, which is visibly wrong. Computing each independently gives equal halves whose sum can be a paise either side of 5%, and that is the correct arithmetic, not an error. `tax_total` is therefore *defined* as `cgst + sgst + igst`, everywhere |
| G3 | **In production the invoice issuer refuses to allocate a number while the GSTIN or SAC is still a placeholder** | Seller identity is snapshotted onto the row (a reprint must be byte-identical), so a wrong value cannot be fixed by editing config — it is baked into every invoice already issued, and unwinding it needs a credit note and a reissue for each. Being unable to complete a purchase on day one is a smaller problem than a month of non-compliant invoices |
| G4 | **The CGST+SGST versus IGST split is derived per invoice from the seller GSTIN's state code against `place_of_supply_state_code`. It is never hard-coded** | `M2` asserts intra-state on the basis that the place of supply is Mohali, but intra-state-ness depends on GrayBag's *registered* state, which is the first two digits of a GSTIN we do not have. Deriving it costs one comparison, makes `M2` a consequence rather than an assumption, and is what lets `D9`'s second city work at all. `[GST-02]` |
| G5 | **The wallet is a payment method, not a discount. `invoice.total_paise` is the full value of the supply, and the wallet appears below the total as settlement** | The supply happened at its full value and how the buyer settled it is not a tax question. Stronger: under `M7` wallet credit usually originates from a refund that already carried a credit note reversing its tax, so reducing the taxable value again relieves the same tax twice. Getting this backwards is a plausible one-line mistake that under-reports GST, so both halves are asserted |
| G6 | **The invoice grand total is not rounded to the nearest rupee. Exact paise are charged** | Razorpay charges exact paise and the arithmetic is already correct; a rupee round-off is a second adjustment on top of a right answer, and it changes the amount charged rather than only the rendering. `round_off_paise` stays available for the conventional line if the accountant wants it — `[GST-03]` — but adding it later needs a dated cutover, not a template change |
| G7 | **An invoice line names the recipient's first name only. No surname, no class, no section** | The parent has to be able to tell two children's lines apart on their own invoice, so the recipient must appear. But `D15` retains the invoice through erasure, which means whatever goes into `invoice_line.description` **cannot be scrubbed by a DPDP request** — it is the statutory record. A first name is defensible in that position; a name-class-section triple is a school roster preserved indefinitely inside the accounts. `class_label_snapshot` exists for the packing list and has no purpose on a tax document |
| G8 | **An invoice row is never deleted and the counter never moves backwards or skips — both enforced by trigger, not by convention. A withdrawn document is a credit note; `status = 'cancelled'` is for data-fix artefacts only, and keeps its number** | `D14` makes allocation safe; it does not make the *series* gapless. Gaplessness is a property of the rendered series, and a correct counter proves nothing if a row can vanish from under it. Five ways to make a hole are enumerated in §5.1 of the document and each has a named control, because a hole in a statutory series does not self-heal and is typically found a year later by an auditor |
| G9 | **The invoice number is `GB/26-27/000417` — 15 characters. The financial year is derived from `issued_at` in the platform timezone, never UTC and never from `service_date`** | Rule 46(b) caps the serial number at sixteen characters; the format previously carried as an example, `GB/2026-27/000417`, is seventeen. Two letters rather than three leaves `GBC/26-27/000417` at exactly sixteen if `[PAY-06]` lands on a separate credit-note series. The timezone half is not hypothetical: 05:20 IST on 1 April is 23:50 UTC on 31 March, so a UTC derivation files that invoice in the previous year, *after* numbers already issued in the new one — a hole in one series and an out-of-order number in the other |
| G10 | **The invoice PDF is rendered once, stored, and thereafter served as bytes. Re-download never re-renders** | Same instinct as the snapshot columns. A template change six months from now must not alter a document that has already been filed against |

## Consent, retention and DPDP

Made in Q10 while writing `docs/dpdp-compliance.md`. **Everything about the *law* in that
document is provisional on `E20-01`, which has not been done.** What follows is not law — it is
a set of choices about the **machinery** that records and enforces whatever the lawyer says, and
each one is decidable now precisely because it does not depend on the answer. §0 of that
document draws the line between the two.

| # | Decision | Why |
|---|---|---|
| C1 | **Consent is written in the same transaction as the data it authorises — at *both* ends.** Adding a dependent writes the `recipient`, the `guardian_link` and the `consent_record` rows atomically; **removing one writes the `withdrawn` rows in the transaction that sets `deleted_at`** | The first half was already in the schema. The second half is the one that gets missed, and it is not optional: `auth_can_manage_recipient()` requires `recipient.deleted_at is null`, so once a dependent is soft-deleted **nobody can write a consent row about them ever again**. Deferring the withdrawal to a job or a later request means `current_consent` reads `granted` in perpetuity for a child who was removed a year ago — the exact opposite of what the record exists to prove. `E20-16` |
| C2 | **A `consent_purpose` row's meaning is immutable. A purpose that changes — new recipient, new use — is a *new* purpose, and the old consent is marked `superseded`** | Editing the meaning in place silently converts every historical `granted` row into evidence of consent to something the person was never shown. The row is cheap; the re-ask is the entire point of purpose-scoping. A privacy-notice update on its own does **not** invalidate consent — only a change of purpose does |
| C3 | **Withdrawal is a new row, never an update, and application code reads consent only through the `current_consent` view** | The question a regulator asks is "was there consent *on the 14th*", which a flag cannot answer and an event log answers trivially. The view half matters as much: it is `security_invoker`, so it inherits RLS, and hand-rolled "latest row" logic in application code both drifts and escapes the policy |
| C4 | **Policy acceptance and purpose consent are two different gates and are never conflated.** `user_policy_acceptance` is the contract gate (`blocks_ordering`); `consent_record` is the per-purpose processing gate | The two tables look redundant, which is what makes this the most likely mistake in the whole area. Treating "I agree to the Privacy Policy" as authority to store a child's health data is the blanket consent that purpose-scoping exists to stop, and it is one line of code away at all times |
| C5 | **`allergen_health_data` is separately consented and declining it is a supported end state**: no warning, not no service. Withdrawing it deletes every `recipient_allergen` row and `recipient.allergy_note` outright, in the same transaction | It is health data about a minor — the most sensitive thing in the system — so bundling it with the required purposes would make the required consent conditional on giving up something optional, which is the definition of consent that is not free. The deletion is outright rather than anonymised because, unlike an invoice, nothing statutory retains a child's allergy list |
| C6 | **Retention is data, and a personal-data table with no `retention_policy` row is an *alert*, not "keep forever"** | Same instinct as `D17` (RLS enabled with no policies, so the resting state is "nobody can read anything") and `MI3` (every row accounted for). A retention schedule that silently omits a table is indistinguishable from one that covers it until a regulator asks. The purge job therefore asserts coverage and dry-runs before it deletes, with a volume tripwire — a purge that suddenly wants 100× the usual rows is a cutoff-arithmetic bug, and it is unrecoverable once it has run. `E20-19` |
| C7 | **The breach clock starts at the first credible signal, not at confirmation** | The timestamp we will be asked for is when we became *aware*, not when we finished investigating, and the earliest applicable deadline may be six hours (`CERT-In`, §8.4). Waiting for certainty turns a 72-hour obligation into a 20-hour one, and the cost of a false start is one wasted afternoon. Corollary written into the runbook: containment comes first but **evidence preservation is part of containment** — no log deletion, no "cleaning up" |
| C8 | **Every data-subject request becomes a `data_subject_request` row at intake, from every channel — app, email, web form, a phone call taken by Andy** | `ix_data_subject_request_due` is the only thing that makes an approaching statutory deadline visible, and a request that lives in an inbox is invisible to it. Missing a deadline fails silently by construction — nothing errors when a date passes — so it also needs its own alarm (`E20-17`), same reasoning as `PY3` |
| C9 | **The consent record survives erasure**, and its own retention runs from the erasure date rather than from the account's | It is the evidence that holding the data was lawful. Deleting it as part of "delete everything about me" destroys our own defence for the period we *were* entitled to process, and leaves the invoice — which is retained by statute — standing with no recorded basis behind it |

## Release

| # | Decision | Why |
|---|---|---|
| R1 | **Closed beta (~15 users, 2 weeks, real money) → cutover weekend → phased store rollout** | Andy ruled out a long parallel run and a pure big-bang. This gives a small real-money test then all-in, with a halt button. |
| R2 | iOS Phased Release (7 days) + Android staged rollout 5/20/50/100, halted on Sentry error spikes | Native store capability; the "small set then all in" the business wanted. |
| R3 | **Keep Bubble 30 days post-cutover** as break-glass | ~AUD $100. Cheap insurance on a live payments system. |
| R4 | **Ship as an update to the existing apps**, not new listings | Bundle IDs are owned: iOS `com.gracord.graybag`, Android `com.Gracord.Graybag`. Typo in "gracord" is permanent and must not be changed. |
| R5 | Timeline ~3.5–4 months at 20–30 hrs/week | Full scope. Compressible by deferring subscriptions, wallet top-up and offline. |
| R6 | **The cutover freeze begins only after the last weekday order cutoff has passed**, so no `service_date` falls inside the freeze window (Q14, `docs/cutover-runbook.md`) | Makes the freeze a weekend (or holiday-week) event and shrinks the in-flight surface to future-dated paid orders and pending payments, which are *drained on Bubble* rather than migrated mid-flight. The current cities do not serve on weekends, so a weekend freeze contains no service day. `[CO-01]` |
| R7 | **Bubble in-flight payments are not migrated as live state.** They are drained (settle-or-fail on Bubble) before the migration snapshot; anything still pending at snapshot is reconciled by hand against the Razorpay dashboard (Q14) | The new stack's payment state machine must never inherit a half-open attempt it did not create — mirrors `L4` (choose the recoverable failure). `E17-14`, `[CO-03]` |
| R8 | **Every cutover go/no-go gate defaults to roll back, not proceed**, so a single unavailable decision-maker fails safe (Q14) | GrayBag is one person; there is no second signer mid-weekend (`[CO-07]`, next to `[DP-01]`). Rollback-by-default is the compensating control, and rollback triggers are named per phase in the runbook |

## Policy documents

Made in Q11 while drafting `docs/{privacy-policy,terms,refund-policy}.md` as lawyer templates. None
override an existing entry; these are choices about how the three documents are structured. The *law*
in them is provisional on `E20-01`, exactly as with the DPDP machinery — every unresolved value is a
`«…-PENDING-…»` token guarded by `G3`/`E20-22`.

| # | Decision | Why |
|---|---|---|
| PP1 | **The three policies cross-reference rather than duplicate.** Refund detail lives only in `refund-policy.md`; Terms §6 summarises and links; the privacy notice does not restate refund mechanics. The refund policy is declared "part of the Terms" so it is contractually binding | Same instinct as the `api/` module rule (`A4`) and the token source (`S8`): one source per fact, so a change to the cancellation window edits one document, not three |
| PP2 | **Retention numbers in the privacy notice are written as the §6.2 *proposals* with tokens, never as decided values.** The parent-facing table quotes the proposed number in prose ("proposed: 8 years") next to the token | Consistent with `C6` and `[DP-02]`: inventing a number in a published policy would be inventing the law. Quoting the proposal means the lawyer edits a number rather than a blank |
| PP3 | **The allergy disclaimer is stated in both the Terms (§8) and the privacy notice, and flagged as the top launch risk** | A food business serving children that shows allergy warnings has a duty-of-care surface these documents must address head-on. `[PP-03]` BLOCKS launch — the wording is health-and-safety language that must be lawyer-reviewed (`E20-25`) |
| PP4 | **Cross-border wording distinguishes adult data (may leave India via Sentry/Expo/email) from child data (never leaves India by design)** | Mirrors `[DP-05]` and the §5.3 egress rules exactly, so the notice does not over-claim "all your data stays in India" — which would be false for Sentry and Expo, and a false privacy claim is itself a problem |

## Store submission

Made in Q12 while writing `docs/store-submission.md`. Mechanism / presentation choices about the
App Privacy (Apple) and Data Safety (Google) declarations — honest and low-stakes, recorded so they
are not silently reversed at submission time.

| # | Decision | Why |
|---|---|---|
| SUB1 | **The store data-safety declarations are generated from the tier S/P/A model, and the privacy policy is the single source of truth they must match.** If policy and label ever disagree, the policy wins and the label is corrected, never the reverse | Same instinct as the `api/` module rule and the token-source rule: one source, derived outputs. Both stores require the declared collection to match the linked policy exactly, so the reconciliation is mandatory (`E17-19`) |
| SUB2 | **Declare conservatively: broad on "what", narrow on "why".** When a data type could honestly be declared collected or not, declare it collected; when a purpose could be read broadly or narrowly, declare it narrowly | Over-declaring collection is safe (the app looks slightly more data-hungry); under-declaring is a policy violation and a takedown risk. Over-declaring *purpose* (e.g. Analytics on contact data) invites scrutiny we do not need. `[SS-01]`, `[SS-02]` |
| SUB3 | **GrayBag declares NO tracking (Apple ATT) and NO advertising ID** — no cross-app/cross-site tracking, no ad SDK, no advertising identifier, so no ATT prompt is required | s.9 of DPDP forbids profiling a child (dpdp §3.3). Recorded because adding any analytics/attribution SDK later would flip this and require an ATT prompt + a label change — it must be a conscious decision, not a dependency someone quietly adds |

## Secret rotation and testing

Made in Q13 while writing `docs/secret-rotation-policy.md` and `docs/testing-strategy.md`. The
cadence *numbers* and the coverage *number* are open (`[SEC-01]`, `[SEC-02]`, `[TEST-01]`); the
choices below are the mechanisms that hold at any number.

| # | Decision | Why |
|---|---|---|
| SR1 | **Provider secrets are stored only as Supabase Edge Function env vars / project settings, never in a committed `.env`; the service-role key never has a human copy** | The service-role key is the one credential that bypasses RLS (defeats non-negotiable #2). Concentrating it in the Edge Function tier — which the `api/` write rule (`A4`) already mandates — means exactly one place to rotate and one place to leak from |
| SR2 | **Coverage is a hard merge gate, but money and authorization correctness are gated by suite completeness (property tests + the exact-policy-set `set_eq`), not by a coverage percentage** | A percentage can be satisfied without asserting the thing that matters; an exact-policy-set assertion fails when a policy is *added* — the direction that leaks — which no coverage number would catch. `[TEST-01]`, `E01-12` |
| SR3 | **CI proves everything server-side and every signature/idempotency invariant offline; native UPI client behaviour is proven once by the `E19-01` spike, not by CI** | A CI stub cannot validate a native app-switch, and pretending it does hides the `E06-29` `<queries>` failure that only reproduces on a real Android 11+ device. The provider stub is testable but encodes assumptions until `E19-01` corrects it |

## Migrations

Made in `E01-10` while building `scripts/check-migrations.mjs` and writing `docs/migrations.md`.

| # | Decision | Why |
|---|---|---|
| MG1 | **Rollbacks live in `supabase/down/`, a sibling of `supabase/migrations/`, never a subdirectory of it** | The Supabase CLI applies what it finds in the migrations directory. `0001`'s rollback is `drop schema public cascade` — the cost of the CLI ever picking that up as a forward migration is the entire database, so the two are kept in directories that cannot be confused |
| MG2 | **Every migration is reversible or carries `-- irreversible: <reason>`. The reason is mandatory and the checker rejects an empty one** | Irreversibility is a legitimate engineering answer; *silent* irreversibility is not. Requiring a sentence turns "nobody wrote a down migration" into a decision somebody made and signed |
| MG3 | **A rollback containing only comments fails the check** | A `-- TODO` down migration is worse than none: the checker would go green, and it would be trusted exactly once, during an incident, when it silently does nothing |
| MG4 | **Down migrations must never widen access. `0002`'s rollback deliberately leaves the `anon` revokes in place** | Reversing a security tightening in a rollback script is a policy regression in the one file nobody reviews under pressure. It contradicts `[AZ-03]` (`anon` holds exactly zero policies), so the rollback ends at *more* denial than it started, never less. If those grants are ever wanted back it happens in a forward migration with the authorization suite asserting it |
| MG5 | **Versions are four digits, consecutive from `0001`, and permanent — the checker fails on a gap or a duplicate** | A gap means a migration was deleted or a branch renumbered one, and either way the order applied to some database no longer matches the order committed. Catching it at merge is the only cheap moment. Consequence to accept: two branches both adding `0003` is a real merge conflict, and the checker cannot tell you which one is safe to move |
| MG6 | **Migration immutability is documented now and enforced once staging exists, not faked in the meantime** | `0001`/`0002` have never been applied anywhere, so there is nothing to diverge from and a checksum manifest would only add friction to pre-deployment edits. From `E01-04` onward `supabase migration list` compares local versions against the remote `schema_migrations` table, which is a real check rather than a self-referential one |

## Environments and secrets

Made in `E01-07`. The rotation *inventory* and cadence stay in `docs/secret-rotation-policy.md`;
these are the mechanism choices that sit under it.

| # | Decision | Why |
|---|---|---|
| EN1 | **`local` and `staging` share the one Razorpay test account; only production is live** | There is no third Razorpay account to have, so the rule collapses to a single checkable sentence — *staging must never hold a live key* — rather than a matrix nobody remembers |
| EN2 | **The test/live key rule is a load-time assertion in `packages/shared/src/env.ts`, checked in three places: before secrets are sent, at Edge Function boot (`E06-14`), and in the unit suite** | Principle 4 of the rotation policy says test/live isolation is a rotation concern, not just a deploy concern. One check at deploy time would not catch a value changed by another route; one check in tests would not catch a bad value at all. The three together mean there is no path that sets a live key in staging quietly |
| EN3 | **`loadClientEnv()` throws if a server-only secret is merely *present*, not just if it is used** | A client build that can *see* `SUPABASE_SERVICE_ROLE_KEY` is one careless `process.env` reference from shipping the credential that bypasses RLS. Failing on presence turns a code-review question into a build failure. `E01-18` asserts the same property on the built bundle; this asserts it at the source |
| EN4 | **Secrets are written by `npm run secrets:set -- <env>` from a gitignored per-environment file, never through a provider dashboard** | Hand-editing is how the legacy app ended up with a live key in an export. A dashboard has no validation, no record of what changed, and no way to tell afterwards whether staging and production diverged. The script validates before a single value leaves the machine |
| EN5 | **The secrets file must name its own environment, and the script refuses if it disagrees with the command line** | `secrets:set -- staging` pointed at a file of production values is one typo, and it is the typo that moves real money. The file declaring `APP_ENV` makes the two halves check each other |

## CI

Made in `E01-08` while building `.github/workflows/ci.yml` and `integration.yml`.

| # | Decision | Why |
|---|---|---|
| CI1 | **The PR gate is the smoke test only — typecheck, lint, migration rules, unit tests. Anything needing a real Postgres runs in a separate workflow** | CLAUDE.md's testing rhythm is explicit: ~60s on every push, the full suite overnight. A Supabase stack takes minutes to come up, and paying that on every commit is how a team learns to work around CI. Locally the smoke test runs in 6s. **Note this resolves a conflict**: `E01-08`'s own wording asks for "integration tests against a seeded ephemeral DB" in the CI pipeline, which the newer CLAUDE.md rhythm contradicts. CLAUDE.md wins; the integration job exists, it is just not the per-push gate |
| CI2 | **The integration workflow also runs on any PR touching `supabase/**`, not only nightly** | A schema change is exactly the change the smoke test cannot judge. Running it on the PRs that could break it, rather than discovering it eight hours later, costs a few minutes on a small fraction of PRs |
| CI3 | **The Supabase CLI is a devDependency, not `supabase/setup-cli`** | One pinned version for CI and laptops both. A migration that replays in CI and not on a developer's machine — or the reverse — is a debugging session with no useful outcome |
| CI4 | **The smoke test includes `node scripts/build-backlog.mjs`** | The build fails on a malformed epic file, and a missing `## Tasks` heading otherwise silently drops a whole section from the dashboard Andy works from. It costs about a second |

## Seed data

Made in `E01-13` while writing `supabase/seed.sql`.

| # | Decision | Why |
|---|---|---|
| SD1 | **Fixture ids are fixed, readable UUIDs (`cc000000-…` kitchen, `50000000-…` school, …), never `gen_random_uuid()`** | Tests reference these rows directly, and a random fixture forces every assertion to look the row up by name first. The prefix means a failing test's output says what kind of row it was. Constraint learned the hard way: the prefix must be **hex** — `k1000000-…` is not a valid uuid |
| SD2 | **The seed stops at reference data and people. It creates no orders, payments, invoices or ledger entries** | Those have state machines and money invariants. A fixture that fakes one by direct insert teaches tests to expect a state the application itself can never produce, and the first real bug it hides is a ledger that does not balance. They arrive with the code that creates them (E05, E06, E07) |
| SD3 | **The fixture set is chosen for the states that are otherwise untestable, not for realism** — a guardian who may view but not order, a draft menu assigned to nothing, a migrated account never claimed, an adult ordering for themselves, an allergy that genuinely collides with a dish on that school's menu | Each of these is a paragraph in `docs/open-questions.md` ([AZ-05], [DM-11], [DM-08]) that would otherwise never be exercised. `supabase/tests/seed.test.sql` asserts each one, so the fixture cannot quietly stop covering it |
| SD4 | **`price_is_tax_inclusive` is left NULL in the seed** | `[DM-20]` is open. A fixture that picks a value is a guess about money that propagates into every invoice any test ever asserts, and it would look like a decision. The seed test asserts it stays null |
| SD5 | **The allergen table is seeded with four codes, not the twelve in the data model** | `[DM-13]` is open and `[MI-01]` says the source workbook is not in the repository, so there is no real allergen list to seed. Four codes make the JOINs work without the fixture masquerading as an answer |

## Deployment

Made in `E01-14`.

| # | Decision | Why |
|---|---|---|
| DP1 | **The production approval gate is a GitHub Environment required-reviewer rule, not a step in the workflow** | An environment rule pauses the job before any step runs *and* before the environment's secrets are exposed to it. A gate written as a workflow step can be edited away by the very pull request it is meant to guard; repository configuration cannot |
| DP2 | **staging deploys only from `main`, production only from `v*` tags — enforced by deployment branch policies, not convention** | `workflow_dispatch` would otherwise let anyone run the production workflow against any ref. The policy makes the ref restriction part of the environment rather than something the workflow has to remember to check |
| DP3 | **Deploy concurrency queues (`cancel-in-progress: false`) rather than cancelling** | `db push` applies migrations in order. Two runs interleaving against one database is a corrupted migration history repaired by hand, and a cancelled half-applied deploy is worse than a slow one |
| DP4 | **Production re-runs the full smoke test; staging does not** | A tag can be moved, and it can be cut from a commit that never had a CI run of its own. Trusting "it was green on main" is trusting something that may never have been true for that exact tree |
| DP5 | **The repository is PUBLIC** | Andy's decision, taken with the exposure stated: branch protection and environment approval rules are unavailable on free-plan private repositories, and the alternative was $4/month or losing both controls. Recorded because it is not a neutral choice — the published history permanently contains ten weights of **VAG Rounded Next**, a commercial typeface whose licence has never been checked (`E19-03`, `[DS-02]`), and `docs/authorization-model.md` + `docs/legacy-bubble-schema.md`, which map a legacy system that today exposes every order and every child's allergies publicly. Going private later does not retract clones, forks or search indexes. **Revisit `E19-03` with urgency, and treat the legacy exposure as one more reason to finish the migration** |

## Branch protection

Made in `E01-02`.

| # | Decision | Why |
|---|---|---|
| BP1 | **A repository ruleset with `bypass_actors: []` — the rule binds repository admins too** | Non-negotiable #6 is that nothing merges without the smoke test green, with no override path *including for a one-line change*. A rule the owner can walk past is a preference, not a control, and the one-line change at 11pm is exactly when it gets walked past |
| BP2 | **Pull request required, but `required_approving_review_count: 0`** | GitHub does not allow approving your own pull request, and Andy is the only developer — requiring one approval would block every merge permanently. Zero still forces the *pull request*, which is what gives the status check something to run against and what produces a reviewable diff. Raise it to 1 the day there is a second developer |
| BP3 | **`strict_required_status_checks_policy: true` — a branch must be up to date with `main` before it can merge** | Otherwise the check that passed is a check for a tree that never existed on `main`. Costs a rebase on a busy repo; this one is not busy |
| BP4 | **The required check is named `Smoke test`, matching the `name:` of the job in `ci.yml`** | The coupling is invisible and silent: rename the job and the gate waits forever for a check that will never report, which looks like a hung PR rather than a broken rule. Renaming one means renaming both in the same commit |

## Scope confirmations — 2026-08-07

Two questions that had been open since the plan was written, answered by Andy in conversation
and now binding. Both were previously carried as "assumed" in `docs/open-questions.md`; those
entries are struck and point here.

| # | Decision | Why |
|---|---|---|
| SC1 | **Mohali only for v1. Confirmed 2026-08-07** — one city, one state. GST is a flat 5% shown as CGST 2.5% + SGST 2.5%, `gst_state_code` 03 (Punjab) everywhere. **No IGST, no place-of-supply derivation, no multi-state logic is to be built** | The kitchen is in the same state as every school served, so intra-state supply is the only case that can arise. Chandigarh (UT) and Panchkula (Haryana) are different state codes and would drag in IGST and possibly extra registrations; they are a fast-follow once live. This was already the working assumption — confirming it means the code may now *rely* on it rather than leaving room for a second state |
| SC2 | **Menu prices are GST-EXCLUSIVE. Confirmed 2026-08-07** — the stored `price_paise` is the taxable value, and 5% is added on top at checkout, matching what the Bubble cart does today. `platform_config.price_is_tax_inclusive = false` | Closes `[DM-14]` / `[DM-20]`, and takes option (a) of `[GST-01]` — **the cheap answer**. The inclusive path would have required relaxing `order_line`'s `check (line_subtotal_paise = unit_price_paise * quantity)`, because deriving a per-unit taxable value from a tax-inclusive price multiplies the rounding error by the quantity: four ₹99.00 tax-inclusive dishes come to ₹396.02, not ₹396.00, and no arrangement of integers fixes it while that constraint holds. Exclusive pricing makes the constraint true by construction and leaves `invoice.round_off_paise` at zero |

**Consequence to carry out, not yet done at the time of writing:** `platform_config.price_is_tax_inclusive` is still `NULL` in `0001`, which was deliberate — `[DM-20]` chose "nullable and unset so tax calculation refuses to run until answered" precisely so that this moment would be explicit. `0001` is already applied to staging and must not be edited (`MG5`), so the value is set by a new migration and the column made `NOT NULL`. Tracked under `E02-06`.

## Authorization fixes found by running the suite

Made in `E02-08` / `E02-09`, on the first execution of `supabase/tests/authorization.test.sql`.

| # | Decision | Why |
|---|---|---|
| AZ8 | **Fulfilment access to `recipient_allergen` is bound to `kitchen` or `school` scope, never `platform`** (`0004`, `auth_recipient_has_fulfilment_order`) | `auth_has_permission` treats a platform-scope grant as satisfying any scope check, so `platform_admin`'s `orders.view_pii` opened the kitchen fulfilment policy on every child who had ever ordered — contradicting §7.2's stated model and non-negotiable #4. Fulfilment happens at a kitchen; it never happens at the platform, so the policy now says that positively rather than inheriting scope widening |
| AZ9 | **`auth_recipient_has_visible_order` is left unchanged and the new function sits beside it** | The old function is still correct for `recipient` itself, which is tier P (name, class, section) and where platform-admin access *is* intended. Narrowing it globally would have removed access the model deliberately grants — the fix belongs at the one policy whose data class demands it |
| AZ10 | **The allowed scopes are enumerated positively (`school`, `kitchen`) rather than excluding `platform`** | `city` is not reachable today because `0001` restricts `orders.view_pii` to `{platform,kitchen,school}`. An exclusion list would silently admit `city` the day that restriction changes; an inclusion list fails closed |

## The legacy design package is not in git — 2026-08-08

`Legacy-Application/` was removed from all 66 commits with `git filter-repo` on 2026-08-08,
before the repository had ever been pushed. Nothing was published, there were no
collaborators and no remote history, so this was the cheapest possible moment to do it —
every commit SHA below the root changed, which is only harmless because nobody had a clone.

**The assets are not lost.** They live at `../Legacy-Application-backup/` — a sibling of this
repository, `/Volumes/Data/AD/Projects/Claude/Code/GrayBag/Legacy-Application-backup`, 63
files, 46 MB, copied and verified byte-for-byte before the rewrite. `Legacy-Application/` is
now in `.gitignore`, so the directory can be copied back into the working tree whenever a
task needs it (`planning/OVERNIGHT.md` step 3 does exactly that) without any risk of it being
committed again.

| # | Decision | Why |
|---|---|---|
| RH1 | **The 46 MB design package is kept outside git rather than in it** | Git stores a new full copy of every binary on every change and can diff none of it. The package is a 21.8 MB brand-guidelines PDF, `.ai` and `.pptx` sources, patterns and nine UI mocks — none of which git adds any value to holding. It inflated the packed repository from under 1 MB to 36 MB, which is a permanent tax on every clone and every CI checkout, forever, for files that change perhaps twice a year and are read by humans, not by the build |
| RH2 | **The licensed fonts are the harder half of the reason** | Ten `VAG-Rounded-Next-*.ttf` files were committed. A git repository is a redistribution channel, and the licence has never been checked (`E13-14`, `owner:andy`, still open). Keeping the binaries in history meant the answer to "may we redistribute this typeface?" was already "we have been". Outside git, the licence question stays a question about *use*, which is the answer-able one, and the repo can go public without that being a decision nobody made |
| RH3 | **`filter-repo` over `git rm`** | `git rm` in a new commit leaves every byte in history, so clone cost and the redistribution point both stand. Only rewriting removes them. The root commit `b5805b7` never contained the package, so its SHA survived the rewrite and the branch remained a clean fast-forward onto the unborn `origin/main` |
| RH4 | **A verified byte-for-byte copy and a full `--all` bundle were taken first** | `filter-repo` deletes the stripped paths from the working tree as well as from history — without the copy the assets would have been gone from disk the moment it ran. `../graybag-pre-rewrite.bundle` (36 MB, `git bundle verify` clean) holds the entire pre-rewrite history including the five merged agent worktree branches, so the rewrite is reversible in full |

**One caution.** `../Legacy-Application-backup/` contains `Legacy-DB/gray-bag-23660.bubble`,
the Bubble export with live secrets. It was never committed — `*.bubble` has always been
gitignored — and it must not be moved into this or any other repository. Non-negotiable #5.

## The privilege baseline is stated, not inherited — 2026-08-08

`0005_explicit_table_privileges.sql`, closing `E02-25` and the implementation half of
`E02-21`. §10 of `docs/authorization-model.md` has always opened by asserting that *Supabase's
default privileges give `anon` and `authenticated` SELECT/INSERT/UPDATE/DELETE on new tables in
`public`, and RLS is what actually stops them*. That is true on a hosted project and false on
the local CLI stack, so `0001` and `0002` were revoking from a baseline they never established
— three layers of REVOKE and not one GRANT.

| # | Decision | Why |
|---|---|---|
| PB1 | **The GRANT is written down in a migration rather than inherited from the platform** | The suite could not mean the same thing in CI and in production, so a green run in CI was not evidence about what ships. That is the same class of false confidence as `E02-24`'s `Tests: 0`, one layer down: not a test that did not run, but a test that ran against a different security model. A privilege model half of which lives in a vendor default is not reviewable, not diffable, and not testable |
| PB2 | **Grant broadly, then re-apply `0001`'s and `0002`'s revokes, rather than granting a computed positive list** | The positive list is "every table except these 37, and except UPDATE/DELETE on these 6" — a second copy of a list `0002` already owns and that the suite asserts against. Two copies drift, and the drift direction is *opening writes*. Both copied lists were verified identical to their originals before merge (37 class-3, 6 append-only) |
| PB3 | **`service_role` gets the baseline and no revokes at all** | It is the only writer of every class-3 table, so revoking there would break the plane the model routes all writes through. On the six append-only tables it deliberately keeps UPDATE and DELETE **privileges**, because §9 item 14 requires the *trigger* to be what refuses them. The distinction is not cosmetic: the suite caught `42501 permission denied` where it wanted `23001`, i.e. append-only enforcement appearing to work for the wrong reason. A trigger states immutability once for every caller; a revoke exempts anyone who acquires the privilege by another route |
| PB4 | **`anon` is granted nothing and the revoke is re-asserted anyway** | The grants name `authenticated` and `service_role` only, so anon is untouched by construction — but "untouched by construction" is an argument, and `[AZ-03]` is not a thing to hold by argument. The statement is free |
| PB5 | **Default privileges are set too, so later migrations inherit the baseline** | Without it, migration `0006` creates a table nobody can read, and that surfaces as an empty screen rather than an error — the worst way to find out |

**The rollback is asymmetric and says so.** On a hosted project `0005`'s down migration also
removes the platform's own grant, because Postgres does not record who granted what. The end
state is therefore not the pre-`0005` state; it is an app returning permission denied for every
read, and a backend that cannot write. `0001` and `0002`'s revokes are deliberately not undone:
rolling back a baseline must never re-open a class-3 write.

## What the real Bubble export changed — 2026-08-08

`E19-04`, the export dry run. Full evidence in `docs/bubble-recon-findings.md`; the export folder
itself is deleted after review and was never copied into the repo. Six of `E16`'s known constraints
were written from the schema and turned out to be wrong about the data. These are the choices made
in response, and the reasoning that must not be re-litigated silently.

| # | Decision | Why |
|---|---|---|
| BR1 | **Email is the sole migration key, and that is now settled rather than preferred** | `User.mobile` is empty on all 404 rows — not lossy, absent. `U1`/`E03-16` had already chosen email because the legacy `number` field was an account-takeover vector; the export removes the fallback entirely, so there is no longer a decision to revisit under pressure at cutover. Email itself is sound: 404/404 present, 404 distinct, 404 valid, zero duplicates, zero placeholders |
| BR2 | **The parent↔child relationship is re-extracted from Bubble, never reconstructed by name matching** | The CSV export drops list-of-thing fields, so `Child.Parent` is empty on all 1,115 rows and `User.child` survives only as comma-joined *display names* — 48 of 376 references ambiguous, 33% of children reachable at all. Name matching at a 12.8% ambiguity rate, on data about minors, fails in exactly the direction non-negotiable #2 exists to prevent: showing one parent another family's child. A 90%-correct link is worse than no link, because no link is visible and a wrong link is not. `E16-21` gets the ids out properly instead |
| BR3 | **The 78 `Draft` orders are not migrated in any status** | They are abandoned carts: none has a payment id, 45 have no order date and no break. `E16-19` already forbids producing `draft` rows (unreachable for the `system` actor, trips I12). The tempting alternative — `pending_payment` — would manufacture 78 fake open orders that the nightly sweeper expires on day one, turning a data-quality artefact into user-visible noise and a false ₹14,558 in the funnel |
| BR4 | **Migrate on the option *label*, not the db_value — the opposite of what `E16` said** | The constraint "map on db_value, not label" was correct about Bubble's internals and useless in practice: **the CSV export emits labels only**. This inverts two constraints at once. For breaks it is good news — the labels are self-consistent with the `Break-Timings` rows, so the `10__00_am`-renders-as-"10:40AM" contradiction cannot reach us and `E16-15` shrinks to an assertion. For roles it is bad news — `School Staff` is ambiguous between the `staff` and `teacher` db values, which carry different grants, so `E16-20` must resolve it from the editor before `E16-02` |
| BR5 | **Accounts on mistyped domains migrate as-is and are contacted, not corrected** | 12 users sit on domains like `ais.amity.eduh` and `gmail.coma`. Auto-correcting to the obvious intended domain would silently reassign an account — including two with order history — to an address its owner never entered, which is an account-takeover by typo-fix. They migrate unchanged and become the pre-cutover contact list (`E16-23`), replacing the phone-based list `E16-12` was going to produce |
| BR6 | **Dish images are mirrored now, not at cutover** | 82 of 85 resolve today and die with the Bubble app; the whole set is ~2.0 MB. Carrying a live external dependency into the cutover window buys nothing and can only get worse. The 3 that already return a permanent 403 are a content decision (`E16-29`), not a migration failure |
| BR7 | **`Dish_In_Order.special-comments` is reclassified as regulated data** | 127 rows of free text attached to a named child, 15 containing dietary or allergy language. Nobody classified it, because the field the DPDP work guards — `Child.allergies` — turned out to be empty on all 1,115 rows. The sensitive data was in the field nobody was watching. Non-negotiable #4 applies to it (`E16-24`) |

**One thing the data confirmed rather than changed.** `order-total ÷ Σ line_total` is exactly
**1.05** on 280 of 282 non-draft orders. The `docs/mvp-scope.md` fact that menu prices are
GST-exclusive and 5% is added at checkout is not just Andy's recollection — it is measurable to the
paise in fourteen months of production orders. Every total also converts to whole paise with no
float artefact, so non-negotiable #3 costs nothing here.

## Andy's rulings on the recon findings — 2026-08-08

Taken after reading `docs/bubble-recon-findings.md`. These close three of the questions that
document opened and replace its top-ranked risk with a different one.

| # | Decision | Why |
|---|---|---|
| AR1 | **Parent↔child is derived from `Order` (`order-parent` + `child`), not from `Child.Parent`** | `Child.Parent` was never used, so its emptiness in the export is not export damage — it is the accurate state. `BR2`'s worry was about reconstructing a link that was assumed to exist; there is nothing to reconstruct. **A child nobody has ordered for has no parent, and that is correct data, not missing data.** This also inverts the earlier framing: `User.child` (376 name references, 48 ambiguous) is no longer the recovery path and should not be used as one — the order is the evidence of the relationship |
| AR2 | **Dependents are created *from* orders rather than matched *to* the roster** | Follows from AR1 and removes the name-ambiguity problem entirely at the point that matters. Each distinct (`order-parent`, `child` name, `school`) triple becomes a dependent with a definite parent. Identity ambiguity only bites if we try to reconcile those against the 1,010-row school roster, which is a separate decision (`E16-37`) and must not happen automatically. **Measured:** 146 distinct child names appear on orders, yielding 131 dependents with an unambiguous parent; 15 names remain ambiguous even after narrowing by school, and 6 names are ordered for by more than one parent email. Those 21 are reported, not guessed — mother and father both ordering for one child is indistinguishable from two same-named children at one school |
| AR3 | **Roles are binary: back-office or not** | Legacy `parent`, `teacher`, `staff` and `collegestudent` all map to **Customer**; only `admin` and `kitchen` receive back-office grants. This dissolves `E16-20` without needing the Bubble editor — the `School Staff` label was ambiguous between the `staff` and `teacher` db values, and under a binary model both land in the same place, so the ambiguity stops mattering. Unblocks `E16-02` |
| AR4 | **Email verification needs no new work** | Google Sign-In verifies the address as part of the flow, and an email OTP cannot succeed on an address the user cannot read. Verification is a property of the two auth mechanisms `U1` already chose, not a step to add. No task, and the open question is closed |
| AR5 | **The migration key is moving underneath us — this now outranks the typo domains** | Amity International School, which is 95% of children and 95% of orders, is moving everyone to a new email domain over the coming weeks, and the old accounts may be deleted. Email is the migration key (`BR1`), so **a dump taken today keys the migration to addresses that will not exist at cutover.** This is a different class of problem from the 12 mistyped domains (`BR5`), which are 12 static rows: this one silently invalidates up to 154 Amity accounts, and it gets worse the longer the gap between export and cutover. The mitigation is procedural, not code — **re-export close to cutover and reconcile changed addresses** (`E16-41`). The 12 typos drop to secondary |
| AR6 | **Mirror the dish images now, not as cutover work** | Confirms `BR6` and moves it out of the migration block. 82 of 85 resolve today and die with the Bubble app; there is no version of waiting that improves the odds |
| AR7 | **Signup-to-first-order conversion is a primary v1 goal, not a quality attribute** | Named in `docs/mvp-scope.md` and in `CLAUDE.md` as a standing constraint, so it constrains task design rather than being remembered at review time. The legacy app's funnel is the thing being replaced; shipping a technically-correct app with a worse first-run experience would waste the migration. Any task that adds a step between opening the app and paying for a first order now needs an explicit justification |
