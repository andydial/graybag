# Meal packs — the plan, before any code

`E21`. Andy, 2026-08-26: *"This is the highest-consequence feature we've built, because it takes
money up front for food not yet served."*

Acceptance criteria are `docs/prototype/prototype.src.html` (rebuilt with
`node docs/prototype/build.mjs`), committed as `8ea05b2` and `98f4ce9`. Three surfaces: buying a
pack, the balance, spending it.

**Nothing here is built yet.** This document exists to be argued with first.

---

## 0. Who owns the migrations

**This thread owns every meal-pack migration.** Andy assigned migration ownership to the mobile
thread this week, and this is the case that ownership exists for: the parent side spends the
balance and the admin side configures the offers, and both read the same four tables. Two threads
writing migrations against one new schema is exactly how `E17-29` produced four ids meaning two
different things.

Confirmed by search before proposing it: **no branch anywhere contains a migration mentioning
`meal_pack`** — not `main`, not any of the twenty-odd live branches. Nobody has started.

- I write `0068`–`00NN`. Numbers **reserved now**, so the web thread's next migration starts
  above the block rather than colliding with it.
- The web thread writes **zero** migrations for this feature. If the admin side needs a column —
  a display order, an internal note — it is a one-line request to me and it goes in my migration,
  in the same PR that needs it.
- The contract between us is the table shapes in §1. If those change, they change here first.

The highest migration on any active branch today is `0067`, so `0068` is genuinely free.

---

## 1. Schema

Four tables. The split matters: an **offer** is a product the admin configures, a **pack** is a
thing a parent owns, and a **redemption** is an append-only fact.

```sql
-- What the admin configures and sells. The web thread's screens write this.
meal_pack_offer
  id                      uuid pk
  name                    text            -- "10 meal pack"
  meals_count             int             -- 10
  items_per_meal          int             -- 2
  required_category_id    uuid → dish_category   -- "one of them a drink"
  price_paise             bigint
  alacarte_reference_paise bigint         -- what the same meals cost singly; for "save ₹375"
  validity_days           int             -- 60
  is_active               boolean
  constraint meals_count > 0, items_per_meal > 0, price_paise > 0

-- The school switch. Absence means OFF — a school is not offered packs unless a row says so.
meal_pack_offer_school
  offer_id   uuid → meal_pack_offer
  school_id  uuid → school
  is_enabled boolean not null default true
  primary key (offer_id, school_id)

-- A pack a parent OWNS. Not a child's — see §6.
meal_pack
  id                  uuid pk
  customer_user_id    uuid → app_user      -- the parent, and the only owner
  offer_id            uuid → meal_pack_offer
  order_group_id      uuid → order_group   -- the purchase that created it
  meals_total         int not null
  meals_remaining     int not null         -- THE balance. See §2.
  meal_value_paise    bigint not null      -- price_paise / meals_count, remainder handled in §5
  tax_point           pack_tax_point not null   -- STAMPED AT SALE. See §4.
  purchased_at        timestamptz
  expires_at          timestamptz not null
  status              meal_pack_status     -- active | exhausted | expired | void
  correlation_id      uuid not null
  constraint meals_remaining >= 0                    -- the backstop, not the mechanism
  constraint meals_remaining <= meals_total

-- Append-only. One row per meal spent; reversal is a column, never a delete.
meal_pack_redemption
  id              uuid pk
  meal_pack_id    uuid → meal_pack
  order_id        uuid → "order"           -- unique: one meal per order, ever
  recipient_id    uuid → recipient         -- WHICH child ate. Not who owns the pack.
  service_date    date
  redeemed_at     timestamptz not null
  reversed_at     timestamptz              -- null until cancelled
  reversal_reason text
  unique (order_id)
```

`unique (order_id)` is doing real work: it makes "this order spent two meals" unrepresentable,
which is a stronger guarantee than any check in application code.

New enums: `meal_pack_status`, `pack_tax_point`. A new `ledger_account_type` value —
`deferred_revenue` — see §5.

---

## 2. Concurrency: meals cannot go negative, and cannot be raced

Andy: *"Two devices confirming plans at the same moment must not spend the same meal twice. Prove
it with a concurrent test, not a comment."*

### The mechanism is one atomic statement

```sql
update meal_pack
   set meals_remaining = meals_remaining - p_meals
 where id = p_pack_id
   and status = 'active'
   and expires_at > now()
   and meals_remaining >= p_meals      -- the whole guarantee is on this line
returning meals_remaining;
```

Zero rows returned means refused. **This is safe at READ COMMITTED**, which is what PostgREST and
our Edge Functions run at, and the reason is worth stating precisely rather than assumed: a second
transaction updating the same row blocks on the first one's row lock, and when it unblocks it
**re-evaluates its `WHERE` against the committed value**, not the one it read. So the losing
device sees `meals_remaining` already decremented and matches zero rows.

The `check (meals_remaining >= 0)` constraint is a **backstop, not the mechanism**. If it ever
fires, the mechanism has a bug and I want the write to abort loudly rather than proceed.

### Spending across several packs

A parent can hold more than one pack, and the prototype commits to **oldest first** (*"buy another
and it stacks on top — meals are spent oldest first"*). So a plan for 4 meals may span two packs.

```sql
select id, meals_remaining from meal_pack
 where customer_user_id = p_user and status = 'active' and expires_at > now()
 order by expires_at asc, id asc          -- deterministic, and the same order everywhere
   for update;
```

**The lock order is the deadlock prevention.** Two parents never contend; the same parent on two
devices takes the same rows in the same sequence, so one waits rather than deadlocking. Ordering
by `expires_at` also *is* the business rule — the row that expires soonest is spent first — so the
correctness and the concurrency control are the same line, which is the version least likely to
drift.

### How it will be proved

A pgTAP test is not enough on its own: pgTAP runs in one transaction and rolls back, so it cannot
observe two transactions racing. So:

1. **pgTAP** for the single-transaction properties — refusing at zero, refusing when expired,
   refusing a foreign pack, the `>= 0` constraint firing.
2. **A real concurrent test** — a Node script opening **two separate connections**, both calling
   the spend function against a pack with exactly **one** meal left, released together. Asserts
   exactly one succeeds, one is refused, `meals_remaining = 0`, and exactly **one**
   `meal_pack_redemption` row exists. Run against staging in CI.
3. **The N-device version** — 10 connections against a 3-meal pack: exactly 3 succeed.

That third one is the test that would catch a mechanism that happens to work for two.

---

## 3. Idempotency, eligibility, expiry — all server-side

### Confirming a plan is idempotent

Andy: *"Planning four days and retrying on a flaky connection must produce four orders, not
eight."*

Reuses the existing `idempotency_key` table and the pattern `E05-12` already established for
checkout. The client generates one key **per plan confirmation**, not per day.

1. Insert the key first. A unique violation means this is a retry.
2. On retry, return the **stored result** — the order ids created the first time — and write
   nothing.
3. The key, the created order ids and the redemption ids are stored together in one transaction
   with the decrement, so a retry cannot observe a half-finished plan.

The failure this is shaped against: a parent on a bad school-gate connection taps Confirm, the
response is lost, they tap again. Four orders, four meals, once.

### Eligibility is decided where the meal is spent

Andy: *"A client claiming a cart qualifies proves nothing."*

The rule — `items_per_meal` items, at least one from `required_category_id` — is evaluated inside
the same Edge Function transaction that decrements the balance, from the **order lines as
persisted**, never from a flag on the request. The client's `packUse` toggle is a *request*, not
an assertion. A request to spend a meal on a non-qualifying cart is refused with a code the app
turns into the prototype's copy (*"A pack meal is two items with one drink"*).

The category is read from the offer, not hardcoded to Drinks — the admin configures it.

### Expiry is server-side, twice

- `expires_at > now()` in the atomic decrement, so a pack cannot be spent after expiry even if the
  app thinks otherwise.
- `service_date <= expires_at::date` per planned day, so a day **after** expiry cannot be planned
  at all — the prototype's `Mon 13 Oct` row, refused with its reason shown on the day rather than
  at confirm time.

Both are enforced; the second is not a nicety, because a plan confirmed today for a date after
expiry would otherwise silently consume a meal for a day the pack cannot cover.

---

## 4. GST — built behind a decision Andy can flip

Andy: *"I have an open question with my accountant about whether a prepaid pack is invoiced at
sale or at redemption."*

The prototype currently states **tax at sale** in the cart copy — *"GST was accounted for when you
bought the pack — this order adds nothing."* That is a position, and it is the one I would default
to, but it is not mine to settle.

### The flag

`platform_config.pack_tax_point`, enum `('sale', 'redemption')`, default `'sale'`.

| | `sale` | `redemption` |
|---|---|---|
| At purchase | Tax invoice for the pack, GST on `price_paise` | Receipt for an advance. **No invoice number consumed** |
| At redemption | No invoice, no tax | Tax invoice per order, GST on `meal_value_paise` |
| Cart copy | "GST was accounted for when you bought the pack" | "GST is charged on this order" |

### The part that matters more than the flag

**`tax_point` is stamped onto the `meal_pack` row at the moment of sale**, and every downstream
decision reads the pack's stamp, never the live config.

Without that, flipping the config would retroactively change the treatment of packs already sold —
packs sold under "tax at sale" would start issuing invoices at redemption, having already been
invoiced. **A config flip must change the future and not rewrite the past.** This is the single
most important line in this section.

Consequence Andy should know: flipping the flag does **not** migrate existing packs. If the
accountant's answer arrives after packs have been sold, packs sold before the flip keep their
original treatment, and that is deliberate — the alternative is reissuing tax documents.

### Both paths are tested

Not "the default is tested and the other is a branch nobody runs." Both, including the invoice
sequence, because the failure mode is consuming an invoice number in a mode that should not
consume one — and `invoice_sequence` numbers are not recoverable.

**No pack is sold in production until Andy confirms.** Enforced, not remembered: the offer
`is_active` stays false on production, and `check:config` gains an assertion that production has
no active pack offer while `E21` is unconfirmed.

---

## 5. The ledger — money in, food out, counted once

Andy: *"a redeemed meal must never appear as revenue a second time. Show me how the ledger
balances across sale, redemption, cancellation and expiry."*

**A pack sale is not revenue.** It is cash received against an obligation to serve food. Treating
it as revenue at sale and again at redemption is precisely the double-count, so the sale credits a
**liability**, and revenue is recognised only when a meal is actually spent.

New account type `deferred_revenue`, new account `platform:deferred_revenue:meal_packs`.
All postings go through `post_ledger_transaction` — the existing function that refuses an
unbalanced posting — so none of this is a new mechanism.

Worked at `tax_point = 'sale'`, a ₹3,000 pack of 10 meals, GST-exclusive at 5%:

**Sale** — cash in, obligation created, tax due now
```
Dr  provider:razorpay:clearing        315000
    Cr  platform:deferred_revenue:meal_packs   300000
    Cr  platform:tax_payable:cgst                7500
    Cr  platform:tax_payable:sgst                7500
```

**Redemption** — one meal, food served. Revenue recognised. **No tax entry: it was taken at sale.**
```
Dr  platform:deferred_revenue:meal_packs  30000
    Cr  platform:revenue                       30000
```

**Cancellation before cutoff** — the meal comes back, so the recognition reverses exactly
```
Dr  platform:revenue                      30000
    Cr  platform:deferred_revenue:meal_packs   30000
```
and `meals_remaining` increments in the same transaction. The ledger and the balance move together
or neither moves.

**Expiry** — unused meals. The obligation ends; the money is kept as breakage
```
Dr  platform:deferred_revenue:meal_packs  X
    Cr  platform:revenue:breakage              X
```

At `tax_point = 'redemption'` the tax legs move from the sale to the redemption, and the sale
credits the full ₹315,000 to deferred revenue. Nothing else changes.

### The invariant, which is the actual answer

> **At any instant, the balance of `platform:deferred_revenue:meal_packs` equals
> `sum(meals_remaining × meal_value_paise)` over every live pack.**

One number, checkable at any moment, that is false the instant a meal is counted twice, lost, or
recognised without being spent. It becomes a test that runs after every path and every
combination of paths — sale, redeem, cancel, redeem again, expire — and a nightly reconciliation
alongside the existing ledger checks.

**Integer paise, honestly.** ₹3,000 over 10 meals divides evenly; a ₹5,600 pack over 20 does not
always. `meal_value_paise` is stored per pack and the **remainder is distributed across the first
N meals** so the parts sum exactly to the price. Never a float, and never a rounding that leaves
the invariant off by a paisa — an invariant that is "nearly" true is not one.

---

## 6. The remaining requirements

**A pack is the parent's.** `meal_pack.customer_user_id` is the only owner; `recipient_id` lives
on the *redemption*, so one pack covers any of the parent's children and a single plan can mix
them across days. RLS: a parent reads and spends their own packs, full stop.

**Cancellation returns the meal.** Same cutoff rule as a paid order today (`E09-38`), so a parent
does not learn a second set of rules. Guarded by `reversed_at is null` so a double-cancel cannot
return two meals from one redemption.

**No refunds on packs, enforced not stated.** The refund path refuses an `order_group` that
purchased a pack — checked in the Edge Function *and* by a database trigger, so no path reaches
it, including a hand-written `psql` statement. The prototype promises this before purchase; the
enforcement has to be at least as strong as the promise.

**The school switch.** No `meal_pack_offer_school` row means no packs. The API returns an empty
list *with a reason*, and the app renders the designed state — *"Meal packs aren't offered at this
school"* — rather than an empty list, which the prototype is explicit about.

---

## 7. What I need from Andy before building

1. **The schema in §1** — argue with it now rather than after `0068` is applied.
2. **The ledger treatment in §5** — sale as a liability, revenue at redemption, breakage at
   expiry. This is the accounting answer to the double-count question and I would rather it were
   checked by the person with an accountant.
3. **Confirmation that `tax_point` stamped-at-sale is the behaviour wanted** — that flipping the
   flag does not rewrite packs already sold.

Not blocking: the accountant's answer itself. Both paths get built and tested; the flag decides.
