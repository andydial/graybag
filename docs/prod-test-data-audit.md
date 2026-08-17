# What test data is on production — audit of 2026-08-17

> **Status: acted on.** This began as an inventory with nothing deleted. Andy approved the
> recommendation on 2026-08-17 and it was carried out — see **"Acted on"** at the foot of this
> file for what was removed, what was erased through the app, and what remains. The inventory
> below is preserved as the state *before* that cleanup, because the reasoning about what could
> and could not be deleted is the useful part.

## The headline answers

| Question | Answer |
|---|---|
| Is "Sweep Two" yours? | **Yes.** Created 2026-08-15 15:35:30 by my verification sweep, with `capture_context.screen = "prod-sweep-2"` on its consent record |
| Has a test order consumed an invoice number? | **No.** `invoice_sequence` is empty and `invoice` has zero rows |
| What will the first real parent's invoice read? | **`GB/26-27/000001`** |
| Does the ledger balance to zero? | **Yes, trivially — it is empty.** 0 transactions, 0 entries |
| Is there real money anywhere? | **No.** The live Razorpay account has zero payments, ever |

## Why the invoice number is safe, structurally

`issue_invoice` (`0047`) takes the number **last**, under a row lock, after every check that
could refuse has already passed. A failed or abandoned invoice attempt therefore cannot burn a
number. And it is only ever called on a **paid** order group — no order has ever been paid, so
the function has never run.

`invoice_sequence` has no row for `2026-27` at all, so the first allocation will create it at 0
and immediately return 1.

## Everything test-related, by table

All of it belongs to `anuragdial+parent@gmail.com`, which holds **zero** permission grants.

| Table | Rows | What they are |
|---|---|---|
| `recipient` | 2 | `Sweep Two` (active), and one already anonymised to `Removed` by the erasure test |
| `guardian_link` | 2 | Links from `+parent` to those two |
| `order_group` / `order` | 3 / 3 | `GB-0DDW8Q`, `GB-APGY7Q`, `GB-94Q6JD` — **all cancelled**, ₹72.46 each |
| `order_line` | 3 | One line each, Wheat Jaggery Cake |
| `order_event` | 6 | The status transitions of those orders |
| `payment` | 1 | `order_TQEBriyYjojCF1`, status `created`, **never paid**, no `provider_payment_id` |
| `payment_webhook_event` | 3 | Two signature tests (one valid, one forged) and one unauthenticated probe |
| `consent_record` | 3 | Consent captured when the test children were added |
| `idempotency_key` | 3 | Checkout keys from the sweeps |
| `enquiry` / `enquiry_rate` | 1 / 5 | The enquiry I submitted to prove Resend delivers from prod |

**Not test data — leave alone:** the catalogue (79 dishes, 83 menu items, 8 categories, 7
allergens, 77 assets, 2 menus, 3 assignments), the 3 schools and their configs, 6 break times,
1 city, 1 kitchen, both `app_user` rows, the 31 `permission_grant` rows on Andy's account, and
all reference data (`permission`, `role_template`, `reason_code`, `policy_*`, `consent_purpose`,
`ledger_account`).

## What can actually be deleted, and what the database refuses

Four tables carry an `append_only` trigger that **refuses DELETE outright**:

- `order_event`, `consent_record`, `ledger_entry`, `ledger_transaction`

That has a consequence worth stating plainly: **the three test orders cannot be deleted.**
`order_event.order_id` cascades from `order`, so deleting an order tries to delete its events,
the append-only trigger fires, and the whole transaction aborts. And `order.recipient_id` is
`RESTRICT`, so the children cannot be deleted while those orders exist either.

Removing them would mean dropping a guard that exists to make order history immutable — on the
day before launch, to tidy three cancelled rows. That is a bad trade.

### Safe to delete, nothing references them

- `enquiry` (1) and `enquiry_rate` (5)
- `payment_webhook_event` (3)
- `payment` (1) — must go before `order_group` would be deletable, but see above
- `idempotency_key` (3)

### Blocked by design

- `order_event`, `consent_record` — append-only. `consent_record` is also §6.1.5 evidence that
  the processing was lawful; deleting it destroys our own defence
- `order`, `order_line`, `order_group` — via the cascade into `order_event`
- `recipient` — `order.recipient_id` is `RESTRICT`
- `guardian_link` — its deferred `D10` trigger refuses to leave a live recipient unreachable

## Recommendation

**Leave the orders and their events.** They are cancelled, carry no money, touch no invoice
number, and cost nothing except three rows in a list only Andy sees. Deleting them requires
dropping an immutability guard.

**Erase `Sweep Two` through the app's own path** — `DELETE /recipients/<id>`, which is proven
working since `0062`. That anonymises the row to `Removed`, deletes any allergen rows and
revokes the guardian links, using the same code path a real parent would. It leaves
`order.recipient_name_snapshot` reading "Sweep Two" on the cancelled order, which is deliberate
(`0026`: snapshots are the record of what was ordered and have their own retention schedule) and
harmless, since the child is fictional.

**Optionally delete** the enquiry, its rate rows, and the three webhook probes. Pure noise, no
references, no triggers.

**Do not touch** the payment row unless the order group is going too — on its own it is a
harmless record of a Razorpay order that was created and never paid.


---

# Acted on, 2026-08-17

Andy approved the recommendation. What was done:

**Deleted** — `payment_webhook_event` (3), `payment` (1), `idempotency_key` (3),
`enquiry_rate` (5), `enquiry` (1). All now zero. Nothing referenced them.

**Erased** — `Sweep Two`, through `DELETE /functions/v1/recipients/<id>` as the parent, not by
SQL, so it exercised the same path a real erasure request would. Both children now read
`Removed`, anonymised, with no class, no section, no active guardian links and no
`recipient_allergen` rows.

**Kept** — the three cancelled orders, their 6 `order_event` rows, and the 3 consent records.
No money, no invoice number, and the immutability guards stay.

## Confirmation 1 — the kitchen board

`KITCHEN_STATUSES` in `packages/shared/src/api/kitchen.ts` is
`['paid', 'preparing', 'delivered', 'cancelled']`, so **a cancelled order does appear on the
board**. Each of the three sits on its own date:

| Date | Board shows |
|---|---|
| **17 Aug** (today) | 1 row — `GB-94Q6JD`, cancelled, "Sweep Two" |
| **19 Aug** (launch day) | 1 row — `GB-0DDW8Q`, cancelled, "Sweep Testchild" |
| 20 Aug | 1 row — `GB-APGY7Q`, cancelled, "Sweep Two" |

So the answer to *"does it read sensibly"* is: it reads correctly and it is still not what you
want on day one. **19 August is the one that matters** — the Amity board opens on launch day
showing a single cancelled order for a child called "Sweep Testchild", and nothing else.

The name persists because `order.recipient_name_snapshot` is deliberately not touched by erasure
(`0026`: the snapshot is the record of what was ordered, with its own retention schedule). It is
correct behaviour on a fictional child, and it looks like a real one to a kitchen operator.

**Not acted on, because it is a production data change beyond what was approved.** The options:

1. **Move the three `service_date`s into the past.** `order` has no protected-column guard, so
   this works; it fires `write_order_event`, adding one more event each. Clears every future
   board. Rewrites a field on a historical record, which is the objection.
2. **Leave them and tell the kitchen** that anything named "Sweep" on 19–20 August is ours.
3. **Have the board hide cancelled orders with no other orders on that date** — a change in
   `apps/web`, which is the web thread's, and a product decision rather than a cleanup.

Recommendation: **(1)**, moving them to a date already past, e.g. 2026-08-01. It is the only one
that clears launch day without touching an immutability guard or the web code, and the field it
rewrites carries no money and no invoice number.

## Confirmation 2 — what still references `+parent@`

Six places, all of them consequences of what we agreed to keep:

| Reference | Rows | Why |
|---|---|---|
| `app_user.id` | 1 | The account itself |
| `consent_record.user_id` | 3 | Kept — append-only, §6.1.5 evidence |
| `order.customer_user_id` | 3 | Kept — the cancelled orders |
| `order_group.customer_user_id` | 3 | Kept — same |
| `guardian_link.user_id` | 2 | Revoked links to the two anonymised children |
| `recipient.created_by_user_id` | 2 | The two anonymised children |

Plus one row each in `app_user` and `auth.users` for the address itself. **Nothing else**: no
payment, no invoice, no ledger entry, no notification, no enquiry, no webhook event.

Invariants re-checked after the cleanup: `invoice_sequence` 0 rows, `invoice` 0, `ledger_entry`
0, `payment` 0. The first real invoice still reads **`GB/26-27/000001`**.
