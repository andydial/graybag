---
title: Production smoke — the tap-through for 17 August
status: written 2026-08-16. NOT YET RUNNABLE — see §0.
---

# Production smoke

The exact sequence to run against **production**, on a real device, with a **real card**, before
parents are let in on the 19th.

Written to be followed literally. Every step says what to tap, what you should see, and — the part
that matters more — **what to check in Razorpay and in the database afterwards**, because most of
what can go wrong here is invisible from the app. A payment that looks fine on the phone and never
becomes an order is the exact failure that cost a day on 14 August, and it looked like success at
every point a person could see.

---

## 0. This cannot be run yet, and here is precisely what is missing

Two things, both recorded in `docs/decisions-16aug.md`:

- **There is no production Supabase project.** `supabase projects list` shows `graybag-staging`
  and nothing else. `docs/environments.md` §1 describes production as a Mumbai `ap-south-1`
  project; it has never been created (`E01-05`).
- **`~/.graybag-secrets/prod.env` does not exist**, so there are no live Razorpay keys, no
  webhook secret, and no way to build an app pointing at production.

Until both exist, this document is the plan and not the record. **Do not run any of it against
staging and tick it off** — staging is a test-mode Razorpay account, and a smoke test that proves
test-mode works proves nothing about the thing that takes a parent's money.

When they exist, work `§1` first: it is a list of things to verify *before* touching the app, and
each one has bitten this project at least once.

---

## 1. Before you touch the app — 10 minutes, all of it worth it

### 1.1 Migrations are actually applied

```bash
npx supabase link --project-ref <PROD_REF>
npx supabase migration list --linked
```

**Every local migration must have a remote counterpart.** A gap means the app will fail against a
schema it expects — and the failure surfaces as a 404 on a column, which reads like an app bug.

### 1.2 PostgREST can see them — this is a separate question and it has bitten twice

Applying a migration is not the same as PostgREST knowing about it. On 14 August a captured
payment sat unsettled for an hour because the schema cache predated the migration and the RPC
"did not exist" over REST while working perfectly in `psql`.

```bash
SR='<PROD_SERVICE_ROLE_KEY>'   # never paste this into a shared channel
U='https://<PROD_REF>.supabase.co'

# Computed columns (E06-42) — must return the fields, not 42703
curl -s "$U/rest/v1/order?select=order_ref,cancellation_closes_at,cancellation_allowed&limit=1" \
  -H "apikey: $SR" -H "Authorization: Bearer $SR"

# The RPCs must REFUSE, not 404. A hint means the function is there.
curl -s -X POST "$U/rest/v1/rpc/cancel_order" -H "apikey: $SR" -H "Authorization: Bearer $SR" \
  -H 'content-type: application/json' \
  -d '{"p_order_group_id":"00000000-0000-0000-0000-000000000000","p_customer_user_id":"00000000-0000-0000-0000-000000000000"}'
# expect: {"code":"P0001", ... "hint":"not_found" ...}

curl -s -X POST "$U/rest/v1/rpc/app_version_support" -H "apikey: $SR" -H "Authorization: Bearer $SR" \
  -H 'content-type: application/json' -d '{"p_version":"4.0.0"}'
# expect: {"supported":true,"minimum_version":"0.0.0", ...}
```

**Run the negative control too.** An empty `[]` and a working endpoint look identical:

```bash
curl -s "$U/rest/v1/order?select=order_ref,no_such_column&limit=1" -H "apikey: $SR" -H "Authorization: Bearer $SR"
# expect: {"code":"42703", ... "column order.no_such_column does not exist"}
```

If the bogus column does *not* 42703, you are not talking to the database you think you are, and
nothing below this line means anything.

### 1.3 The keys are live, and the app cannot reach a test key

```bash
npx supabase secrets list --project-ref <PROD_REF>
```

`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` must all be present.
`RAZORPAY_KEY_ID` must begin `rzp_live_`.

`packages/shared/src/env.ts` refuses the wrong prefix in either direction (`EN2`, asserted in
`env.test.ts`), so a build carrying a `rzp_test_` key with `APP_ENV=production` fails at load
rather than taking real money against a test account. **Confirm the build you are about to test
was made for `production`** — the About row in Account shows the environment.

### 1.4 Seller identity is real, not a placeholder

```bash
curl -s "$U/rest/v1/platform_config?select=seller_gstin,seller_legal_name,seller_address,sac_code" \
  -H "apikey: $SR" -H "Authorization: Bearer $SR"
```

**No value may contain `«` or the word PENDING.** `0045` refuses to issue an invoice with a
placeholder identity in production, so the failure mode here is a paid order with no invoice —
a customer charged with no tax document. `scripts/sync-seller-identity.mjs` reads
`docs/legal/company.json`, which is the single source.

Three staging invoices (`GB/26-27/000001`–`000003`) are permanently wrong for exactly this reason
and cannot be corrected, because §13.2 makes a reprint byte-identical. Do not let production start
the same way.

### 1.5 The webhook is subscribed and verifying

In the Razorpay dashboard → Settings → Webhooks, the URL must be
`https://<PROD_REF>.supabase.co/functions/v1/payments-webhook` with the same secret that is in
`RAZORPAY_WEBHOOK_SECRET`, subscribed to at least:

`payment.captured`, `payment.failed`, `refund.created`, `refund.processed`.

Then send a test delivery from the dashboard and check it **verified**:

```sql
select event_type, signature_verified, processing_status, received_at
  from payment_webhook_event order by received_at desc limit 5;
```

`signature_verified = true` is the thing to look for. **`recorded_unverified` means the secret is
wrong or absent** — the handler records the event and refuses to trust it, which is the correct
fail-safe and not a working state.

---

## 2. The tap-through

Use a **clean parent account with zero permission grants**. Do not use `anuragdial@gmail.com`: it
holds 17 grants on staging and the same self-granting is likely on production, and every
parent-scope read performed with it passes for the wrong reason — that is how "My Orders" showed
65 orders for a fortnight.

Verify it is clean before you start:

```sql
select count(*) from permission_grant
 where user_id = (select id from app_user where email = '<the account>') and revoked_at is null;
-- expect: 0
```

| # | Do this | Expect | If it is wrong |
|---|---|---|---|
| 1 | Open the app cold | Menu, no update wall | If the update wall appears, `min_supported_app_version` is above this build. `select min_supported_app_version from platform_config;` |
| 2 | Sign in with email OTP | Code arrives within ~30s | No mail: check the Supabase Auth SMTP settings, not the app |
| 3 | Add a child — name, school, class, section | Consent text appears **before** the child is created | If no consent, `child_data_notice` has no published version on prod |
| 4 | Browse the menu, open a dish | Photo, allergens, price | Prices are **GST-exclusive**; the 5% is added at checkout |
| 5 | Add to cart, open the cart | Line, subtotal, **CGST 2.5% + SGST 2.5%**, total | Two 2.5% lines, never one 5% line |
| 6 | Checkout, pick a break time | Razorpay sheet opens | Sheet does not open: `payments-create-order` or the key |
| 7 | **Pay with a real card** | Success, then Order Placed with a 4-digit pickup code | See §3 — do not retry blindly |
| 8 | Orders tab | The order, **and only yours** | Any order that is not yours is `E06-43` regressing. Stop and say so |
| 9 | Open the order | Totals matching the sheet, invoice number, "Cancelling closes at …" | "We can't tell when cancelling closes" means `config_snapshot` lacks the keys |
| 10 | Check email | Invoice email, with the invoice **in the body** | Not a PDF — `E07-04` |
| 11 | Cancel the order | Confirmation sheet naming the amount, then cancelled | It must ask twice. A single press that cancels is a bug |
| 12 | Reopen the order | Cancelled, refund noted as **pending** | It must not say "refunded" — nobody has sent the money yet |

**Use a real card, not UPI.** Andy is in Australia and cannot complete a UPI payment; a card also
carries real MDR, which makes the fee arithmetic answerable — UPI's zero MDR makes `fee: 0`
indistinguishable from "not populated".

---

## 3. After the payment — what to check where

This is the part that catches what the app cannot show you.

### 3.1 In Razorpay

- **Payments → the payment**: status `captured`, not merely `authorized`. An authorised payment is
  not money (`L5`, `R8`).
- The **amount matches the sheet exactly**, in paise.
- **Settlements**: note the fee and tax. They feed `M5` and `E07-11`.

### 3.2 In the database

```sql
-- The order exists, is paid, and has a pickup code
select o.order_ref, o.status, o.pickup_code, o.total_paise, og.status as group_status
  from "order" o join order_group og on og.id = o.order_group_id
 order by o.created_at desc limit 3;

-- The payment is captured and matches
select provider_payment_id, status, amount_paise, provider_fee_paise, captured_at
  from payment order by created_at desc limit 3;

-- The invoice exists, and its number is in the gapless series
select invoice_number, document_type, total_paise, seller_gstin
  from invoice order by issued_at desc limit 3;

-- The ledger balances for this payment
select lt.reason_code, la.code, le.direction, le.amount_paise
  from ledger_entry le
  join ledger_transaction lt on lt.id = le.transaction_id
  join ledger_account la on la.id = le.account_id
 where lt.source_type = 'payment'
 order by lt.occurred_at desc limit 8;

-- Nightly invariants, run now
select * from assert_ledger_integrity();
-- expect: zero failures

-- The webhook queue is empty of unprocessed work
select processing_status, count(*) from payment_webhook_event group by 1;
-- expect: nothing 'pending' more than a moment old
```

**The three numbers that must agree**: the amount on the sheet, `payment.amount_paise`, and
`invoice.total_paise`. If any two differ, stop — `L7` exists because a customer must never be
charged something other than what they were shown.

### 3.3 After the cancellation (step 12)

```sql
select r.status, r.amount_paise, r.destination, r.reason_code, r.provider_refund_id
  from refund order by initiated_at desc limit 3;
-- expect: status 'pending', provider_refund_id NULL — the money has NOT been sent

select count(*) from ledger_transaction where source_type = 'refund';
-- expect: 0. Nothing is posted until the money actually moves.
```

Then **issue the refund by hand** in the Razorpay dashboard, wait for `refund.processed`, and
check it flowed back:

```sql
select status, provider_refund_id, completed_at from refund order by initiated_at desc limit 1;
-- expect: 'completed', with the provider's refund id

select invoice_number, document_type from invoice where document_type = 'credit_note';
-- expect: a credit note withdrawing the tax invoice

select o.status from "order" o order by o.updated_at desc limit 1;
-- expect: 'refunded'
```

**Do not issue a partial refund.** Partial refunds are refused (`E06-08` is out of scope for this
release): the money leaves the account and nothing is recorded. The consumer logs loudly and now
emails `support@graybag.com`, but the reconciliation is manual and you will be doing it yourself.

---

## 4. The force-update gate — test it deliberately, once

Worth ten minutes on the 17th, because on the 19th it is the mechanism the whole cutover rests on
and it will never have been exercised against production.

```sql
-- Raise the floor above the build in your hand
update platform_config set min_supported_app_version = '99.0.0',
       update_required_message = 'Please update GrayBag to keep ordering.' where id = 1;
```

Force-quit and reopen the app. **Expect the update wall**, with that sentence.

```sql
-- Put it back. DO NOT LEAVE THIS SET.
update platform_config set min_supported_app_version = '0.0.0',
       update_required_message = null where id = 1;
```

Reopen: the app works again. On the 19th the floor goes to `4.0.0`.

> The gate admits any build whose version it cannot parse, and admits everybody if the check
> itself fails. That is deliberate — a parent wrongly locked out has no route back, because the
> store will tell them they are already on the latest build.

---

## 5. What this smoke deliberately does not cover

Said plainly so nobody reads a green run as more than it is.

- **UPI intent**, which is `E19-11` and needs somebody in India with a UPI app.
- **Webhook retry behaviour** (`E19-12`) — our handler always answers 200, so Razorpay has never
  retried, and the ~24h assumption has never been measured.
- **Partial refunds** — refused by design in this release.
- **A second parent's data.** Step 8 checks that you see only your own orders, which is necessary
  and not sufficient: the real assertion needs three parents and a count, and it lives in
  `my_orders_scope.test.sql` rather than in a manual pass.
- **The policy acceptance gate.** Nothing in any environment sets `blocks_ordering = true`, so it
  cannot fire; and `create_checkout` has no server-side check regardless (`E20-55`).
