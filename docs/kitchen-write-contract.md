# Kitchen write contract — correction and cancellation

**Status: partly built.** §1(a), the undo window, is shipped and needed no server change. §1(b)
and §1(c) need a **migration**. §2's refund and parent email are `E06` / `E08`.

This follows `docs/kitchen-transport-contract.md`: the screen is built against a stated contract,
and the thread that owns the territory implements it.

Raised because Andy hit both on a real board on 2026-08-13: *"Start is a one-way door. I pressed
it by mistake and there's no way back"*, and *"say plainly in the UI what cancelling does and
doesn't do today."* The design of §1 is his — *"a correction is a NEW event, never an edit"* — and
"ask an admin" was rejected as unworkable: at volume every mis-tap becomes a support ticket.

---

## 1. Correcting a status a human set by hand

### The principle: a correction is a new event, never an edit

Andy, 2026-08-13: *"Apply the ledger's own principle: a correction is a NEW event, never an edit.
`order_event` stays append-only and the audit stays honest — it shows the mistake AND the
correction, which is more truthful than a history where the mistake never happened."*

That settles the design. `order_event` is append-only and stays that way. Status is **derived**,
so the derived value goes back while the record only grows. A corrected order's history reads
`paid → preparing → paid`, and that is the truth: somebody did press Start, and somebody did
take it back.

*"Ask an admin to correct it" is not viable* — at volume every mis-tap becomes a support ticket.
Three layers, ordered by how often each will be used.

---

### (a) The immediate undo window — **built, needs no server change**

Right after any status tap, "Undo" for ten seconds. This catches the overwhelming majority: a
finger landing on the wrong button, noticed instantly.

**It defers the write rather than reversing it**, which is the only reason it can exist today.
Gmail's "Undo Send" does not recall a sent mail — it holds the send and cancels it. Nothing is
sent, so no tuple is needed and there is nothing in the audit trail to explain. Shipped as
`E09-29`.

Its limits, which are exactly why (b) and (c) still matter: it is ten seconds long, it is lost if
the device dies mid-window, and it cannot help the operator who notices at the end of the break.

---

### (b) A correction after the window — needs the server

Available to the **kitchen operator without an admin**, and time-bound.

**A distinct event type**, so the audit distinguishes "this was done" from "this was corrected".
`order_event` has `from_status` and `to_status` and nothing that says *why the shape of the
change*: a `preparing → paid` row is indistinguishable from a hypothetical legitimate one. Add a
column — `event_kind` with values `progress` and `correction` — or a reason code reserved for
corrections. **`event_kind` is recommended**: a reason code is about the world, and this is about
the record.

Two tuples, both `kitchen` and `admin`:

| | operation | from | to | actor |
|---|---|---|---|---|
| **T15** | `UPDATE` | `preparing` | `paid` | `kitchen`, `admin` |
| **T16** | `UPDATE` | `delivered` | `preparing` | `kitchen`, `admin` — see (c) |

**Time-bound.** Until the break passes, or a configurable window — after that it genuinely is an
admin matter, because a correction to yesterday's service is a different act from fixing a
mis-tap. Suggested default: **until the end of the service date**, configurable per kitchen.
The bound belongs in SQL and not only in the UI, or it is advice rather than a rule.

Both moves must **clear their forward stamps** — `preparing_at`, or `delivered_at` **and**
`delivered_by_user_id`. A status reading "to make" beside a `delivered_at` of 12:40 is worse than
no correction at all.

---

### (c) Undoing **Delivered** is a claim about the physical world

`delivered` asserts that a named child received food. It is the record that answers "my child says
they got nothing". Reversing it is allowed — an admin round trip for every mis-tap is the thing
this document exists to remove — but it is **not** the same act as taking back "Making".

So, per Andy: **allow it, require a reason, and mark it distinctly in the audit.**

- A **reason is mandatory** — `reasonCode`, and the free text of `E09-27` once it has a column.
  This is the one correction where "why" cannot be reconstructed from the transition alone.
- Marked distinctly: `event_kind = 'correction'` **and** a reason, so a query for "orders whose
  delivery was retracted" is one predicate rather than an inference.
- The endpoint rejects `delivered → preparing` with no reason — 422, the way cancellation already
  does. A guard the UI enforces alone is not a guard.

Not proposed: `delivered → paid` in one step. Two hops keep each event meaning one thing.

---

### The endpoint

`kitchen-order-status` already takes `to`, and every move above is an ordinary value of it:

```
LEGAL_FROM.paid       = ['preparing']              // new
LEGAL_FROM.preparing  = ['paid', 'delivered']      // 'delivered' added
GRANT_FOR.paid        = 'orders.mark_delivered'
```

plus: clear the forward stamps, stamp `event_kind = 'correction'`, enforce the time bound, and
require a reason for `delivered → preparing`.

**What is needed from the `supabase/` thread**: the two tuples in §4.1 and the trigger, the
`event_kind` column, and the time-bound check. `E09-24`.

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
never cover the real reason."*

**This half is blocked, and the field is deliberately not shipped until it is.** There is nowhere
to put the text:

- `order_event.note` exists and the trigger never populates it. `write_order_event` inserts
  `reason_code` and `correlation_id` and no note.
- The obvious workaround — insert, then `update order_event set note = …` in the same
  transaction — is refused outright: *"order_event is append-only; UPDATE is not permitted.
  Write a compensating row instead."*
- `"order"` has `cancel_reason_code` and no free-text column at all.

So free text needs a **migration**, one of:

1. `write_order_event` reads `app.event_note` from a session setting, exactly as it already reads
   `app.actor_type`, `app.actor_user_id` and `app.correlation_id`. **Recommended** — smallest
   change, same mechanism, and it works for every actor rather than only for cancellation.
2. a `cancel_note` column on `"order"`. Simpler, but it puts a free-text field on the order for
   one status, and the next status that needs one adds a second column.

Shipping the input before its storage exists would repeat exactly the failure this same board
just fixed for the parent's note: **a field that quietly discards what you type is a lie told to
the person typing.** So the dialog offers the reason codes today, and the text box arrives with
its column.

When it lands, the endpoint takes an optional `note` alongside `reasonCode`. It is **tier P by
assumption** — an operator may type a child's name into it — so it is never logged and never
leaves the row.

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

- `E09-22` — **done.** The cancel dialog, reason codes, and §2.4's two strings
- `E09-23` — **done.** What the row says about what cannot be corrected yet
- `E09-29` — **done.** §1(a), the undo window. Needed no server change
- `E09-27` — free text on a cancellation, §2.1. Needs a **migration**
- `E09-24` — §1(b) and §1(c): the two tuples, `event_kind`, the time bound, and the mandatory
  reason on `delivered -> preparing`. Needs a **migration** *(`supabase/` thread)*
- `E06-xx` / `E08-xx` — §2.2 and §2.3 *(payments thread, to be numbered by them)*
