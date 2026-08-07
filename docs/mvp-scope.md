---
title: MVP scope
status: agreed 2026-08-07
---

# MVP scope — ship parity, then iterate

## The decision

Ship a **v1 that matches what GrayBag does in production today**, plus the small set of
things that would be negligent to rebuild badly. Everything else becomes a fast-follow
release. The backlog grows on every review pass; without a line drawn, there is no launch.

Target: **6–8 weeks** at 20–30 hrs/week, versus 3.5–4 months for the full backlog.

## What "parity" is

Production today does: login, browse a menu by category, add a child, order for that child,
pay via Razorpay, get a confirmation email, see order history — and a web admin where
kitchen staff filter orders by school and date, mark them shipped, and issue refunds.
Plus the marketing site.

## What ships despite not being parity — and why

| | Why it cannot wait |
|---|---|
| **Authorization / RLS** | Today every order and every child's allergies are world-readable. Rebuilding that would be indefensible |
| **Payment correctness** — signature verification, idempotency, reconciliation | Real money, and the current webhook has no server-side verification |
| **GST invoices** | You already charge 5%. Invoicing it properly is a legal obligation, not a feature |
| **Basic DPDP consent** | Children's data. Cheap now, painful to retrofit |
| **Ledger** (no visible wallet) | ~2 days now; genuinely painful to add after money has moved |
| **UI/UX + performance** | This is the *entire reason* for migrating. Shipping the old experience on a new stack wastes the quarter |

## Deferred to fast-follow

| Deferred | Note |
|---|---|
| All **push notifications** | Biggest single cut. Prod has none today. The 9pm cutoff reminder is probably revenue-positive — strong candidate for the *first* fast-follow |
| **School monthly PDF reports** (all of E11) | Not in prod. Sell the partnership manually until it matters |
| **Revenue-share / payout reports** | Stays a spreadsheet, as today |
| **Kitchen production & packing aggregates** | The kitchen copes without them now. Likely the first thing they ask for as volume climbs |
| **4-digit pickup codes** | Ships with the aggregates |
| **Wallet balance at checkout, refund-to-wallet** | Refund to source for v1. The ledger underneath still ships |
| **Allergen blocking warnings** | Import the allergen tags in v1 (data already exists); defer the add-to-cart blocking logic |
| **Offline reads** | Menu cache still ships — that is the performance win. Full offline browsing is the extra |
| **Load testing, product analytics, cost monitoring** | Sentry, uptime alerts and rate limiting still ship |
| **Audit log, metrics dashboard, view-as-user** | Operationally nice, not launch-blocking |
| **Automated retention purge** | The retention *policy* ships; the cron does not |
| **Subscriptions, cash top-up, capacity limits, delivery role, WhatsApp** | Already deferred (E18) |

## Decisions revised — merge these into `docs/decisions.md`

### U1 — REVISED. Auth is Google / Apple / email OTP, not phone OTP

**Was:** phone + OTP as primary, via an Indian SMS provider with DLT registration.

**Now:**

| Method | For |
|---|---|
| **Google Sign-In** | Primary. One tap, no code to type on a bad connection |
| **Sign in with Apple** | iOS — required by Apple once Google is offered |
| **Email OTP** (Supabase `signInWithOtp`) | Non-Gmail addresses and anyone who prefers it |

No passwords anywhere — nothing to forget, leak, or build a reset flow for.

**Why:**

1. **DLT registration has weeks of lead time** and was on the critical path to launch. Google/Apple/email have none.
2. **Cheaper** — no ₹0.15 per login, no SMS provider account.
3. **Less friction, not more.** The audience is Android-heavy; those devices already have a Google account signed in.
4. **It fixes a migration risk.** `E03-11` matched legacy users on mobile number, but the legacy `mobile` field is a *number* type that has already lost leading zeros and `+91` — an account-takeover vector. Bubble **does** export email, so email matching is unambiguous. That whole class of problem disappears.
5. The email work is **shared, not extra** — SPF/DKIM/DMARC on graybag.com is already required for GST invoices (`E07-05`).

**Consequences:**

- Phone OTP becomes a fast-follow *addition*, not a replacement.
- Mobile number stays as a **profile field** — the kitchen needs it for contact and last-4 search — just not as a login credential.
- **DLT registration continues** (`E00-06`…`E00-09`). It leaves the critical path but stays useful for future order-update SMS.
- `E07-05` (sender domain setup) is now **critical** — it gates login, not just invoices.

### Sender identity

- **From:** `GrayBag <orders@graybag.com>` — confirmations, invoices, OTP
- **Reply-To:** `support@graybag.com` — parents will reply; it must reach a human
- No `no-reply@` addresses
- Only **one** SPF record on the domain — add to the existing Google Workspace record, never create a second. Two SPF records fail silently and are the commonest cause of mail landing in spam
- DMARC starts at `p=none`, tighten to `p=quarantine` after two weeks of reports

## E03 task changes to apply

Mark non-MVP (keep, do not delete — they return in fast-follow):
`E03-01`, `E03-02`, `E03-03`, `E03-04`, `E03-10`

Add to `planning/backlog/E03-identity-and-auth.md`:

```
- [ ] `E03-12` (risk:high) (mvp) Google Sign-In via Supabase Auth on mobile and web
- [ ] `E03-13` (risk:high) (mvp) Sign in with Apple on iOS — required by Apple once Google is offered
- [ ] `E03-14` (risk:high) (mvp) Email OTP via Supabase `signInWithOtp` for non-Google addresses
- [ ] `E03-15` (mvp) Account linking — the same email arriving via Google and via email OTP must resolve to one account, never two
- [ ] `E03-16` (risk:critical) (mvp) Migrate the ~400 existing users by **email** match, not phone. Report any duplicate or missing emails before cutover
- [ ] `E03-17` (mvp) Collect mobile number as a profile field (kitchen contact, last-4 search) — not a login credential
```

## How MVP is tracked

Tasks carry an `(mvp)` marker. `scripts/tag-mvp.mjs` applies it from the rules in that file;
the dashboard gains an MVP filter and an "MVP open" count.

**New tasks default to MVP** — deliberately. It is safer to see something and cut it than to
have it silently vanish from the launch list. Re-run `node scripts/tag-mvp.mjs` after any
batch of new tasks and it reports what it tagged.
