# Product metrics

The six numbers that describe whether GrayBag is working. Decided by Andy 2026-08-11, recorded
as `P17`.

**This document is the definition. `E10`'s dashboard renders it; it does not get to reinterpret
it.** A metric that means one thing in a board deck and another in the admin UI is worse than no
metric, because two people will act on the difference without knowing there is one.

Nothing here is built yet. It is written now so that the ledger, the order tables and the
observability work are shaped to carry these, rather than having them retrofitted onto a schema
that cannot answer them.

---

## 0. What we do not report

**Registered users is not a metric.** Under Bubble it read ~400 registered against fewer than 20
orders a week, and it has been misleading for the whole life of the product: it counts people who
got as far as a password box. Password signup did not help it and it is gone (`AR7`, non-negotiable
#7 — email OTP stays).

It may still be *held* — you cannot compute activation without it — but it is a denominator, never
a headline. The distinction matters because a denominator that gets promoted to a headline is
exactly how ~400 came to be quoted.

---

## 1. The six

Every definition below states its **grain**, its **filter**, and the **tables** it comes from. If a
proposed dashboard tile cannot be written in those terms it is not one of these six.

### 1.1 Activated users

> Registered **and** ≥1 paid order, ever.

- **Grain:** one row per `app_user`.
- **Paid** means `order_group.paid_at is not null`. Not `placed_at`, not `status = 'placed'` — a
  draft or an abandoned checkout is not activation, and the gap between the two is the thing worth
  watching during onboarding.
- **Ever**, not "this month". Activation is a state a person enters once and does not leave; the
  time-boxed question is §1.2.
- **Tables:** `app_user`, `order_group`.

Report it as a count and as a rate over registrations. The rate is the onboarding funnel's bottom
line, and `AR7` exists to move it.

### 1.2 Weekly active orderers

> Distinct payers in a week.

- **Grain:** one row per (ISO week, `app_user`).
- **Distinct `order_group.customer_user_id`** where `paid_at` falls in the week. A parent who
  orders five days for two children is **one** active orderer, not ten.
- **Week** is the ISO week in Asia/Kolkata. Fixed here because a metric that silently changes
  timezone at a reporting boundary produces a Monday that is nobody's Monday.
- **Tables:** `order_group`.

### 1.3 Orders per active orderer per week

> §1.2's numerator over §1.2's denominator.

- **An "order"** is one `order_group` — one checkout — not one `order` row and not one line. A
  parent buying Monday-to-Friday for two children in one checkout has ordered **once**. Counting
  `order` rows instead would make this metric move when family size changes, which is not what it
  is for: it measures **frequency of return**, and school-days-per-week is its natural ceiling.
- The five-day ceiling is the point. This is the number that says whether lunch is a habit or an
  occasional thing.
- **Tables:** `order_group`.

### 1.4 AOV — average order value, in paise

- **Per `order_group`**, matching §1.3's unit, so AOV × orders reconciles to revenue without a
  correction factor.
- **`payable_paise`**, GST-inclusive and after `wallet_applied_paise`. That is what was actually
  charged. Two things follow and both are deliberate: a wallet-funded order has a *lower* AOV than
  the food it contained, and a refund does not retrospectively change it (see below).
- **Integer paise throughout** (non-negotiable #3). The mean is computed as
  `sum(payable_paise) / count(*)` in integer arithmetic and rounded once, at the edge, for display.
  Never a float, and never an average of averages.
- **Refunds are reported alongside, not netted in.** A refunded order still happened; hiding it
  inside a lowered AOV loses both facts. The dashboard shows AOV and refund rate as two numbers.
- **Tables:** `order_group`, and `refund` for the companion figure.

### 1.5 School penetration

> % of a school's enrolled children with ≥1 paid order this month.

- **Grain:** one row per (calendar month, `school`).
- **Numerator:** distinct `"order".recipient_id` where the parent group's `paid_at` is in the
  month, grouped by `"order".school_id`. `"order"` carries `school_id` denormalised already, so this
  needs no join to `recipient` at all — see §2.
- **Denominator: we do not hold it.** See §3. Until we do, this metric cannot be computed, and the
  dashboard must say so rather than substitute something.
- **Tables:** `"order"`, `order_group`, `school`.

This is the metric that tells us whether a school is worth the kitchen run. It is also the one most
likely to be quoted to a school, which is why §3 refuses to guess at its denominator.

### 1.6 Cohort retention

> Of orderers first active in week N, the % still ordering in weeks N+4, N+8, N+12.

- **Grain:** one row per (cohort week, offset).
- **Cohort** is assigned by a user's **first paid order**, and never reassigned. A user belongs to
  exactly one cohort for life.
- **"Still ordering in week N+k"** means at least one paid order in that specific week — not
  "at any point since". The cumulative reading always looks better and answers a different, easier
  question.
- **Offsets 4, 8 and 12 only**, as asked. In school terms that is roughly a month, half a term and a
  term.
- **Tables:** `order_group`.

**A cohort is not comparable until it has aged.** A cohort five weeks old has no N+8 figure, and the
dashboard must render that cell as *not yet* rather than as 0%. An immature cohort shown as zero is
the single most common way a retention grid gets misread.

---

## 2. Constraint: no children's personal data, ever

Non-negotiable #4 and `docs/decisions/dpdp.md`. Every one of the six above is computed from
**`app_user`, `order_group`, `"order"` and the ledger**. Five of them never reference a recipient at
all.

**The rules the metrics layer is built to, from the start:**

1. **No column of `recipient` is ever selected, joined for filtering, or aggregated.** Not
   `first_name`, not `class_label`, not `section_label`, and above all not `recipient_allergen` or
   `allergy_note` (tier S). There is no metric in this document that needs one, and there will not
   be one added quietly — a new metric that requires a recipient attribute is a decision, not an
   implementation detail.
2. **`recipient_id` may be counted, never described.** §1.5 needs `count(distinct recipient_id)` and
   nothing else. A pseudonymous id being counted reveals no attribute of any individual; the moment
   it is joined to fetch a column, that stops being true.
3. **`"order".school_id` is used rather than the recipient's school.** It is already denormalised
   onto the order for the RLS predicate, so the metric never has to touch `recipient` to know which
   school an order belongs to. This was a happy accident of `E02`'s performance work; it is now a
   constraint, and `0001_initial_schema.sql` should not lose that column without this document
   changing too.
4. **A small-number floor on anything reported per school.** A school with three ordering children
   makes "3 of 400" a statement about identifiable families to anyone who knows the school. Cells
   below a threshold are suppressed rather than rounded — pick the threshold when `E10` is built,
   but build the suppression into the query, not the template.
5. **No metric output goes to Sentry or analytics.** These are computed server-side for the admin
   dashboard and the school report, and nowhere else.

The good news, and the reason this constraint costs nothing: **money and children are already
separate in the schema.** Orders carry who paid and which school; recipients carry who ate. The
metrics live entirely on the first side of that line.

---

## 3. What school penetration needs that we do not have

**We hold no enrolled-child count per school**, and there is no honest way to derive one.

`P1` is why: attendance is self-declared and the schools refused to maintain a roster, so the only
children we know about are the ones a parent typed in. That set is the *numerator's* population.
Using it as the denominator would compute "% of children registered with GrayBag who have ordered",
call it penetration, and report a number that rises when adoption **stalls** — because a school
where only the keenest ten families sign up would score near 100%.

So the denominator has to come from outside the ordering data. Three ways, with a recommendation:

| | Source | What it costs | Honest? |
|---|---|---|---|
| **a (recommended)** | **The school tells us, once per academic year.** One integer per school, with the date it was given and who gave it | One question in the onboarding conversation Andy is already having. Needs a column and an admin field | Yes, and auditable — the figure has a provenance |
| b | Published prospectus / school website | Free, no conversation | Roughly. Often stale or a marketing number, and unattributable |
| c | Per-class registers from the school | Exact, and enables per-class penetration | The thing they already refused (`P1`). Do not re-ask |

**Recommendation: (a).** It is a single number, it is a reasonable thing to ask during the
conversation that onboards a school anyway, and it is the only option whose provenance can be shown
next to the metric. What it requires:

- **Schema:** `school.enrolled_children_count int null`, `enrolled_count_as_of date null`,
  `enrolled_count_source text null`. Nullable on purpose — most schools will not have supplied it,
  and the metric must be *absent* for them, not zero and not guessed.
- **Admin:** a field on the school record (`E10`), with the as-of date required whenever the count
  is set.
- **Dashboard:** where the count is null, the penetration cell reads **"no enrolled count"** and
  links to the field. It never falls back to a proxy. If a proxy is ever wanted it gets its own name
  — *registered-child conversion* — and is never labelled penetration.
- **Staleness:** a count more than one academic year old is shown with its date. Enrolment moves
  every July.

**Flagged, not invented.** Until (a) is done, §1.5 has no denominator and the dashboard says so.

---

## 4. What this means for work happening now

Nothing in this document is built yet. These are the things that would make it expensive later, and
which current work must therefore not do:

- **`order_group.paid_at` is the activation timestamp for everything here.** It must be set exactly
  once, at payment confirmation, and never backfilled or cleared on refund. `E06` owns it.
- **Keep one `order_group` per checkout.** §1.3 and §1.4 both count checkouts; a change that split
  a single checkout into several groups would silently double the order count and halve AOV.
- **Do not add a metric that needs a recipient attribute** without changing §2 first.
- **`"order".school_id` stays.** §2 rule 3.
- **`E15` observability**: these are product metrics, computed from the database. They are not
  events, they are not emitted from the app, and they must not become a client-side analytics
  pipeline — which would put them on the wrong side of §2.

---

## 5. Open

- The small-number suppression threshold for per-school figures (§2 rule 4). Decide when `E10` is
  built; the query must support it from the first version.
- Whether the school report (`E11`, fast-follow per `P15`) shows a school its own penetration. It is
  the most useful number we could give them and the most sensitive to get wrong with a stale
  denominator.
