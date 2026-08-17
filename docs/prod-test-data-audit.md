# What test data is on production — audit of 2026-08-17

**Nothing has been deleted.** This is the inventory and the recommendation; the decision is
Andy's.

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
