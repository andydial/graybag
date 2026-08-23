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
- [ ] `E08-03` (mvp) Order confirmed — push + email with pickup code
- [ ] `E08-04` Order preparing / out for delivery — push
- [ ] `E08-05` Order delivered — push
- [ ] `E08-06` (mvp) Order cancelled or refunded — push + email
- [ ] `E08-07` **Cutoff reminder** at ~9pm to users who have ordered before but not for tomorrow (likely revenue-positive)
- [ ] `E08-08` Menu updated notification (rare; also triggers cache refresh)
- [ ] `E08-09` Notification preferences screen; unsubscribe honoured
- [ ] `E08-10` (mvp) Transactional email templates matching brand (order confirmation, invoice, refund, cutoff reminder)
- [ ] `E08-11` (mvp) Email deliverability: warm the domain, monitor bounces
- [x] `E08-12` Groundwork for promotional/offer pushes later (segmentation, opt-out) — not shipped in v1
- [ ] `E08-13` (risk:medium) **SMS fallback** for users with no app installed or push disabled — order confirmation and pickup code only. Uses the DLT templates registered in `E00-08`, which otherwise have no consumer
- [x] `E08-14` Decide per-template whether SMS is worth the cost, and cut unused DLT templates rather than leaving them dormant
- [x] `E08-16` **Order alerts, with the recipient list in the admin UI.** Andy: *"Recipients are configured in the admin UI, not in environment variables. Per kitchen, not global… Each recipient has an on/off toggle that stops alerts without deleting the address."* `/admin/alerts`, one block per kitchen. `0066` adds `kitchen_alert_recipient` (read policy only — writes go through `admin-alert-recipients`, `A4`) and `order.staff_alert_sent_at`. **The toggle is a column, not a delete**, for the same reason `permission_grant.revoked_at` is: "pause my alerts" and "this person has left" are different acts and collapsing them loses the address. **No child name, class or section is in the email** — the alert's column list omits them entirely, the same technique as `REPORT_ORDER_COLUMNS`, so it is the control rather than a template that remembers not to print something. Carries the order code, school, break, service date, items with quantities, total incl. GST, and **"order 14 of today"**, counted per kitchen for that service date *after* the claim so the order counts itself. Dedupe is a **conditional update** on `staff_alert_sent_at` rather than `notification_delivery` — that table's `user_id` is `NOT NULL` and sits in the DPDP erasure story, which is exactly why `0056` gave ops alerts their own home. A failed send **releases** the claim, and a kitchen with nobody switched on leaves the order unclaimed, so switching somebody on does not silently skip the orders that arrived while the list was empty. **`kitchen.edit`, not `kitchen.config_edit`:** the catalogue pins `config_edit` to `{platform}` and a trigger enforces it, so it cannot express "this kitchen's manager" — found on staging by the grant being refused. Verified end to end on staging: add, duplicate → 409, bad address → 422, unauthenticated → 401, **a kitchen the caller has no grant on → 403**, RLS read scoped to the caller's kitchen, no session → default deny, the alert fires and Resend accepts it, three further polls send nothing, and all-recipients-off leaves the order retryable
- [ ] `E08-17` **A daily digest as an alternative to per-order alerts.** Andy: *"if fifty orders land in a morning I want fifty emails to be a choice, not an accident."* Per-order is the default and is right at today's volume; the digest is the shape to add when a morning's count makes fifty separate emails the wrong answer. Needs a per-kitchen choice of per-order / digest / both, and a scheduled send
