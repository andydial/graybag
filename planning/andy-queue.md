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
| 2 | **Break-time selection at checkout.** Parent picks from the school's real windows. **Option (a) chosen 2026-08-11:** required everywhere, real windows only, nothing invented. A school with no windows **must not reach checkout** — it says "we're still setting up ordering for this school", never "we'll confirm with the kitchen". Friendly labels ("Morning break") with the times underneath | 2026-08-11 | Unblocked on design; **waiting on Andy** for Gem and Paragon start/end pairs. Amity is buildable and launches first |
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

## Item 2 — resolved 2026-08-11, and what is still waiting

Checked before designing the picker, as asked.

**Already built:** `break_time` (`school_id`, `label`, `starts_at`, `ends_at`, `sort_order`),
plus `break_time_class` for per-class windows later. `create_checkout` **already accepts
`break_time_id` per line** and writes it onto the order; `CheckoutLine` already carries
`breakTimeId`. The write path is done.

**Missing:** a read in `api/`, the picker, and — the real constraint — **the windows
themselves**. The catalogue seeds two for Amity International School and **zero** for Gem Public
School and Paragon Senior Secondary. That was deliberate: the legacy option-set values
contradicted their labels, so the seed left them out rather than inventing them.

**Andy's decision, 2026-08-11 — option (a).** Required picker everywhere, real windows only,
nothing invented. Until the real times arrive, Gem and Paragon **must not reach checkout**, and
must say "we're still setting up ordering for this school" — never "we'll confirm with the
kitchen", which describes a manual step nobody can perform at volume. Amity is the only school
that can take an order today, and it is the biggest and launches first.

Labels are friendly — "Morning break", "Second break" — with the times underneath. A parent
should not have to read raw data to choose. Amity's `label` currently holds the time range
itself, so it needs renaming when the real windows land.

**Waiting on Andy:** start/end pairs for Gem and Paragon, from the kitchen this week.
