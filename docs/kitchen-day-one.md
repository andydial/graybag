---
title: Kitchen day one — what was proven, and the five-line check you run on production
status: Written 2026-08-15. Proven on staging against real seeded data; the production half waits
  on your smoke payment.
---

# Kitchen day one

## The five-line check, for production

Run this **after your smoke payment lands**. It answers "can the kitchen work tomorrow" and
nothing else.

```bash
set -a; . ~/.graybag-secrets/prod.env; set +a
Q="$SUPABASE_PROD_URL/rest/v1"; H="apikey: $SUPABASE_PROD_SERVICE_ROLE_KEY"
curl -s -H "$H" "$Q/order?select=order_ref,status,service_date,school_name_snapshot,break_label_snapshot&order=created_at.desc&limit=5"
curl -s -H "$H" "$Q/order?select=order_ref,delivered_at&status=eq.delivered&order=delivered_at.desc&limit=3"
npm run check:launch
```

Read it as: **line 3** is the order actually landing with a school and a break against it;
**line 4** is a hand-over sticking (`delivered_at` set, not just a status); **line 5** is
everything else that would stop tomorrow working.

Then open <https://graybag-web.netlify.app/kitchen> signed in, and check three things by eye that
no query can tell you: the day in the header is **today in Mohali**, the order you just paid for
is on the board, and pressing **Delivered** moves it and it is still moved after a refresh.

## What was proven on staging, and how

Driven through the **real board in a real browser, signed in as a real operator** — a genuine
GoTrue session for `anuragdial@gmail.com`, so every read went through RLS exactly as it will on
the 19th. Not the service role: Andy's rule is that a back-office read is verified as the role
that performs it, never as the role that bypasses the rules.

| What | Result |
|---|---|
| A paid order reaches the board | **34 orders, 5 classes, 3 breaks, 53 items** on 2026-08-14 |
| Statuses render | To make / Making / Delivered, and 2 cancelled counted separately |
| Parent notes reach the kitchen | `REQUEST Less spicy` rendered against its order |
| **Allergy badges** | `MILK`, `TREE NUT`, `GLUTEN`, `SOY` on the right children; 26 others read **"No allergies provided"** |
| Badges carry codes only | `TREE NUT`, never shortened to `NUT`; no severity, no parent note, no medical detail |
| **Mark delivered works** | paid 19 → 18, delivered 6 → 7, `delivered_at` set |
| **…and sticks** | Confirmed in the database after the 10-second undo window expired on its own timer |
| The write is attributable | `order_event`: `paid → delivered`, `actor_type: kitchen` (`I2`) |
| **IST midnight boundary** | 18:29 UTC → *Friday 14 August*; 18:31 UTC → *Saturday 15 August* |

### The two that were worth the trouble

**The undo window was waited out, not flushed.** The board defers the write for ten seconds and
flushes early on `visibilitychange`, `pagehide` or a reload. Reloading to check would have proven
the *flush* path; a kitchen hand-over that is left alone takes the *timer* path, so the check sat
still for fourteen seconds and then looked.

**The midnight boundary was tested on the board, not only in `serviceDateToday`.** The unit tests
already pin 18:30 UTC as the roll. What they cannot show is whether the page asks the right
question, so the clock was pinned inside the browser either side of that instant and the header
read both times. `E09-32` shipped a UTC date once already; the unit test that would have caught
it existed only afterwards.

## What is NOT proven

- **Nothing on production.** Production has zero orders, and no payment has been taken through it.
  The five-line check above is what closes that gap.
- **The mobile app's half.** Placing and paying for an order is `apps/mobile`, and this thread
  does not touch it. What is proven starts at "a paid order exists".
- **Cancellation from the board.** The button is there and `E06-45` built the endpoint; it was
  not exercised here because a cancelled order on staging is harder to undo than a delivered one,
  and delivery is the day-one path.
