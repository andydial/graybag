---
id: E08
title: Notifications — Push & Email
phase: 5
risk: medium
status: not-started
depends_on: [E05, E06]
summary: Push and email as primary, with a narrow SMS fallback. No WhatsApp for now.
---

## Tasks

- [ ] `E08-01` Push infrastructure (Expo Push / FCM + APNs), token registration and refresh
- [ ] `E08-02` Push permission prompt at the right moment (after first successful order, not on launch)
- [ ] `E08-03` Order confirmed — push + email with pickup code
- [ ] `E08-04` Order preparing / out for delivery — push
- [ ] `E08-05` Order delivered — push
- [ ] `E08-06` Order cancelled or refunded — push + email
- [ ] `E08-07` **Cutoff reminder** at ~9pm to users who have ordered before but not for tomorrow (likely revenue-positive)
- [ ] `E08-08` Menu updated notification (rare; also triggers cache refresh)
- [ ] `E08-09` Notification preferences screen; unsubscribe honoured
- [ ] `E08-10` Transactional email templates matching brand (order confirmation, invoice, refund, cutoff reminder)
- [ ] `E08-11` Email deliverability: warm the domain, monitor bounces
- [ ] `E08-12` Groundwork for promotional/offer pushes later (segmentation, opt-out) — not shipped in v1
- [ ] `E08-13` (risk:medium) **SMS fallback** for users with no app installed or push disabled — order confirmation and pickup code only. Uses the DLT templates registered in `E00-08`, which otherwise have no consumer
- [ ] `E08-14` Decide per-template whether SMS is worth the cost, and cut unused DLT templates rather than leaving them dormant
