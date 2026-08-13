---
title: Ordering for yourself — what it would cost
status: costing, for Andy's decision. NOT a plan to build.
raised: 2026-08-10, by Andy. "There is no path for a person to order for themselves."
decision needed: v1 or fast-follow
---

# Ordering for yourself — what it would cost

School staff and university students order their own lunch. The business includes them, the
legacy data contains them, and **the app as specified cannot serve them at all**: every screen
in `docs/ux-spec.md` is written as a parent ordering for a child, and `create_recipient` hard-codes
a child.

This is excluded by omission rather than by decision, which is how a customer segment gets
forgotten until launch. This document costs it so the exclusion can be deliberate either way.

---

## 1. The headline: the data model already does this

This is the finding that changes the cost. **`recipient` was designed for it in `0001` and the
work was already done.**

| Already present | Where | What it means |
|---|---|---|
| `recipient.is_self boolean` | `0001` line 413 | The table's own comment: *"the person who eats the food: either the ordering adult themself (is_self) or a dependent. This single table is what removes all the legacy role branching (`D2`)"* |
| `recipient.is_minor boolean` | `0001` line 425 | Already separate from `is_self`. An adult recipient is `is_minor = false` |
| `guardian_relationship` includes **`'self'`** and **`'staff'`** | `0001` line 82 | The link type exists. No enum change |
| A trigger enforcing the self case | `0001` §4.2, line ~2198 | *"a recipient must have at least one active `guardian_link`, and `is_self = true`"* requires its sole active link to be `relationship = 'self'`. The integrity rule is written and tested |
| `class_label` / `school_class_id` nullable | `0001` lines 417-419 | A staff member with no class does not violate the schema |

**No migration to the recipient model is required.** `D2`'s decision to collapse the legacy role
branching into one table is what makes this cheap — the previous architecture would have needed
a parallel `staff_order` path, which is exactly what the legacy app had.

What is hard-coded is not the model but **one function**.

---

## 2. What actually changes

### 2.1 `create_recipient` — the only server change of substance

`0015` inserts a child, unconditionally:

```sql
insert into recipient (…, is_minor) values (…, true);
insert into guardian_link (…, relationship, …) values (…, 'guardian', …);
```

It also requires a published **child-data notice** and writes a `consent_record` against it.

Needed: a `p_is_self boolean` parameter that sets `is_minor = false`, `is_self = true`,
`relationship = 'self'`, and takes the **adult** consent path (§2.4). Perhaps 40 lines, one
migration, and the existing trigger already refuses an inconsistent combination — so a bug here
fails loudly rather than creating a malformed recipient.

**Risk: low.** The integrity constraint predates the feature.

### 2.2 Consent — this is where it gets *simpler*, not harder

An adult ordering for themselves needs **no parental consent flow at all**. Concretely:

| Today, for a child | For an adult ordering for themselves |
|---|---|
| Consent to hold a **minor's** name, class, section — a separate purpose (`child_meal_service`) with its own published notice, its own version pin, and `[DM-12]`'s "capture at creation" rule | Nothing extra. They accepted the privacy policy at sign-up; holding their own name is the ordinary basis every account already has |
| A **separate** optional consent for a minor's health data (`child_allergen_info`, `C12`/`C5`) because it is health data about someone who cannot consent | Still a consent — health data is special category under DPDP — but it is the ordinary "I am telling you about myself" kind, on their own record, not a third party's |
| The whole two-question consent block on Add child (5.10), which the review called the best screen in the prototype | Collapses to a single optional "any allergies?" section |
| Deletion, correction and withdrawal are exercised **on behalf of** a data principal who is not the account holder | The account holder *is* the data principal. `E20`'s account-deletion path already covers them |

**This is a real simplification and it should be said plainly: the adult case is the easy case
that the child case is a complication of.** The current spec builds the hard one first and treats
it as the only one.

`[DM-12]`'s reasoning does not transfer either — it is about *verifying the consenting adult is
really the parent*, a problem that does not exist when there is no third party.

### 2.3 The cart and checkout — almost nothing

- `CartLineInput` already carries `recipientId`. A self recipient is a recipient.
- `create_checkout` authorises through `guardian_link.can_order`, which a `self` link has.
- The GST split, cutoff, pricing and idempotency are all recipient-agnostic.
- **One decided thing survives intact:** one child, one service date per checkout (`AR8`/§8.5)
  becomes "one *recipient*, one date". No structural change.

The only visible change is copy: "For **Aarav** · Class 5-A" becomes "For **you**".

### 2.4 The packing list and the kitchen — the one genuinely new requirement

`scripts/kitchen-list.mjs` groups by school → break → **class → section**. A staff member or a
student has no class, so today they would land in a group with two empty labels, which reads as a
data error to whoever is packing.

Needed: an explicit **"Staff"** (and, for a college, "Students") grouping so the kitchen knows
where to take the bag. That is a real question for the kitchen, not just a label:

> **Where does a staff lunch physically go?** A child's goes to a classroom at a break. A
> teacher's might go to a staffroom, a counter, or the same classroom. A university student has
> no classroom at all — the legacy `User-Role` includes `CollegeStudent` and `Chandra College` is
> already in the seed with a `Canteen window` break and no sections.

**This is the only part that cannot be answered from the codebase.** It needs the kitchen.

### 2.5 Screens — smaller than it looks

| Screen | Change |
|---|---|
| **Add child** (5.10) | Becomes **Add someone** with a first choice: "Myself" / "My child". Choosing Myself hides the class/section fields and the parental consent block, and prefills the name from the account |
| **Children** (5.16) | Becomes **Who you order for**. A self row reads "You" and cannot be removed while orders exist |
| **Home** (5.4) | The "Delivering to" card already carries a recipient. Copy only |
| **Dish detail / Cart** | Copy only — "For you" instead of a name |
| **Onboarding copy** | The bigger one. "Add your child to order" is wrong for half the audience, and it is on the first screen a cold user sees |
| **Everything else** | Unaffected |

Nothing in the **navigation graph** changes and no new screen is added.

---

## 3. The third mode, which is not in scope and should not be smuggled in

Legacy `Recipient_Type` is **`Child, Class, Staff`** — and `Class` means a teacher ordering for a
whole class at once. That is a genuinely different feature: bulk quantities, one payer, many
eaters, and a packing list that is a count rather than a list of names.

**It is not part of this costing** and should not be folded in. Recon found 13 `Staff` orders and
does not report a `Class` volume; if `Class` matters it deserves its own decision.

---

## 4. Cost

| Piece | Size | Risk |
|---|---|---|
| `create_recipient` gains `p_is_self` | 1 migration, ~40 lines | Low — the trigger already enforces consistency |
| Consent path for an adult | Small, and **removes** a flow rather than adding one | Low |
| Packing-list grouping for people with no class | Small code, **blocked on a question for the kitchen** | Medium — the question, not the code |
| Add child → Add someone | 1 screen, one branch | Low |
| Copy across 4 screens | Small | Low |
| Authorization suite: self-link cases | ~6 assertions | Low |

**Rough total: two to three days**, of which roughly half a day is code and the rest is the
kitchen question, the consent wording, and tests.

**If it is fast-follow instead**, the cost is not zero and it is not deferred evenly:

- Every screen built between now and then gets its copy written for parents and rewritten later.
- The onboarding path — the thing `AR7` calls a primary v1 goal — is the most expensive to
  rewrite, because it is the most heavily tested and the most tuned.
- The v1 privacy notice and consent wording would be published parent-only and then need a new
  **policy version**, which re-prompts every existing user (§5.19).

That last one is the real argument for deciding now rather than later.

---

## 5. Recommendation

**Take the model change and the copy in v1; defer nothing that is cheap now and expensive later.**

Specifically:

1. **Now, before Menu and Dish detail are built:** write the screens' copy recipient-neutral
   ("For you" / "For Aarav" from one code path). Costs nothing today, and it is the part that is
   expensive to retrofit.
2. **Now:** `create_recipient` gains `p_is_self`, and the consent path branches. Small, and it
   settles the privacy notice before it is published rather than after.
3. **Now:** ask the kitchen where a staff lunch goes. It blocks nothing else and it is the only
   unknown.
4. **Fast-follow:** the "Myself / My child" choice on Add someone, and the Children screen copy.
   They are cheap whenever they land.
5. **Separate decision, not smuggled in:** ordering for a whole class.

**[NEEDS ANDY]** v1 or fast-follow, and the kitchen question in §2.4.
