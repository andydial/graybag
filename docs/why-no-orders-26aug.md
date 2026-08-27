# Why 8 post-launch accounts produced zero orders — 2026-08-26

Andy, 2026-08-26: *"I need to know whether nobody has tried, or people have tried and something
broke silently."*

**Answer: nobody has tried.** Read-only investigation, no rows written.

## The decisive number

**Zero `idempotency_key` rows in five days.** One is written on every checkout attempt, before
payment, so a checkout that failed anywhere downstream would still leave one. Most recent: 19
August. Nobody has pressed Place order.

## The funnel

| Stage | Count |
|---|---|
| Signed up | 13 |
| Added a child | 10 |
| Reached checkout | 3 |
| Paid | 1 |

| Signed up | Accounts | Ever checked out |
|---|---|---|
| 15–19 Aug (pre-launch) | 5 | 3 |
| **22–25 Aug (post-launch)** | **8** | **0** |

All three checkouts and the single payment are the India team, before launch.

## Silent-break hypotheses, each ruled out

- **Menu invisible when signed in** (`E02-33`, the launch blocker) — evaluated the browse
  policies against **all 13 real accounts**: every one sees 3 schools, 83 menu items, 6 break
  windows. `0061` is applied on production.
- **Nothing to buy** — Amity, where all 13 live children are, has 47 active items, all priced,
  available Mon–Sat.
- **Ordering window closed** — cutoff 00:00, 0 days before, 0–14 days advance, all 7 service days.
- **Force-update lockout** — `min_supported_app_version` is `0.0.0`.
- **Children not linked** — 10 parents have a child correctly linked to a school. (`school_class`
  is empty and `school_class_id` is null on every recipient, which is **by design**: `DM-08` uses
  free-text `class_label`, and the link that matters is `recipient.school_id`.)
- **Payments failing** — 4 Razorpay orders created but never captured, all 18–19 Aug, **zero in
  the last five days**.

## What was found on the acquisition side

- **`graybag.in` has no A record** (`E17-60`). The Netlify host resolves and serves 200 on the
  site, `/signin` and `/kitchen`; the real domain resolves to nothing. It is the Marketing URL
  and Support URL on both store listings. This is the one concrete, fixable cause found.
- An `endpoint_down` alert fired 25 Aug 04:26 UTC — site, admin sign-in and kitchen board all
  503, consistent with a failed Netlify deploy. All three are 200 now.

## The honest limit

Nobody *reached checkout* is proven. What happened before that is not, because a client-side
failure — menu not loading, a crash, giving up at the cart — writes nothing to the server. That
gap is what `E15-21` closes, shipped today as `bd787fc9`. PostHog cannot fill it retrospectively:
only one device appears in it, because the emitters shipped on 25 August and only devices that
took that update send anything.
