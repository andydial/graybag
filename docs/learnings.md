---
title: Learnings
---

# Learnings

Running record of what broke, what did not work, and non-obvious constraints. Claude Code
appends here as it builds; Andy can read it to understand why things are the way they are.

Format — newest first:

```
## YYYY-MM-DD — Short title
**Context:** what we were doing
**What happened:** the symptom
**Cause:** the actual reason
**Fix / rule:** what we do now, and what to avoid repeating
```

---

## 2026-08-06 — Bubble export contains live secrets in cleartext

**Context:** Parsing the `.bubble` app export to map the legacy schema.
**What happened:** `settings.secure` contained a live Razorpay key (`rzp_live…`), a Stripe
test secret, and two marketplace plugin app secrets, all unredacted.
**Cause:** Bubble's app export includes the secure settings block verbatim.
**Fix / rule:** `*.bubble` is in `.gitignore` and must never be committed or shared. Keys
rotated (`E00-01`, `E00-02`). Treat any Bubble export as a secret.

## 2026-08-06 — Bubble cannot export password hashes

**Context:** Planning user migration for ~400 existing accounts.
**What happened:** No export path or API exposes the password field.
**Cause:** Platform limitation, not a setting.
**Fix / rule:** Every user re-authenticates once regardless of approach. Since that cost is
unavoidable, we switched to phone + OTP rather than migrating passwords — the migration
constraint became a product improvement.

## 2026-08-06 — Firebase Phone Auth is not available in India

**Context:** Evaluating OTP providers.
**What happened:** India is not among Firebase Phone Number Verification's supported
regions (Finland, France, Germany, Indonesia, Malaysia, Pakistan, Spain).
**Cause:** Google regional availability.
**Fix / rule:** Use an Indian SMS provider (MSG91 / Gupshup) with TRAI DLT registration.
DLT has 1–2 weeks of paperwork lead time and blocks launch — started in `E00-06`.

## 2026-08-06 — Legacy break-time option values contradict their labels

**Context:** Mapping the legacy `Break-Start-Times` option set for migration.
**What happened:** db_value `10__00_am` renders as "10:40AM - 11:15AM"; `10_15_am` renders
as "11:15AM - 11:40AM".
**Cause:** Labels were edited over time without changing the stored values.
**Fix / rule:** Never migrate break times on db_value. `E16-15` builds a hand-verified
lookup table. General rule: for every legacy option set, verify label-to-value agreement
before trusting either.

## 2026-08-06 — Legacy `mobile` is a number field

**Context:** Planning OTP-based account claim for migrated users.
**What happened:** Leading zeros and `+91` country codes are already lost in the stored data.
**Cause:** Bubble field typed as number rather than text.
**Fix / rule:** Normalise to E.164 before any claim is possible, and **block auto-claim on
any ambiguous or duplicate match** — otherwise one OTP could claim the wrong account along
with its children's records (`E03-11`, `E16-14`).
