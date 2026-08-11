# Andy's queue

**Everything Andy has asked for that is not yet done**, in the order it will be done, with the
date he asked. Not the backlog — that is `planning/backlog/` and `planning/TODO.md`. This file
exists so the queue can be seen draining rather than reconstructed from chat each time.

**Rules, agreed 2026-08-11:**

- Updated in **every** report. If it is not on here, it is not queued.
- Cleared **in order**. No new work is taken until it is empty.
- Anything new goes to the **bottom**, and the report says so explicitly.
- Andy's own tasks (`owner:andy`) are **not** here — they are in `planning/TODO.md`. This is
  only work that is mine to do.

> **Why it exists.** Self-ordering (`E05-38`) has been bumped four times by feedback arriving
> after it. Each bump was individually reasonable and the cumulative effect was invisible,
> because the queue only ever existed in conversation.

---

## Open — 8 items

| # | Ask | Asked | Status |
|---|---|---|---|
| 1 | **`E05-37` — edit and remove a child.** The edit sheet (first name, class, section) and a Remove action with a confirmation that says what removal does | 2026-08-11 | **Next.** Unblocked: `0026` erasure landed, so Remove can now say what it does |
| 2 | **Break-time selection at checkout.** The parent chooses from the school's configured windows; "confirmed with the kitchen" is a manual process we can never run. Fix the model, not the sentence | 2026-08-11 | Blocked on a decision — see the finding below |
| 3 | **Kitchen note moves into the dish sheet**, with a compact tap-to-edit line in the cart | 2026-08-11 | Queued |
| 4 | **Dish-sheet pass — one change, items 4–8:** image aspect ratio to match Home; allergen block quiet when there is nothing to say; shrink or drop "For the person you've chosen"; show calories; add-to-cart dismisses back to the menu | 2026-08-11 | Queued |
| 5 | **`E05-38` — self-ordering.** "Order for myself" as a first-class entry in Who-to-order-for, and Add-recipient asking who it is for before anything else | 2026-08-11 | Queued. **Bumped four times** — protected by the no-new-work rule from here |
| 6 | **`P18` name capture (`E05-39`, `E05-41`).** The account holder's own name on Order Confirmed, one optional field with a clear skip, plus an audit of every surface that shows a name for the no-name case | earlier session | Queued |
| 7 | **Cart to prototype** | 2026-08-10 | Queued |
| 8 | **Maestro in CI** | 2026-08-10 | Queued, blocked on `E14-30` (`owner:andy` — no Xcode/Android SDK on the build machine) |

---

## Closed

Kept so the queue shows movement rather than only what is left. Newest first.

| Ask | Asked | Done |
|---|---|---|
| Policy: lawyer baseline + three tracked changes as a new notice version | 2026-08-11 | `E20-45`, `C17` |
| `E20-44`/`E20-30` — build the recipient-scope erasure before `E05-37` | 2026-08-11 | `0026`, 18 pgTAP assertions |
| Confirm whether the app stores allergy data | 2026-08-11 | Answered: yes, whole path live |
| Hard rule — no telemetry may touch a child's record, failing a build | 2026-08-11 | `E20-42`, `C16` |
| `E17-36` — iPad, verified against App Store Connect | 2026-08-11 | Asserted with provenance |
| Pre-flight `submit.preview` before burning a TestFlight build | 2026-08-11 | `E17-37`/`E17-38` — caught the empty EAS environment |
| The exact Supabase auth settings, in one message | 2026-08-11 | Two, not four; `E00-22` corrected |
| Separate App Store Connect record for staging, wired to `submit.preview` | 2026-08-11 | `E17-32`, `R10` |
| Production version to `4.0.0`; version test asserts > 3.7.0 with provenance | 2026-08-11 | Committed |
| Audit the release config for other unverified assumptions | 2026-08-11 | `E17-33`…`E17-36` |
| `E20-11` policy acceptance gate mounted | 2026-08-11 | `E20-36` |
| `E20-12`/`13`/`14` — deletion route, policy links, support reachable | 2026-08-11 | `E20-37`/`38`/`39` |
| `E04-20` — "my school is not listed" | 2026-08-11 | Done, and offered before you search |
| Navigation dead ends — "Open the Menu", change school | 2026-08-11 | `E14-34` |

---

## Finding that blocks item 2 — break windows exist for **one** of the three live schools

Checked before designing the picker, as asked.

**What exists.** `break_time` is a real table with `school_id`, `label`, `starts_at`, `ends_at`,
`sort_order`, `is_active`, and a `break_time_class` mapping for later per-class windows.
`create_checkout` **already accepts `break_time_id` per line** and writes it onto the order,
and `api/checkout.ts`'s `CheckoutLine` already carries `breakTimeId`. So the write path is
built.

**What does not exist.**

1. **No read.** Nothing in `api/` fetches a school's break windows. That is the missing piece
   and it is small.
2. **Only Amity has windows.** The real catalogue seeds two — `10:40AM - 11:15AM` and
   `11:15AM - 11:40AM` — for `amity-international-school`, and **zero** for Gem Public School
   and Paragon Senior Secondary. The seed's own comment says this was deliberate: unresolved
   legacy break timings were left out rather than invented, because the legacy option-set values
   contradicted their labels.

**So the decision Andy owns:** a required picker works for Amity and blocks checkout at two of
the three live schools. The options are (a) supply the real windows for Gem and Paragon, and the
picker is required everywhere; (b) the picker appears only where windows exist and checkout
proceeds without one elsewhere, which keeps the "we'll confirm it" copy alive for two schools —
the thing Andy objected to; or (c) one default window per school, invented, which is what the
seed comment deliberately refused to do.

**Recommendation: (a).** It is two rows per school and it is the only option that removes the
manual promise everywhere rather than moving it. Until the numbers exist, building the picker
means building a screen that two-thirds of live schools cannot show.

**The labels also need a decision.** Amity's are stored as `10:40AM - 11:15AM` — the time is the
label. A parent picking between "10:40AM - 11:15AM" and "11:15AM - 11:40AM" is reading raw data;
"Morning break" and "Second break" is what the column was designed for (`label` is described as
"what the customer sees"). Real names would come with the real windows.
