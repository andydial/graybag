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
| U1 | **Phone + OTP** primary for app users; email/password for back-office only | Firebase Phone Auth does not support India. India norm, no passwords to forget. ~Rs 0.15/OTP; at ~4 logins/user/year this is ~Rs 1,000/month at 20k users. |
| U2 | **No password migration** | Bubble cannot export password hashes — a hard limitation. Everyone re-authenticates once regardless, so switching to OTP costs nothing extra. |
| U3 | Long-lived refresh tokens (90–180 days) + Android SMS Retriever | Keeps OTP volume (and cost) low and removes typing. |

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

## Release

| # | Decision | Why |
|---|---|---|
| R1 | **Closed beta (~15 users, 2 weeks, real money) → cutover weekend → phased store rollout** | Andy ruled out a long parallel run and a pure big-bang. This gives a small real-money test then all-in, with a halt button. |
| R2 | iOS Phased Release (7 days) + Android staged rollout 5/20/50/100, halted on Sentry error spikes | Native store capability; the "small set then all in" the business wanted. |
| R3 | **Keep Bubble 30 days post-cutover** as break-glass | ~AUD $100. Cheap insurance on a live payments system. |
| R4 | **Ship as an update to the existing apps**, not new listings | Bundle IDs are owned: iOS `com.gracord.graybag`, Android `com.Gracord.Graybag`. Typo in "gracord" is permanent and must not be changed. |
| R5 | Timeline ~3.5–4 months at 20–30 hrs/week | Full scope. Compressible by deferring subscriptions, wallet top-up and offline. |
