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

## Open — 1 item

| # | Ask | Asked | Status |
|---|---|---|---|
| 1 | **Maestro in CI** | 2026-08-10 | Queued, blocked on `E14-30` (`owner:andy` — no Xcode/Android SDK on the build machine). The job has **still never been observed green**; its last run was cancelled. `E14-36` fixed the Gradle metaspace OOM and the 781-second emulator boot and is on `main` |

---

## Closed 2026-08-15 — the six-item list

Andy gave six items in order and all six are done. PRs #60 and #61.

| # | Ask | Done |
|---|---|---|
| 1 | Scope **"My Orders"** to the signed-in customer, asserting the count | **Already shipped** as `E06-43` before this session. Verified rather than redone: `my_orders_scope.test.sql` seeds three parents with 2/1/3 orders and asserts the count through an authenticated client, with a third party present |
| 2 | Sweep every parent-facing screen for the same assumption | **Already shipped** as `E06-44`. Verified: `fetchRecipients`, `fetchProfile` and both order reads scope explicitly; `fetchRecipientAllergens` was the one gap and now checks `guardian_link` first. **Every** table behind a "mine" screen carries a widening policy, so RLS narrows to "mine" for none of them |
| 3 | `E06-42` — cancellable resolved server-side from `config_snapshot` | Done. `0052`, two PostgREST computed columns. The snapshot, never `resolve_effective_config()` — the test edits the kitchen's config mid-run, which is the only assertion that can tell the two apart |
| 4 | Parent-initiated cancel before cutoff | Done. `E06-45`, `0053` + `cancel-order`. Records a pending refund and **posts nothing to the ledger** — the money has not moved |
| 5 | Refund awareness, deduped on refund id | Done. `E06-46`, `0054`. Dedupes on `provider_refund_id`; ledger reversal, order state, credit note, parent email. **Found that `reverse_ledger_transaction` could not reverse any real settlement** and never could have |
| 6 | Support address — `support@graybag.com`, no individual named | Done. `E20-51`. `GrievanceOfficer.name` removed from the type, not just the value. **The published privacy policy still names Vivek and I did not touch it** — that is a new notice version and a legal question, filed as `E20-52` |

**Not added to this queue, because they are Andy's:** `E20-52` (does DPDP require the grievance
officer to be a named natural person?) and the `E06-33` refund-timing figure, which item 4's
confirmation copy deliberately works around by promising no date.

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
