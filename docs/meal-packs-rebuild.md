# Meal packs, rebuilt — the data model and the redemption state machine

`E21`, second attempt. Andy, 2026-09-16: *"The current design is wrong and should be removed or
migrated, not extended."*

**Supersedes `docs/meal-packs-plan.md`**, which describes the shipped-and-dark design being torn
out. That file stays until this one is approved, then it moves to the archive with a line saying
what replaced it — a design document that disagrees with the code is worse than none.

**Nothing here is built.** This exists to be argued with, because the feature takes ₹3,150 from a
parent and gives back a promise.

Two corrections arrived from Andy on 2026-09-16 while this was being written, and both are folded
in rather than appended: **"This Week" falls back to the featured dish** rather than showing
nothing (§7), and **the live ordering path is covered by tests before it is touched** (§11), which
changes what the first commit is.

**The five open questions were answered the same day** and this document is rewritten around the
answers, not annotated with them. Three of the four rulings went against what I proposed, so where
that changes the mechanism it is written as the mechanism now — §12 keeps the record of what was
chosen and what it costs, because a decision without its reasoning gets accidentally reversed.

| | Ruled |
|---|---|
| Bonus accounting | **Bonus items carry no value.** No revenue is ever reversed |
| School scope | **Selected school only, both ways.** A pack is bought at a school and spent there |
| Coverage order | **Cheapest first.** The pack covers the least expensive lines |
| Cancellation | **The item returns to the pack** |

---

## 0. What is actually on production, checked before proposing to delete anything

Read from `bdamkuugbqjajbndjoxn` on 2026-09-16, no writes:

| | |
|---|---|
| `environment` | `production` |
| **`meal_packs_confirmed`** | **`true`** |
| `meal_pack_offer` rows | **0** (0 active) |
| `meal_pack_offer_school` rows | **0** |
| `meal_pack` rows | **0** |
| `meal_pack_redemption` rows | **0** |
| `order_group` rows of kind `meal_pack_purchase` | **0** |
| `ledger_entry` against any `deferred_revenue` account | **0** |
| migration ledger | `0084`, clean |

**The brief's premise is wrong in one place and right in the place that matters.** Andy wrote
"Packs are still dark on production (`meal_packs_confirmed = false`)". That flag is `true` — it was
flipped at some point after `0075` landed and nothing in the queue records it. What the flag
actually gates is narrow: the `refuse_live_pack_offer_before_confirmation` trigger, which refuses
to let an offer go `is_active` on production. With it `true`, that guard is **off**.

It has cost nothing, because the thing the guard protects has never happened: **there are zero
offers, so there is nothing to activate, nothing sold, and no ledger entry anywhere.** The
conclusion Andy drew is correct on the evidence that matters — *there is no live pack data to
preserve* — and I am deleting on the strength of the row counts, not the flag.

Two consequences worth stating:

1. **A live pack offer could have been created on production at any time since the flip**, by
   anyone reaching `/admin/packs`. It wasn't. The new build reinstates a guard of the same shape
   (§9), and I would rather Andy knew the old one was open than found out later.
2. **`meal_packs_confirmed` becomes meaningless under this design.** It existed to hold packs back
   until the GST tax point was settled, and Andy has now settled it: tax at sale, always (§5).
   The column and its trigger are replaced by a simpler, permanent guard.

---

## 1. What goes, what stays

Thirteen migrations, three Edge Functions, nine screens and four shared modules implement the old
design. It is not a subset of the new one — it is a different product:

| Old | New |
|---|---|
| A **meal** = *N* items including one from a required category | **One item is one item.** No cap, no category, no exclusion |
| No bonus concept at all | Bonus items, earned inside a window |
| `pack_tax_point` flag — sale *or* redemption, stamped per pack | **Tax at sale, always.** No flag |
| A **planner**: pick days ahead, confirm a plan, spend then | **The cart.** Spend at checkout like any other order |
| `unique (order_id)` — one meal per order, ever | Many items per order, possibly across packs |
| Balance decremented at plan confirmation | **Reserved** at checkout, **decremented** at the webhook |
| Whole-cart eligibility — a cart qualifies or it doesn't | **Partial redemption.** Pack covers what it can, cash covers the rest |

`unique (order_id)` and the planner are the two that make this a replacement rather than an edit.
The first makes partial redemption *unrepresentable*; the second is a whole screen flow with its
own idempotency table for a journey that no longer exists.

### Dropped

- Tables `meal_pack_offer`, `meal_pack_offer_school`, `meal_pack`, `meal_pack_redemption`,
  `meal_pack_plan`; view `meal_pack_redemption_money`.
- Functions `meal_pack_surface`¹, `meal_pack_offers_for_school`¹, `meal_pack_balances`,
  `spend_meal_pack`, `confirm_meal_pack_plan`, `buy_meal_pack`, `activate_paid_meal_pack`,
  `check_meal_pack_ledger_invariant`, `refuse_live_pack_offer_before_confirmation`.
- Enums `pack_tax_point`, `meal_pack_status` (recreated with different values).
- Column `platform_config.meal_packs_confirmed`.
- Edge Functions `confirm-pack-plan`, `buy-meal-pack`, `admin-pack-offer` (rewritten, not edited).
- `apps/mobile/src/packs/` — `PackPlanScreen`, `PlanDayScreen`, `PlannerContext` deleted outright;
  `PacksScreen`, `PackDetailScreen`, `MyPacksScreen`, `PackRedemptionStrip` rebuilt.
- `packages/shared/src/cart/pack-eligibility.ts`, `pack-plan.ts`.
- `scripts/test/meal-pack-concurrency.test.mjs`, `pack-eligibility-agreement.test.mjs`,
  `supabase/tests/meal_packs.test.sql`, `meal_pack_ledger.test.sql`, `pack_revenue_scope.test.sql`.

¹ **Recreated with identical signatures**, deliberately — see §10.

### Kept

- `order_group_kind` value `meal_pack_purchase`, and `ledger_account_type` value
  `deferred_revenue` with its account `platform:deferred_revenue:meal_packs`. Both are correct and
  both are enum values, which Postgres cannot remove without rewriting the type.
- The permission `meal_packs.manage`, already granted on production.
- `MealPackSurfaceContext`'s **shape and its fail-closed rule**. The data changes; the property
  that unknown renders as nothing is exactly right and is reused verbatim.
- `settle_payment`'s structure, and the discipline that a pack becomes spendable in the same
  transaction that takes the money.

---

## 2. The data model

Five tables. An **offer** is a product the admin configures; a **pack** is a thing a parent owns;
a **redemption** is one fact about one order line, in one of three states.

```sql
-- What the admin sells. All prices GST-EXCLUSIVE, like every menu price (non-negotiable #7).
meal_pack_offer
  id                 uuid    primary key
  name               text    not null          -- "Pack 1"
  net_price_paise    bigint  not null          -- 300000  (₹3,000 ex-tax)
  items_count        int     not null          -- 20
  bonus_items_count  int     not null          -- 2   (may be 0)
  bonus_window_days  int     not null          -- 30  (may be 0 when bonus_items_count = 0)
  validity_days      int     not null          -- 60
  is_active          boolean not null default false
  sort_order         int     not null default 0
  created_at, updated_at timestamptz
  check (net_price_paise > 0)
  check (items_count > 0)
  check (bonus_items_count >= 0)
  check (validity_days > 0)
  check (bonus_window_days >= 0)
  -- A bonus window with no bonus items, or bonus items with no window, is a misconfiguration
  -- that reads as a promise to a parent. Refuse it at the column, not in a screen.
  check ((bonus_items_count = 0) = (bonus_window_days = 0))
  check (bonus_window_days <= validity_days)   -- a window that outlives the pack promises nothing

-- The per-school switch. ABSENCE MEANS OFF. A school is not offered packs unless a row says so.
meal_pack_offer_school
  offer_id   uuid not null references meal_pack_offer on delete cascade
  school_id  uuid not null references school
  is_enabled boolean not null default true
  created_at timestamptz
  primary key (offer_id, school_id)

-- A pack a PARENT owns. Never a child's — see §8.
meal_pack
  id                   uuid    primary key
  customer_user_id     uuid    not null references app_user   -- the only owner
  school_id            uuid    not null references school     -- bought here, spent here (§8)
  offer_id             uuid    not null references meal_pack_offer
  order_group_id       uuid    not null references order_group   unique
  name_snapshot        text    not null      -- the offer's name at the moment of sale
  price_paid_paise     bigint  not null      -- 300000, ex-tax. THE deferred-revenue numerator
  cgst_paise           bigint  not null      --   7500
  sgst_paise           bigint  not null      --   7500

  -- VALUED items: what the money bought. The only ones the ledger knows about.
  items_original       int     not null      -- 20. Never changes, ever. The bonus test reads this
  valued_remaining     int     not null      -- decremented ONLY at settlement

  -- BONUS items: a free gift, worth nothing in the books (§5). Deliberately separate columns
  -- rather than a larger items_total, so that no arithmetic anywhere can mix the two.
  bonus_items          int     not null      -- snapshot of the offer's bonus_items_count
  bonus_remaining      int     not null default 0   -- 0 until granted, then bonus_items
  bonus_window_ends_at timestamptz not null  -- purchased_at + bonus_window_days
  bonus_granted_at     timestamptz           -- null until earned; never un-set

  items_reserved       int     not null default 0   -- held by carts not yet paid for
  items_remaining      int     generated always as (valued_remaining + bonus_remaining) stored

  purchased_at         timestamptz not null
  expires_at           timestamptz not null  -- purchased_at + validity_days
  status               meal_pack_status not null default 'pending'
  correlation_id       uuid    not null
  created_at, updated_at timestamptz
  check (valued_remaining between 0 and items_original)   -- backstop, not the mechanism (§4)
  check (bonus_remaining  between 0 and bonus_items)
  check (items_reserved   >= 0)
  check (items_reserved <= valued_remaining + bonus_remaining)   -- backstop for the reserve guard
  -- No bonus item exists before the bonus is earned. (The converse is not a rule: a granted
  -- pack legitimately reaches bonus_remaining = 0 by spending them.)
  check (bonus_granted_at is not null or bonus_remaining = 0)

-- One row per (order line, pack). Append-only: a state column, never a delete.
meal_pack_redemption
  id             uuid primary key
  meal_pack_id   uuid not null references meal_pack
  order_group_id uuid not null references order_group    -- what releases/confirms it
  order_id       uuid not null references "order"
  order_line_id  uuid not null references order_line
  items          int  not null                           -- how many of that line's qty this covers
  valued_items   int  not null                           -- of those, how many were VALUED items
  bonus_used     int  not null                           -- and how many were free bonus items
  state          pack_redemption_state not null default 'held'
  held_at        timestamptz not null default now()
  settled_at     timestamptz          -- confirmed or released at
  reversed_at    timestamptz          -- set when a confirmed redemption is given back
  reversal_reason text
  correlation_id uuid not null
  check (items > 0)
  check (items = valued_items + bonus_used)   -- the split is recorded, never recomputed later
  unique (order_line_id, meal_pack_id)   -- one line may span two packs; not the same pack twice

-- The clock's work, recorded. One row per pack, written by the expiry sweep (§6).
meal_pack_expiry
  meal_pack_id   uuid primary key references meal_pack
  breakage_paise bigint not null   -- valued items only; bonus items are worth nothing
  items_forfeit  int    not null   -- what a parent would say they lost: valued + bonus
  valued_forfeit int    not null   -- what the ledger saw
  expired_at     timestamptz not null default now()

create type meal_pack_status         as enum ('pending','active','exhausted','expired');
create type pack_redemption_state    as enum ('held','confirmed','released','reversed');
```

**No child data anywhere.** The old `meal_pack_redemption.recipient_id` is gone. The order already
knows which child it is for; the pack does not need to, has no screen that shows it, and every
column it does not have is a column that cannot leak (non-negotiable #4).

**`items_reserved` is a counter, and `meal_pack_redemption` is the truth.** The invariant
`items_reserved = Σ items where state = 'held'` is asserted by a test and by the nightly
reconciliation, so a drift is found rather than believed.

---

## 3. The redemption state machine

A redemption is one fact — *this order line drew N items from this pack* — passing through states.
Nothing else in the system needs a state machine, because there is nothing else that can be
half-true.

```
                            ┌──────────────────────────────────────────┐
                            │  cash due == ₹0  (pack covers the cart)   │
                            │  — no payment to wait for, so straight on │
                            └───────────────────┬──────────────────────┘
                                                │
   create_checkout                              ▼
   ─────────────►  ( none ) ──reserve──►  held ──confirm──►  confirmed ──reverse──► reversed
                                           │                     ▲                     │
                                           │                     │                     │
                                           │              settle_payment          cancel-order
                                           │            (Razorpay webhook)        before cutoff
                                           │
                                           └──release──►  released
                                                  ▲
                          ┌───────────────────────┴────────────────────────┐
                          │ payment.failed  ·  parent abandons checkout    │
                          │ ·  sweep, once Razorpay confirms the order is  │
                          │    dead (§4.4) — never on a clock alone        │
                          └────────────────────────────────────────────────┘
```

| Transition | `items_reserved` | `valued_remaining` | `bonus_remaining` | Ledger |
|---|---|---|---|---|
| **reserve** | `+n` | — | — | — |
| **confirm** | `−n` | `−valued` | `−bonus` | Dr deferred / Cr revenue, by §5's formula |
| **release** | `−n` | — | — | — |
| **reverse** | — | `+valued` | `+bonus` | Dr revenue / Cr deferred |

Every column moves in one transaction or none of them move. **The balance a parent is told they
have is never changed by anything that has not yet happened**, which is the whole point of `held`
being a separate state rather than a decrement with a note attached.

`valued` and `bonus` are the split recorded on the redemption row at confirm time, and **reverse
gives back exactly what was taken** — it reads the row rather than recomputing, so a cancellation
cannot turn a free bonus item into a valued one or the other way round.

### Reserve is not "decrement early"

Andy: *"The pack balance must NOT be decremented at checkout time — reserve it."* So:

- `items_remaining` is what the parent **owns**. It changes when money moves, and at no other time.
- `items_reserved` is what is **spoken for** by a checkout in flight.
- What a new cart may draw on is `items_remaining − items_reserved`. That subtraction is the
  spendable balance, and it is the thing the atomic guard tests.

### The one exception, and why it is not really one

Cash due of ₹0 means the pack covers the whole cart. There is no Razorpay order, no payment, and
therefore **no later event that could ever confirm it**. So `create_checkout` reserves and confirms
in the same transaction and the order goes straight to `paid`. It is the same two statements in the
same order; they just both run now. There is no second code path to keep in step.

A ₹0 order **consumes no invoice number.** The tax was charged and documented at the pack sale, so
there is no taxable supply here to document, and `invoice_sequence` numbers are not recoverable
(`D14`). It does still get a pickup code and does still appear on the kitchen board — the kitchen
does not care how it was paid for.

---

## 4. Concurrency — the guarantee, and where it actually lives

Andy: *"Decrement with a single atomic statement … never read-then-write. Two devices checking out
simultaneously must not both succeed against the same last item."*

### The race is on the reservation, so that is where the statement goes

This is the one place I am departing from the literal shape Andy wrote, and it is because the
reservation moved. Two devices racing are both at **checkout**; only one of them can ever reach the
webhook for a given order. So:

```sql
-- RESERVE. The contended statement. One shot, no prior SELECT.
update meal_pack
   set items_reserved = items_reserved + p_items
 where id = p_pack_id
   and status = 'active'
   and expires_at > now()
   and valued_remaining + bonus_remaining - items_reserved >= p_items   -- the whole guarantee
returning valued_remaining + bonus_remaining - items_reserved as spendable_after;
```

```sql
-- CONFIRM, from settle_payment. Never contended: one webhook per order group.
--
-- VALUED ITEMS ARE SPENT FIRST, and the split is computed inside the statement rather than by a
-- SELECT beforehand — so this stays one statement even though it is never raced. `least()` does
-- the whole job: take what valued items there are, and only then reach into the bonus.
update meal_pack
   set valued_remaining = valued_remaining - least(p_items, valued_remaining),
       bonus_remaining  = bonus_remaining  - (p_items - least(p_items, valued_remaining)),
       items_reserved   = items_reserved   - p_items
 where id = p_pack_id
   and items_reserved >= p_items
   and valued_remaining + bonus_remaining >= p_items
returning valued_remaining, bonus_remaining,
          least(p_items, valued_remaining)                  as valued_spent,
          p_items - least(p_items, valued_remaining)        as bonus_spent;
```

```sql
-- RELEASE.
update meal_pack
   set items_reserved = items_reserved - p_items
 where id = p_pack_id and items_reserved >= p_items;
```

**Valued first is not arbitrary.** Bonus items can normally only be reached once every valued item
is gone — that is what earns them. The order matters in exactly one situation: a cancellation
returns a valued item to a pack that has already been granted its bonus. Spending valued first
there recognises revenue sooner and leaves only worthless items to be forfeited at expiry, which
is the conservative answer and the one that needs no entry when the pack dies.

Zero rows returned from the reserve means refused, and the caller tells the parent the pack covers
fewer items than it did a moment ago — **before** checkout, never after.

**Why this is safe at READ COMMITTED**, which is what PostgREST and our Edge Functions run at: the
second transaction updating the same row blocks on the first one's row lock, and when it unblocks
it **re-evaluates its `WHERE` against the committed value**, not the one it read. The loser sees
`items_reserved` already raised and matches zero rows. This is the same argument the old design
relied on; what changed is the column it is made about.

The two `check` constraints are **backstops, not the mechanism.** If either fires, the mechanism
has a bug and I want the write to abort loudly rather than proceed.

### Several packs in one cart

Rule 4: earliest expiry first. A cart of 5 items against packs of 2 and 3 spans both.

```sql
select id, valued_remaining + bonus_remaining - items_reserved as spendable
  from meal_pack
 where customer_user_id = p_user
   and school_id = p_order_school_id   -- bought here, spent here (§8)
   and status = 'active'
   and expires_at > now()
   and valued_remaining + bonus_remaining > items_reserved
 order by expires_at asc, id asc      -- deterministic, and the same order everywhere
   for update;
```

**The lock order is the deadlock prevention**, and it is the same line as the business rule — the
pack that expires soonest is spent first. Correctness and concurrency control being one line is the
version least likely to drift. Two different parents never contend at all; the same parent on two
devices takes the same rows in the same sequence, so one waits rather than deadlocking.

### Which cart items the pack covers — **cheapest first**

**Ruled 2026-09-16.** Covered lines are chosen by **unit price ascending, then line id** for
determinism. A cart of a ₹250 main and a ₹40 drink against one remaining item covers the drink;
the parent pays ₹250 + GST.

I recommended the opposite and was overruled, which settles it. What follows from it is a copy
problem rather than an engineering one, and it is the cart's job to solve: **the cart names the
covered lines explicitly, before Place order.** A parent who expected the main to be covered must
see that it is not while they can still change the cart — not discover it on the total. §7.

**One consequence, recorded once and then left alone.** Cheapest-first, no price cap, no refunds
and a hard expiry compose: a ₹3,000 pack spent entirely on ₹40 drinks returns ₹800 of food. Each
of those four rules is deliberate and Andy has confirmed each separately. The combination is worth
writing down because nobody chose it as a combination, and because it is the shape of thing a
parent writes a support email about.

### Releasing a reservation asks Razorpay; it does not guess from a clock

A parent who abandons checkout sends nothing. Something must release the hold, or their own meals
are stranded from them.

**A TTL alone is wrong here**, and the failure is asymmetric. Release too early and a payment that
is genuinely in flight settles against a pack that no longer has the balance — a parent who paid
the cash portion expecting the pack to cover the rest. Release too late and a parent cannot spend
meals they own. The second is recoverable by waiting; the first is a support ticket about money.

So the sweep reuses the discipline the settlement path already has (`E06-37`): **for each held
reservation whose group is still `pending_payment` and older than 30 minutes, fetch the order from
Razorpay.** Release only when Razorpay says it is dead — no successful payment and the order
`attempted` or expired. A 24-hour backstop releases anything the API could not be asked about, so
nothing is stranded for ever, and every backstop release writes an `ops_alert` because it means a
question went unanswered.

Runs from `ops-monitor.yml`, the existing GitHub Actions scheduler. There is no `pg_cron` on this
project — checked, not assumed; the installed extensions are `btree_gist`, `citext`,
`pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`.

---

## 5. Money, tax, and the ledger

### Tax at the point of sale, and only there

5% on the ex-tax price, CGST 2.5% + SGST 2.5%, computed by the existing `halfUp` identity from
`docs/gst-invoicing.md` §6.2 — no float touches this (non-negotiable #3).

```
₹3,000 ex-tax  =  300000 paise
CGST = halfUp(300000 × 250, 10000) =  7500
SGST = halfUp(300000 × 250, 10000) =  7500
                                    ───────
parent pays                          315000  =  ₹3,150     ✓ matches the brief
```

A redemption carries **₹0 and no GST**. A partially covered order is taxed normally on the
uncovered lines only, per line, per component — so `order.subtotal_paise`, `tax_cgst_paise` and
`tax_sgst_paise` hold the **cash** amounts, `order_group.payable_paise` is the cash due, and
`settle_payment`'s existing `L7` amount-mismatch guard keeps working unchanged.

### A pack sale is a liability, not revenue

```
SALE  (in settle_payment, same transaction as the order group becoming paid)
  Dr  provider:razorpay:clearing                 315000
      Cr  platform:deferred_revenue:meal_packs          300000
      Cr  platform:tax_payable:cgst                       7500
      Cr  platform:tax_payable:sgst                       7500
```

### Recognition, stated so that integers make it exact

**Ruled 2026-09-16: bonus items carry no value.** ₹3,000 buys 20 items and always did; the 2 bonus
items are a free gift, recognised at nil. Nothing is ever reversed, no revenue is restated, and
nothing crosses a period boundary. `items_original` is the denominator for the life of the pack and
**never changes** — which is why the schema has `valued_remaining` and `bonus_remaining` as separate
columns rather than one larger total. There is no arithmetic anywhere that could mix them.

Andy's invariant is *deferred balance = `items_remaining × (price_paid / items_total)`*. Taken
literally as a stored per-item constant it cannot hold in integer paise — ₹3,000 over 20 divides
evenly, but ₹5,000 over 40 will not for every price the admin can type, and an invariant that is
*nearly* true is not one. It holds **exactly**, in integers, with no stored per-item value, if the
balance is defined as a function rather than accumulated:

```sql
create function meal_pack_deferred_paise(p meal_pack) returns bigint
  immutable
as $$ select half_up(p.price_paid_paise * p.valued_remaining, p.items_original) $$;
```

Every event posts **the difference between this function before and after**, and never an amount
computed any other way:

| Event | Ledger posting |
|---|---|
| Redeem *n* items | `Dr deferred / Cr revenue` of `deferred(before) − deferred(after)` |
| **Grant the bonus** | **Nothing.** Free items do not appear in the books |
| **Spend a bonus item** | **Nothing.** `deferred` is unchanged, because `valued_remaining` is |
| Reverse a redemption | `Dr revenue / Cr deferred` of `deferred(after) − deferred(before)` |
| Expire | `Dr deferred / Cr revenue:breakage` of `deferred(before)`, then `valued_remaining := 0` |

Because every posting is a difference of the same function, the balance cannot drift. The last
**valued** item of a pack always lands on exactly zero, whatever the arithmetic on the way there.

**The invariant, which is the actual answer:**

> At any instant, `balance(platform:deferred_revenue:meal_packs)` equals
> `Σ half_up(price_paid_paise × valued_remaining, items_original)` over every pack with
> `status in ('active','exhausted')`.

One number, checkable at any moment, false the instant a valued item is counted twice, lost, or
recognised without being spent. It runs as a pgTAP assertion after **every** path and every
combination of paths, and nightly beside the existing `assert_ledger_integrity()`.

It holds **continuously, including between a pack expiring and the sweep noticing** — an expired
pack is still `active` with its balance intact until the sweep moves it, and the sweep moves the
status, the items and the ledger in one transaction. The sweep is bookkeeping being timely, not
correctness being restored.

The worked path, end to end, every figure an integer, no posting anywhere for the bonus:

| Step | valued rem. | bonus rem. | deferred | posting |
|---|---|---|---|---|
| Sale | 20 | 0 | 300000 | Cr deferred 300000 |
| Spend 20 items | 0 | 0 | 0 | Cr revenue 300000, across 20 postings |
| **Bonus granted** | 0 | **2** | 0 | **none** |
| Spend the 21st | 0 | 1 | 0 | **none** |
| Spend the 22nd | 0 | 0 | 0 | **none** |
| | | | | **total revenue 300000** ✓ |

**What this costs, stated once so it is on the record.** Revenue per *served meal* is no longer
constant: a parent who earns the bonus is served 22 meals for ₹3,000 while the books recognise
₹150 per meal across only 20 of them. That is the correct treatment of a gift and it is what was
ruled — but the cost of food served is real, so **margin per meal on a bonus-earning pack is lower
than the revenue line suggests**, and a report reading revenue-per-order will overstate it for
those two orders. Worth knowing before anyone reads a pack report and draws a conclusion.

### The bonus is granted by arithmetic, not by a job

Evaluated inside the same transaction as the confirm that empties the pack:

```
if bonus_granted_at is null
   and bonus_items > 0
   and valued_remaining = 0          -- every item the money bought has been served
   and now() <= bonus_window_ends_at
then  bonus_remaining  := bonus_items
      bonus_granted_at := now()
      -- and nothing is posted to the ledger
```

No scheduled job, no window to miss, no pack that earned a bonus and is waiting for a cron. A
window that closes unearned needs no action at all — the condition simply stops being true.

A reversal that lifts `valued_remaining` back above zero after a grant does **not** un-grant it:
`bonus_granted_at` is set once and the guard reads it, so a cancel-and-reorder cannot mint bonus
items twice. Nor can a cancellation *create* a bonus opportunity that had closed — the guard is a
conjunction, and `now() <= bonus_window_ends_at` is checked at the moment of the grant, not at the
moment of the order being cancelled.

### No refunds, enforced rather than promised

The refund path refuses an `order_group` of kind `meal_pack_purchase` — in the Edge Function **and**
in a database trigger, so no route reaches it, including a hand-written `psql` statement. The
screen promises this before purchase; the enforcement has to be at least as strong as the promise.

---

## 6. Expiry

`expires_at = purchased_at + validity_days`. Unused items are forfeited; the money is kept as
breakage. Bonus items inherit the pack's expiry and extend nothing — there is no column that could
express otherwise, which is the strongest form that rule can take.

Enforced in two places, both server-side:

- `expires_at > now()` in the reserve statement, so an expired pack cannot be drawn on even if a
  stale app thinks it can.
- The service date of every covered line must be `<= expires_at::date`, so a parent cannot reserve
  today against a meal the pack will not be alive to cover.

The sweep (`expire_meal_packs()`, from `ops-monitor.yml`) takes every `active` pack past its
`expires_at`, posts its breakage, writes `meal_pack_expiry`, sets `valued_remaining := 0`,
`bonus_remaining := 0` and `status := 'expired'` — one transaction per pack.

**Only valued items produce a breakage entry.** Forfeited bonus items are worth nothing and post
nothing, so a pack that expires holding only bonus items posts no ledger transaction at all — its
deferred balance was already zero. `meal_pack_expiry.items_forfeit` records both counts anyway,
because "3 items forfeited" is what a parent would say and the books saying ₹0 is not a
contradiction to be explained away later.

---

## 7. Screens

| Screen | What changes |
|---|---|
| **Home → "This Week"** | Pack offers when there are any; **otherwise the featured dish exactly as it is today**. See below — this is a swap inside one section, not a section that comes and goes |
| **Pack detail** | What you get, **price including tax** (₹3,150, with the ₹3,000 + ₹150 GST split shown), the bonus rule in a sentence a parent reads once — *"Use all 20 items within 30 days and we'll add 2 more"* — the expiry date, **the school it is for**, and "no refunds". Buy |
| **Profile → My Meal Packs** | Every pack, **each naming its school**. Each opens to purchase date, items total, items remaining, expiry, **bonus status** — earned / *N* items in *M* days / window closed — and the orders that drew from it, by order number and date. No child names |
| **Cart** | Covered lines and cash due, separated and **each covered line named**, before Place order. See below — cheapest-first makes this the screen that carries the ruling |

### The cart has to carry cheapest-first, in words

Cheapest-first (§4) means the pack routinely covers the line a parent cares least about. That is
now the rule, so the cart's job is to make it impossible to be surprised by:

```
Your cart                                    Amity International

  Butter chicken & rice          ₹250.00     ← paid in cash
  Fresh lime soda                 covered    ← 1 item from Pack 1

  Covered by your pack                      1 item  (3 left after this)
  To pay                                   ₹250.00
  GST 5%                                    ₹12.50
  ─────────────────────────────────────────────────
  Total to pay                             ₹262.50
```

Two rules for this block, both of which exist because of the ruling rather than in spite of it:

- **Every covered line is named**, never summarised as a count. "1 item covered" next to a ₹262.50
  total is exactly the surprise to avoid.
- **It renders before Place order**, not on the confirmation. Andy: *"If the pack partly covers
  the cart, say so before checkout, not after."*

When the pack covers everything, the cash block is absent and the button reads what it does —
there is no payment step to promise.

### "This Week" falls back; it never empties

Corrected by Andy, 2026-09-16, reversing the brief's original instruction: *"fall back to the
existing featured-dish section … it must keep working exactly as it does now whenever there are no
purchasable pack offers for this parent — whether because no offers exist, none are active, or
packs are switched off for their school. Never an empty section, and never a layout shift."*

So the section has one slot and two occupants:

```
This week at <school>
├── purchasable offers for this parent?  ──yes──►  the offers
└──────────────────────────────────────  ──no───►  FeaturedDish, untouched
```

All three reasons collapse to the same answer, which is the point: *are there offers this parent
can buy right now*. No offers exist, none is `is_active`, none is enabled for their school, the
read failed, the read has not returned — every one of them renders the featured dish. There is no
fourth state and no code path that can produce an empty section.

**`FeaturedDish` is not touched.** It keeps its props, its tests and its markup; the only change
around it is which branch chooses it. That is deliberate — it is live today and the regression bar
(§11) applies to it.

**Never a layout shift means resolving before first paint, not swapping after it.** Home already
skeletons while the menu loads; the pack answer joins that same gate, so the first paint of the
section is already the right occupant. `MealPackSurfaceContext.loading` must therefore be *waited
on* rather than treated as "no" — a change from today, where unknown renders nothing. Unknown still
**decides** as no (`canBuy: false` on any failure is kept exactly as it is); what changes is that
Home does not paint the section until it has an answer, so no parent ever watches offers replace a
dish. A test asserts the section is rendered exactly once with one occupant, and never re-rendered
with the other.

`hasBalance` and `canBuy` stay separate, for the reason the old design got right: `canBuy` is a
business decision, `hasBalance` is a **debt**. Switching a school off must stop the first and must
never touch the second — a parent with meals they paid for keeps every screen that spends them.
Note that this fallback is keyed on **`canBuy` only**: a parent holding a balance at a school that
has stopped selling sees the featured dish here and reaches their meals from Profile and the cart,
which is where a debt belongs — Home is a shop window.

---

## 8. A pack is the parent's, at one school

`meal_pack.customer_user_id` is the only owner. RLS: a parent reads and spends their own packs,
full stop; there is no policy that widens to a class or a guardian relationship.

**Ruled 2026-09-16: selected school only, both ways.** An offer is purchasable when packs are on
for the school currently selected in the app, and `meal_pack.school_id` is stamped from that school
at the moment of sale. A pack bought at Amity covers Amity orders and nothing else.

Two things follow that are easy to get wrong, so they are written into the design rather than left
to a screen:

**One pack still covers several children — at that school.** `order_line` is the unit and the pack
never learns which child ate; a parent with two children at Amity draws both from one balance. The
restriction is the school, never the child.

**A cart can produce orders at two schools, and this is the case the design has to survive.**
`create_checkout` groups by `(recipient_id, service_date, break_time_id, school_id, kitchen_id,
city_id)`, so a parent with children at Amity and Gem places **one checkout containing two orders
at two schools**. Because a reservation is per `order_line`, this falls out correctly with no
special case: the Amity pack covers the Amity lines, the Gem lines are cash, and the cart shows
both. A design keyed on the order *group* would have had to choose a school for the whole
checkout, and would have been wrong for this parent.

**`hasBalance` stays independent of `canBuy`, and is now per school.** Switching packs off at
Amity stops the offers appearing and **does not touch a pack already bought there** — the parent
keeps every screen that spends it until it is empty or expired. That was the old design's one
genuinely right call (`E21-31`) and the ruling does not disturb it: the restriction is *which
school's orders a pack covers*, never *whether a paid-for pack still works*.

The visible cost, which Andy accepted when choosing this: **a parent with children at two schools
watches the offers appear and disappear as they switch schools**, and holds two balances rather
than one. My Meal Packs therefore names the school on every pack — without it, two packs with
different balances and no stated reason is a support ticket.

---

## 9. The production guard, replacing `meal_packs_confirmed`

The old guard asked a question that is now answered, and it was `true` on production anyway (§0).
The new one asks the question that stays true for ever:

> **An offer may not go `is_active` on production unless a person with `meal_packs.manage`
> did it through `/admin/packs`.**

A trigger refuses the transition into `is_active` when the session is the service role and the
environment is `production` — so a migration, a seed, a script and a `psql` statement all fail,
and the admin screen is the only way through. It is the same shape as the old trigger and a
narrower claim, which is why it does not need a flag anyone has to remember to flip.

---

## 10. Deployment order

Andy: *"migrations and Edge Functions first and backwards-compatible, so app clients on the old
bundle keep working and simply don't see packs. Then the OTA."*

**This holds, and I checked the mechanism rather than assuming it.**
`packages/shared/src/api/meal-packs.ts:71-89` — `fetchMealPackSurface` wraps its RPC in
`try/catch` and returns `{ canBuy: false, hasBalance: false }` on **any** failure, deliberately.
`MealPackSurfaceContext` renders nothing in that state. So an old bundle meeting a changed backend
degrades to "this app has no such concept", which is exactly the required behaviour.

I am not relying on that alone. `meal_pack_surface(p_user_id, p_school_id)` and
`meal_pack_offers_for_school(p_school_id)` are **recreated with identical signatures and return
shapes** over the new tables, so the old bundle gets a correct answer rather than a caught error —
and with zero offers live, that answer is "no packs". The catch is the floor, not the plan.

0. **The characterisation suite over the live ordering path** (§11), green on today's code, before
   any of it is touched. No pack code in this commit.
1. **Migrations `0085`+.** Checked across `main` and all 100+ remote branches: `0084` is the
   highest anywhere, so `0085` is genuinely free. Applied by hand to production with the ledger
   recorded in the same operation (non-negotiable #10).
2. **Edge Functions.** `checkout` (reserve), `settle-from-events` (confirm), `cancel-order`
   (reverse), `admin-pack-offer` (rewritten), `buy-meal-pack` (rewritten).
3. **Nothing is visible yet** — zero offers, so every parent's `canBuy` is false and the guard in
   §9 means an offer can only appear when Andy's admin creates one.
4. **The OTA.** JavaScript only. No new native dependency, no `app.json` change:
   `react-native-razorpay` is already a dependency and already used by `useCheckout`; every new
   screen is React Native and reuses components that ship in the current binary. **If any part of
   the build turns out to need a native change I stop and say so rather than doing it.**
5. **Then** Andy creates the two offers on production through `/admin/packs` and enables the
   schools. That is the moment packs exist for anyone.

Verified against the live URL after promotion, not assumed from a merge (non-negotiable #11).

---

## 11. How it will be proved

### The regression bar comes first, and it is the first commit

Andy, 2026-09-16: *"the thing that must not break is the existing ordering flow — cart, checkout,
the Razorpay webhook and order confirmation — which is carrying real orders right now. Packs are
new and can be imperfect; those paths cannot regress. Cover them in your tests before you touch
them, not after."*

This inverts the order of the work. Packs touch `create_checkout`, `settle_payment`,
`cancel-order`, `CartScreen` and `useCheckout` — every one of which is on the live ordering path,
and every one of which is carrying a parent's real money today.

**So the first commit on this branch adds no pack code at all.** It is a characterisation suite
over the four paths *as they behave right now*, written against the current code and green on the
current code before a line of it changes. Its job is not to describe what the ordering path should
do — it is to make any change in what it *does* fail loudly:

| Path | Pinned before anything is touched |
|---|---|
| **Cart** | Line arithmetic, per-line per-component GST and the half-paise boundary, quantity merge on `moveCartToDate`, the day picker, break-time gating, the allergen strip, every empty and offline state |
| **`create_checkout`** | Every refusal code in `REFUSALS` with its exact hint, idempotent replay returning the first result, `price_changed` and `cutoff_passed`, the request-hash mismatch |
| **`settle_payment`** | Amount mismatch refused (`L7`), duplicate delivery is a no-op, pickup-code allocation and its collision retry, invoice issued in the same transaction, the sale legs balancing |
| **`payments-webhook`** | Raw-bytes-then-HMAC ordering, bad signature still `200`, missing secret distinguishable from bad signature, `23505` replay as `already_seen`, unknown event type ignored not 500 |
| **Order confirmation** | The email renders and sends for a paid order, with no child name, class, section or allergy in it |

Run green, committed, pushed. Only then does the schema change.

Every one of those paths is then **re-run unchanged** after each pack commit. A pack feature that
requires editing one of those assertions is a pack feature that changed the ordering path, and the
edit is the alarm — if one genuinely must change, I will say so in the summary and say why, per
`CLAUDE.md`. Never weakened, never skipped, never deleted to get green.

Two structural choices follow from the bar, and both cost a little to buy separation:

- **Pack logic is additive at every seam, never a rewrite of one.** `create_checkout` gains a
  reservation step that returns immediately when the parent holds no pack; `settle_payment` gains
  one `perform confirm_meal_pack_redemptions(...)` call that returns silently for a group with no
  reservations — the same shape `activate_paid_meal_pack` already uses and the reason that call
  reads cleanly today. A parent with no pack executes the same statements in the same order as
  before.
- **The ₹0-cash path does not bypass the ordering path**, it short-circuits the *payment* path. The
  order is still created by `create_checkout`, still gets a pickup code, still reaches the kitchen
  board. Nothing about a cash order's journey is re-implemented for packs.

### Then the pack tests

- **pgTAP** for the single-transaction properties: refusing at zero spendable, refusing when
  expired, refusing a foreign pack, partial coverage arithmetic, the bonus granted and not
  granted, the `check` constraints firing.
- **The ledger invariant after every path and every combination** — sale, reserve, release,
  reserve, confirm, reverse, confirm again, bonus, expire — asserted as a single equality, not
  as a set of amounts someone wrote down.
- **A real concurrent test**, because pgTAP runs in one transaction and rolls back and therefore
  cannot observe a race. A Node script, two connections, one spendable item, released together:
  exactly one reserves, one is refused, `items_reserved = 1`. Then the N-device version — ten
  connections against three items, exactly three succeed. That third test is the one that catches
  a mechanism that happens to work for two.
- **The webhook path end to end on staging**: reserve, kill the client, deliver
  `payment.captured`, assert the decrement happened exactly once and a replayed event changes
  nothing.
- **No test data on production.** Every write path that must be exercised against production is
  called with a non-existent uuid, which reaches every guard and the 200 shape without touching
  anything real.

---

## 12. The decisions, and what each one costs

Four of the five open questions were answered on 2026-09-16. Recorded here with their cost rather
than only their outcome, because a decision without its reasoning gets accidentally reversed.

| # | Question | Ruling | What it costs |
|---|---|---|---|
| 1 | How the books absorb the bonus | **Bonus items carry no value** | Revenue per *served* meal is not constant — 22 meals served against ₹3,000 recognised over 20. Margin on a bonus-earning pack is lower than the revenue line suggests (§5) |
| 3 | School scope | **Selected school only, both ways** | A parent with children at two schools sees offers appear and disappear as they switch, and holds two balances. My Meal Packs names the school on every pack to make that legible (§8) |
| 4 | Which lines the pack covers | **Cheapest first** | The pack covers the line a parent cares least about. The cart must name every covered line before Place order, or the total is a surprise (§4, §7) |
| 5 | Cancelling a pack-covered order | **The item returns** | None. It is the reading that matches how cash orders already behave |

I recommended the opposite on 1, 3 and 4. Each is Andy's call, each is now the design, and none of
them is re-argued anywhere else in this document — where a ruling changed the mechanism, the
mechanism is written as it now stands.

### Still open, and it is one number

**Question 2 — Pack 2's bonus item count.** *"Pack 2 — ₹5,000 ex-tax, 40 items, bonus window 60
days, validity 90 days"* gives a bonus window and no bonus item count. A window with no items
promises nothing, and `check ((bonus_items_count = 0) = (bonus_window_days = 0))` refuses that
combination on purpose.

**This does not block the build.** It is a row in a table an admin types, not a line of code —
`meal_pack_offer` handles any value including zero. It blocks *Pack 2 existing on production*,
which is step 5 of §10 and Andy's to do anyway. If the answer is that Pack 2 has no bonus, the
window is `0` and the offer is valid.
