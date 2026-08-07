# Agent 4 review-merge notes — dpdp / privacy / refund docs

Owned files (only these were edited):
- `docs/dpdp-compliance.md`
- `docs/privacy-policy.md`
- `docs/refund-policy.md`

## Findings fixed

| Finding | File → section | What changed |
|---|---|---|
| **#4 / §2.5** (erasure scope) | `dpdp-compliance.md` §6.5 | Rewrote the erasure pipeline to take a **`scope` parameter** (`recipient` vs `account`). Added a scope table, an explicit call-out of the bug (single-child withdrawal anonymising the parent), and per-step annotations for which scope runs which work. In `recipient` scope steps 1/4/5 never touch `app_user`. Added a note that **`E20-18`** (one Edge Function, fixed order) must respect the scope param, and a required test that a `recipient`-scope run leaves the parent's `app_user` and sibling `recipient` rows unchanged. |
| **#4 / §2.5** (ordering slip) | `dpdp-compliance.md` §6.5 | Fixed the step-2 justification/ordering contradiction. Step 2 (record the withdrawal) is now stated to run **first, in the same transaction as step 1**; step 1's prose points forward to step 2. The "BEFORE anything else, because after step 1 no customer-facing path can write it" reason now agrees with the ordering. |
| **#4 / §2.5** (invocation) | `dpdp-compliance.md` §3.5 | `child_data_processing` and `order_fulfilment` withdrawal rows now invoke **`scope = 'recipient'`** (that child only) — explicitly *not* the account pipeline. |
| **#7 / §4.1** (push egress) | `dpdp-compliance.md` §9 rule 2 | Made the rule concrete for **`E20-29`**: no push/notification body may contain tier-P/S data (no child name); copy lives in **E08 templates** (`E08-03` order-confirmed, `E08-05` order-delivered are the risky ones); covered by the **same sentinel-name test as `E20-10`**, run against the E08 templates and the Expo Push payload. Flagged that the "may a push body EVER name a child" decision is **`[DP-08]`** / owner:andy — not decided here; `E20-29` builds on the conservative default. |
| **#7 / §4.1** (disclosure consistency) | `privacy-policy.md` §3 | Expo/EAS row now states notification text **never** contains child name/class/section/allergies and refers to the order neutrally, enforced by test (`E20-29`) — consistent with the §9 rule. |
| **#13 / §2.7** (tier classification wording) | `dpdp-compliance.md` §2.2 | Changed "is repeated here" to "**extends and completes**" the normative §13.3, naming the two added rows (`order_line.allergen_codes_snapshot` = S, `invoice_line.description` = P) and stating **`data-model.md` §13.3 remains authoritative once merged** and this table must not diverge. (A parallel agent adds those two rows to data-model.md §13.3.) |
| **#17 / §4.2** (otp_attempt) | `dpdp-compliance.md` §6.2 | Replaced the false "`otp_attempt` / auth logs — 90 days — delete" row with an honest one: OTP/auth state lives in Supabase's managed `auth` (GoTrue) schema, **no `otp_attempt` table exists in 0001**, retention is the auth provider's setting, our purge job does not reach it. Noted **`E20-33`** builds an owned `otp_attempt` (for `E03-10` throttle counting) which then gets a real 90-day row. |
| **#17 / §4.2** (published claim) | `privacy-policy.md` §6 | "Sign-in / OTP records — ~90 days — Deleted" restated to "held by our sign-in provider and kept for the period its settings allow (short) — deleted by the provider" so the **published** claim is true today. |
| **#26 / §1.4** (MDR parties) | `refund-policy.md` §4 | Removed "the kitchen". Now: the fee comes out of the **school's share** (`M5`) or is **absorbed by GrayBag** where no share was earned (`[PAY-04]`) — never the kitchen, never the customer. |
| **#1.2 / §1.2** (PY3 miscite) | `refund-policy.md` front matter + §3 | Front matter: dropped "PY3 refund speed" from the decisions list; `[PAY-03] refund speed` already in the open-questions list. §3: "(`PY3`, refund speed `normal`)" → "(`[PAY-03]`, refund speed `normal`)" and made clear `[PAY-03]` is open. |
| **§3.3 slip** ([DP-05]→[DP-04]) | `dpdp-compliance.md` §3.5 | `school_reporting_aggregate` withdrawal row now cites **`[DP-04]`** (is the school a fiduciary/processor/recipient), not `[DP-05]` (cross-border). |

Not touched (deferred to coordinator, per instructions): Finding #19 — `privacy-policy.md` §2.3/§4.1 and dpdp §9 processor register left as-is for the product_analytics vendor/declaration issue. Analysis below.

## Backlog tasks completed by these doc fixes

- **E20-30** (erasure pipeline scope param) — **doc side fully done.** §6.5 now specifies the `scope` param, the two scopes, the per-step behaviour, and the `E20-18` interaction + required test. Implementation (the Edge Function + the test) remains open code work.
- **E20-29** (push-body rule + sentinel test) — **doc side fully done.** §9 rule 2 now specifies the rule, the target templates (E08-03/E08-05), and the sentinel test coverage; privacy §3 disclosure made consistent. Implementation (test + template review) remains open code work. Decision `[DP-08]` is *not* resolved (owner:andy).
- **E20-31** (tier classification agreement) — **doc side fully done on this repo's side.** §2.2 now says "extends/completes" and points at data-model.md §13.3 as authoritative. The paired data-model.md §13.3 row additions are a **parallel agent's** job — not done here (out of my file ownership).
- **E20-33** (build `otp_attempt`) — **still open.** Only *referenced* here; the honest half (making the published claim true) is done. Building the table + its retention row is future code work for E03-10's throttle.

Nothing was ticked in `backlog-state.json` (per isolation rule and because none of these E20 tasks are fully code-complete). Coordinator should decide E20-29/30/31 doc-portions.

## [DP-08] recommendation (may a push body ever name a child — for open-questions)

**Recommended answer: default NO — a push/notification body must not name a child.** Reasoning:
- A push body renders on the lock screen, visible **without unlocking the device**, to anyone who picks up the phone. That is an uncontrolled egress of tier-P data (child's first name) to whoever is near the parent's phone, plus to Expo/EAS's servers in transit.
- The functional need is weak: the parent already knows which child they ordered for, and the order can be identified neutrally ("Your lunch order has been delivered") or by an order reference. Naming the child buys almost nothing.
- If Andy/the lawyer want a softer stance, the only defensible relaxation is: a child's **first name only**, to an **opted-in** parent, on **that parent's own device**, and even then it is still lock-screen-visible — so I would still lean no. Recommend keeping the sentinel test strict (no child name at all) until `[DP-08]` explicitly relaxes it. This is a genuine `(owner:andy)` decision (DPDP s.9 child-data judgement); do not let it be decided by an implementer.

## Finding #19 analysis + recommendation (product_analytics — for coordinator's open-questions writeup)

The three documents describe `product_analytics` three inconsistent ways:
- `privacy-policy.md` §2.3 lists **"App analytics — To understand which screens are used"** as automatically collected; §4.1 offers **"Product analytics"** as an optional consent purpose.
- `dpdp-compliance.md` §5.1 names **"The analytics vendor"** as the recipient — but §9's processor register (which claims to list *every* third party that touches personal data) has **no analytics row**.
- `store-submission.md` §2.1 declares **"Everything above is App Functionality … No row uses Analytics"** (SUB2) — the opposite of collecting analytics.

**Root cause:** a consent purpose + a policy line + a §5.1 recipient exist, but **no vendor was ever chosen**, no DPA contemplated, no processor-register row, and the store declaration was written as if analytics does not exist. `E15-11` (install→signup→first-order funnel) is the build task with no vendor. `[DP-05]`'s cross-border question applies to it exactly as to the unchosen email vendor.

**Recommendation (for the coordinator, since #19 is deferred and spans store-submission.md which I don't own):** treat as one reconciliation task (**E20-34**) that either (a) picks a vendor, adds a §9 register row, and flips the store Data-Safety/App-Privacy declaration to disclose Analytics; **or** (b) if analytics is cut for v1, remove the `product_analytics` consent purpose from privacy §4.1, remove "App analytics" from §2.3, remove "the analytics vendor" from dpdp §5.1, and keep the store "no Analytics" declaration true. **My lean: (b) for v1** — one fewer vendor, one fewer cross-border tier-A egress, one fewer DPA, and it makes the store declaration (which is a legal attestation) true with the least work. Should ride with `[DP-05]`. I deliberately did **not** edit privacy §2.3/§4.1 or dpdp §9 for this, per instructions.

## Proposed learnings

- **A pipeline written for one scope, reused for another, silently over-reaches.** The DPDP erasure pipeline was authored for whole-**account** deletion (step 1 sets `app_user.deleted_at`, step 5 anonymises the adult's name/phone/email, step 4 deletes the adult's device tokens), then §3.5 pointed a **single-child** consent withdrawal at the very same pipeline. Unscoped, withdrawing consent for one of two children would anonymise the parent and delete the sibling. Lesson: any "run the pipeline" reference must state its **scope**, and the erasure Edge Function needs a test that a recipient-scope run leaves the parent + siblings byte-for-byte unchanged. Cheap to state now, a real-world regulatory incident if shipped.
- **A published, customer-facing policy promised retention for a table that was never in the schema.** privacy-policy §6 and dpdp §6.2 both scheduled "OTP records — 90 days — delete", but there is **no `otp_attempt` table in 0001** — OTP state lives in Supabase's managed `auth`/GoTrue schema that our purge job cannot reach. A published retention claim resting on a non-existent table is a claim we cannot honour or evidence. Lesson: every retention-schedule row and every customer-facing retention line must name a table/vendor that actually exists and that some job (ours or the vendor's) actually enforces. The §6.4 coverage assertion ("every tier-S/P/A table has a retention_policy row") is exactly the mechanism that should catch this — but it can only cover tables we own, so vendor-held data must be described as vendor-governed, not as ours.
- **"Repeated here" vs "extended here" is a source-of-truth trap.** dpdp §2.2 said it *repeated* the normative data-model §13.3 classification, but actually *added* two rows. If §13.3 is authoritative, a silently-extended copy drifts and the two documents disagree about which is normative. Lesson: a copy of a normative table must say whether it repeats or extends, and name which document wins.

## Could not resolve → open question

- Nothing blocked within my three files. The two genuine hand-offs are noted, not resolved:
  - `[DP-08]` (push body naming a child) — owner:andy decision; recommendation above.
  - Finding #19 (product_analytics reconciliation) — deferred to the coordinator; spans `store-submission.md` which I do not own; recommendation above (lean toward cutting analytics for v1).
  - `data-model.md` §13.3 must gain the two rows (`order_line.allergen_codes_snapshot` = S, `invoice_line.description` = P) for dpdp §2.2's "extends/completes" wording to be true — that edit is a parallel agent's, outside my ownership.
