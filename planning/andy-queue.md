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

## Open — 2 items

| # | Ask | Asked | Status |
|---|---|---|---|
| 1 | **"A parent pays and gets a receipt"**, test mode only | 2026-08-12 | In progress. `settle_payment` and the invoice are done and green; client checkout (`E06-02`), the status endpoint (`E06-16`) and the confirmation email (E08) remain |
| 2 | **Maestro in CI** | 2026-08-10 | Queued, blocked on `E14-30` (`owner:andy` — no Xcode/Android SDK on the build machine) |

**Added 2026-08-13, and cleared the same day:** the two version items the web thread raised.
Andy's words — *"Both are yours. Do them before the next build, not before the next submit."*
The app.json floor was already fixed on this branch and the web thread had read `main`; the
Android counter genuinely was at 1 and is now above the live floor. `E17-34`. The finding
underneath both is that **this branch has never been merged**, which is item 3 below.

| 3 | **Merge `ux-spec-and-prototype` into `main`** | found 2026-08-13 | **Needs Andy's go-ahead.** 96 commits — every payments migration, the ledger, the state machine, the webhook, invoicing. Not something to merge unattended |

---

## Closed

Kept so the queue shows movement rather than only what is left. Newest first.

| Ask | Asked | Done |
|---|---|---|
| **Cart to prototype** | 2026-08-10 | Compared element by element. Five states were built, tested and never wired — allergen warnings on every line, the offline band, the signed-out reassurance, Change, and the empty cart's only exit. `E05-45`; three real gaps filed as `E05-46`/`47`/`48` |
| **`P18` name capture (`E05-39`, `E05-41`)** | earlier session | Asked once on Order Confirmed, skippable, recorded server-side so it is never asked twice; settable from Account. The audit found nothing broken today and one landmine — `invoice.buyer_name_snapshot` is NOT NULL (`E07-22`) |
| **`E05-38` — self-ordering** | 2026-08-11 | "Order for myself" is first-class on Who you order for, and Add-someone asks who it is for before it shows a form. Bumped four times; done |
| **Gem and Paragon on Amity's break windows** | 2026-08-11 | `0029`, provisional and marked so in the data. Both schools open |
| **Dish-sheet pass (items 4–8)** | 2026-08-11 | Hero matches Home, allergen block quiet, For-block a line, calories shown, adding dismisses |
| **Kitchen note into the dish sheet** | 2026-08-11 | Full field on the sheet, compact tap-to-edit line in the cart |
| **Break-time selection at checkout** | 2026-08-11 | Built. Amity can order; Gem and Paragon are closed and say so. "Confirmed with the kitchen" deleted from every surface |
| **`E05-37` — edit and remove a child** | 2026-08-11 | Done. Removal erases, and the copy says so |
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

**Built 2026-08-11.** `0027` makes break windows readable signed out; `api.fetchBreakTimes`
reads them; `BreakTimePicker` offers them by name with the window underneath and nothing
preselected; the cart blocks Place order until one is chosen. A school with none shows "we're
still setting up ordering for this school" and a button reading "Not available at this school
yet" — deliberately not "Ordering has closed", which tells a parent to come back tomorrow.

**"Confirmed with the kitchen" is gone from every surface**, not only the cart: it was also on
Home's delivering-to band and on Order detail. Two tests that asserted it now assert its
absence.

**Still waiting on Andy:** start/end pairs for Gem and Paragon. Nothing is blocked on them —
those two schools simply stay closed until they arrive, which is what `P19` chose.
