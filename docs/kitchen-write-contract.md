# Kitchen write contract — reversal and cancellation

**Status: specification. Neither half is built.** The kitchen dashboard calls both; today one is
refused by the database and the other does less than the kitchen will assume.

This follows `docs/kitchen-transport-contract.md`: the screen is built against a stated contract,
and the thread that owns the territory implements it. §1 needs a **migration**. §2 needs the
**refund and notification** endpoints in `E06` / `E08`.

Raised because Andy hit both on a real board on 2026-08-13: *"Start is a one-way door. I pressed
it by mistake and there's no way back"*, and *"say plainly in the UI what cancelling does and
doesn't do today."*

---

## 1. Undoing a status a human set by hand

### The problem

`order-lifecycle.md` §4.1 is strictly forward. Every tuple moves an order onward and **there is
no reverse tuple for any actor** — not `preparing -> paid`, not `delivered -> preparing`, not
`delivered -> paid`. `assert_order_status_transition` enforces the list literally, so the write
does not merely lack a button: the database refuses it.

That is defensible for a state a *machine* sets from evidence. `pending_payment -> paid` follows
a verified capture; there is nothing to undo, only a fact to record.

It is not defensible for a state a **human sets by hand on a touchscreen in a kitchen**.
`paid -> preparing` is one tap next to `paid -> delivered`, both are 56px, and the operator has
wet hands. A mis-tap is not an edge case, it is Tuesday. An action a person performs by hand
needs a way back, or the record stops describing reality — and a kitchen that cannot correct the
board learns to stop trusting it, which costs more than the mis-tap did.

### What is required

Two new tuples in §4.1 and in the trigger:

| | operation | from | to | actor | why |
|---|---|---|---|---|---|
| **T15** | `UPDATE` | `preparing` | `paid` | `kitchen`, `admin` | undo a mis-tapped **Start** |
| **T16** | `UPDATE` | `delivered` | `preparing` | `admin` only | undo a mis-tapped **Delivered** |

**`preparing -> paid` is the important one** and should be uncontroversial: `preparing` asserts
only that somebody began cooking. Nothing downstream depends on it, no money moves, no parent is
told. Reversing it costs nothing and unblocks the common mistake.

**`delivered -> preparing` is deliberately narrower — `admin` only, not `kitchen`.** `delivered`
is the assertion that a named child physically received food. It is the record that answers "my
child says they got nothing", and it is the last write before the order is settled. A kitchen
operator who can silently un-deliver can also silently rewrite that answer. Requiring an admin
keeps the correction possible and makes it deliberate.

Both must be **stamped and reversible in the audit trail, not erased**:

- clear the forward stamp (`preparing_at`, or `delivered_at` **and** `delivered_by_user_id`)
- the `order_event` row is appended like any other — `from_status`, `to_status`, `actor_type`,
  `actor_user_id` — so the history reads `paid -> preparing -> paid`, which is what happened.
  **Never delete the forward event.** A correction is a fact, not an absence of one.

### The endpoint

`kitchen-order-status` already accepts `to`, and both reversals are ordinary values of it. It
needs three changes, all small:

```
LEGAL_FROM.paid       = ['preparing']                 // new
LEGAL_FROM.preparing  = ['paid', 'delivered']         // 'delivered' added
GRANT_FOR.paid        = 'orders.mark_delivered'
```

plus: `delivered -> preparing` must additionally require an **admin-scoped** grant, and the
`delivered_at` / `delivered_by_user_id` / `preparing_at` columns must be cleared on the reverse
move rather than left stale. A reversal with a stale `delivered_at` is worse than no reversal —
the status says "to make" and the stamp says it was handed over at 12:40.

### Until it exists

The dashboard **does not draw an Undo button it knows will fail**. Instead it says so at the
point of the action, which is what Andy asked for — *"if not, say why in the UI rather than just
refusing"*. `E09-22` covers the UI; this document covers the write.

---

## 2. Cancelling, and the two things it does not do

### What happens today

`kitchen-order-status` with `to: 'cancelled'` sets `status`, `cancelled_at`,
`cancelled_by_user_id` and `cancel_reason_code`, and appends an `order_event`. That is all.

**No money moves and nobody is told.** `order-lifecycle.md` is explicit that
`cancelled -> refunded` is a separate transition performed by `system`, and no code performs it.
The parent is not emailed, because the notification path is `E08`.

This is the dangerous part, and it is a people problem rather than a code one: **a kitchen that
presses "Cancel" will believe it has refunded someone.** It has not. The parent has paid, has no
food, and has had no message. Nothing on the screen currently corrects that belief.

So the UI states it plainly at the moment of cancelling, and keeps stating it afterwards, until
§2.2 and §2.3 exist.

### 2.1 Reason codes — from the table, not a hardcoded list

`reason_code` is a real table with `category`, `display_name`, `requires_note` and `is_active`.
The kitchen offers `category = 'cancellation'` and `is_active`, minus the codes that describe a
payment or customer action rather than a kitchen decision:

| offered | `display_name` |
|---|---|
| `dish_unavailable` | Dish unavailable |
| `kitchen_closed` | Kitchen closed |
| `school_holiday` | School holiday |

Not offered to the kitchen: `customer_cancelled`, `payment_failed`, `checkout_expired`,
`cutoff_missed` — all of them are recorded by the system from evidence, and a kitchen operator
selecting one would be asserting something they cannot know.

**Plus a free-text field, always, not only when `requires_note`.** Andy: *"the four codes will
never cover the real reason."* The free text goes in `order_event.note`, which exists. It is
**tier P by assumption** — an operator may type a child's name into it — so it is never logged
and never leaves the row.

The endpoint therefore takes an optional `note` alongside `reasonCode`, and stores it on the
event rather than on the order.

### 2.2 The refund — `E06`, payments thread

Cancelling a **paid** order creates an obligation. The kitchen must not be the thing that decides
whether it is met.

Required: an endpoint the cancellation path calls, or a documented reason it does not.

- **Idempotent per order.** A retried cancel must not refund twice. The kitchen tablet retries.
- **Integer paise throughout** (non-negotiable #3).
- It performs `cancelled -> refunded` as `system`, per §4.1 T13 — never straight from `paid`,
  because a refund with no cancellation loses *why* the food was not delivered.
- It decides **to source or to wallet** (`refund_to_source` / `refund_to_wallet` already exist as
  ledger reason codes). The kitchen has no view on this and must not be asked.
- **Partial refunds are out of scope here.** A kitchen cancels a whole order.

Open question for that thread: is a cancellation refunded **automatically**, or does it raise
something for a human? Both are defensible. The kitchen UI must state which one is true, so this
cannot stay undecided once it ships.

### 2.3 The parent's email — `E08`

No push in v1 (non-negotiable #7), so email is the only channel.

- Sent on cancellation, **not** on the refund settling, so the parent hears within seconds rather
  than in three working days.
- Names the child, the date, the break and the reason in the parent's words — the
  `display_name`, never the code.
- Says what happens to the money, and it must match §2.2's answer.
- **Contains no other child's data** and no free-text note, which may name someone else.

### 2.4 What the UI says until both exist

Verbatim, in the cancel dialog:

> **This does not refund anyone.** Cancelling records that the food was not delivered and why.
> No money moves and the parent is not told — someone will have to contact them.

And on a cancelled row afterwards: **Cancelled · not refunded**.

Both strings are deleted in the same PR that lands §2.2, and not before. If the wording survives
the refund shipping, the screen lies in the opposite direction.

---

## Tasks

- `E09-22` — the cancel UI, reason codes, free text, and the two strings above *(this thread)*
- `E09-23` — the reversal UI, once §1 exists *(this thread)*
- `E09-24` — §1's migration and the endpoint changes *(needs `supabase/`)*
- `E06-xx` / `E08-xx` — §2.2 and §2.3 *(payments thread, to be numbered by them)*
