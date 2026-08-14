---
title: The placeholder register
status: Live. Regenerate the counts with `npm run check:placeholders` before relying on them.
covers: Every unresolved `«…-PENDING-…»` token on a surface we publish
audience: Andy, filling these in; and whoever adds the next one
---

# Every placeholder we publish

One list, because scattered findings do not get finished. Each row says **what it is**, **what it
needs**, and **who can supply it**.

> **Updated 2026-08-14.** Andy supplied the legal name, support email, jurisdiction, grievance
> officer and effective date, and `E12-25` landed — the values now live in
> **`docs/legal/company.json`**, one file, read by the website renderer, the app's generated
> policy documents and this register. The documents keep their `«…»` tokens and are substituted
> at render time, so the same fact cannot differ between the terms and an invoice.
>
> **Updated again 2026-08-14** with the final entity facts, and both liability clauses settled.
> **1 token blocks a build, down from 10** — the accountant's, which Andy has said not to block
> on. 6 more on surfaces not yet built.

A `«…-PENDING-…»` token is the repo-wide convention for a value nobody has committed to yet. A
production build containing one fails, by design — `apps/web/src/lib/policy.ts`'s
`assertPublishable`, triggered by `PUBLIC_SITE_STAGE=production`. **That guard stays.** Publishing
a privacy notice that names the grievance officer as
`«GRIEVANCE-OFFICER-NAME-PENDING-E20-21»` is worse than publishing none: it is a signed statement
that we have not appointed one.

To see the live list at any time:

```bash
PUBLIC_SITE_STAGE=production npm run build:web   # fails, naming every token on a published page
npm run check:placeholders                       # the whole register, including non-web surfaces
```

---

## 1. What is actually published

Four surfaces reach a reader. Everything else in `docs/` is internal and does not block a build.

| Surface | Source | Blocks a production build? |
|---|---|---|
| `/privacy`, `/terms`, `/refunds` on the website, and the same three in the app's policy gate | `docs/privacy-policy.md`, `docs/terms.md`, `docs/refund-policy.md` | **Yes** |
| GST invoices emailed to parents | `docs/gst-invoicing.md` | Not yet — see §4 |
| Play Store and App Store listings | `docs/store-submission.md` | No — submitted by hand |
| The grievance block in the app's Settings → Privacy | `docs/dpdp-compliance.md` §7.2 | No — see §3 |

**`docs/privacy-policy.md` and `docs/refund-policy.md` have no placeholders at all.** Both are the
text GrayBag's Indian lawyer drafted and published for the legacy application, held verbatim in
`docs/legal/`, with each later change listed in their own change logs. Reusing them is already the
position, not a shortcut.

So the whole blocking set is **`docs/terms.md`**, which is the one genuinely new document.

---

## 2. `docs/terms.md` — 5 answered, 5 outstanding

### Answered 2026-08-14 (5, from `docs/legal/company.json`)

| Token | Value |
|---|---|
| `«GRAYBAG-LEGAL-ENTITY-NAME-PENDING-E20-01»` | GRAYBAG SOLUTIONS PRIVATE LIMITED |
| `«GRAYBAG-GSTIN-PENDING-E00-10»` | 03AAMCG3438M1ZD |
| `«GRAYBAG-REGISTERED-ADDRESS-PENDING-E20-01»` | SCO-461-462, Top Floor, Sector 35-C, Chandigarh, 160022 |
| `«GRAYBAG-SUPPORT-EMAIL-PENDING-E20-01»` | info@graybag.com |
| `«JURISDICTION-CITY-PENDING-E20-01»` | SAS Nagar (Mohali), India |
| `«GRIEVANCE-OFFICER-EMAIL-PENDING-E20-21»` | vivek@graybag.com — copied from privacy §7A |
| `«TERMS-EFFECTIVE-DATE-PENDING-E20-12»` | 2026-08-14 |

> ### Open question for Andy — the GSTIN and the address name different states
>
> **Recorded exactly as supplied, and deliberately not resolved.**
>
> - The GSTIN `03AAMCG3438M1ZD` begins **03**, which is the GST state code for **Punjab**.
> - The registered address is **Chandigarh**, whose GST state code is **04**.
>
> One of the two is not what it appears to be, or the company is registered in Punjab while its
> registered office is in Chandigarh — which happens, and is not itself a problem. It matters
> because both appear on a tax invoice and because place of supply is derived from state.
>
> **Place-of-supply logic stays keyed off the GSTIN**, unchanged. Nothing has been guessed. The
> earlier note about `Pty Ltd` is resolved: the final name is
> `GRAYBAG SOLUTIONS PRIVATE LIMITED`, an Indian private limited company, and the Australian
> suffix was a first-pass value. Tracked as `E12-29`.

### Still outstanding (1)

| Token | Who | Note |
|---|---|---|
| `«SIGNATURE-TREATMENT-PENDING-E00-10»` | Accountant | On the accountant list. Andy: do not block on it |

### The two liability clauses — settled 2026-08-14

There was nothing to lift: `graybag.com` serves a placeholder page, and `docs/legal/` holds
baselines for the privacy and refund policies only. The legacy application never published terms.
Andy split the two rather than treating them as one problem.

**The liability cap: published without one.** The cap sentence is gone, and no token replaced it —
the section now says only that nothing in the Terms limits liability which cannot be limited by
law. That is a deliberate position, not an omission: our liability is whatever the law gives,
rather than a number we asked for and never had reviewed.

**The allergy clause: rewritten as a description of the system, not a disclaimer.** Andy: *"what
the parent enters, where it is stored, who sees it in the kitchen, and what the system does not
do. No warranty language, no disclaimers dressed as facts."*

Every statement in it was checked against the code first, and two are worth knowing because they
are not what a reader would assume:

- **A dish nobody has described warns every time, for every child** — `allergenWarning` returns
  `{ warn: true, reason: 'unknown' }` rather than treating silence as safety.
- **The kitchen's screen does not show a child's allergies.** `KITCHEN_ORDER_COLUMNS` selects no
  allergen field. Staff see the dish, the quantity, the child's name and the parent's request. The
  clause says so plainly rather than implying otherwise, and the gap itself is raised as
  `E09-33`.

---

## 3. `docs/dpdp-compliance.md` — 3 left, none blocking

This is the internal compliance record. It feeds the app's grievance block, which is why it
matters, but nothing publishes it directly.

| Token | Line | What it needs | Who |
|---|---|---|---|
| `«GRIEVANCE-OFFICER-NAME-PENDING-E20-21»` | 738 | **Stale.** The published privacy policy §7A already names **Vivek** | Andy — copy across |
| `«GRIEVANCE-OFFICER-TITLE-PENDING-E20-21»` | 739 | Published policy says "Grievance Officer, GrayBag" | Andy — copy across |
| `«GRIEVANCE-OFFICER-EMAIL-PENDING-E20-21»` | 740 | Published policy says `vivek@graybag.com` | Andy — copy across |
| `«GRIEVANCE-OFFICER-ADDRESS-PENDING-E20-21»` | 741 | A postal address for data complaints. The only one of the four not already answered | Andy |
| `«DSR-ACK-DAYS-PENDING-E20-01»` | 752 | Working days to acknowledge a data-subject request | Andy, then confirm against the DPDP rules |
| `«DSR-RESPONSE-DAYS-PENDING-E20-01»` | 753 | Days to respond in full | Andy, same |

**The first three are already public and only unresolved here.** That is worth fixing regardless
of launch: an internal compliance record that disagrees with the published notice is the document
you would be judged against.

---

## 4. `docs/gst-invoicing.md` — 4 left, on a document parents receive

An invoice is a published document. These are not blocking a build only because invoice rendering
(`E07`) is not wired to this file yet — the moment it is, they must block. Raised as `E12-24`.

| Token | Line | What it needs | Who |
|---|---|---|---|
| `«LEGAL-NAME-PENDING-E00-10»` | 58 | Same registered name as the terms | Andy |
| `«ADDRESS-PENDING-E00-10»` | 58 | Same registered address | Andy |
| `«GSTIN-PENDING-E00-10»` | 56 | Same GSTIN | Andy |
| `«SAC-PENDING-E00-10»` | 57 | The SAC code for the service. **The accountant's**, not a guess — it decides the rate | Accountant |
| `«SIGNATURE-TREATMENT-PENDING-E00-10»` | 224 | Same sentence as `terms.md` line 77 | Accountant |

Three of these repeat facts from §2. **They should not be three separate answers** — see §6.

---

## 5. `docs/store-submission.md` — 1 token

| Token | Line | What it needs | Who |
|---|---|---|---|
| `«ACCOUNT-DELETION-URL-PENDING-E17-20»` | 108 | The public URL of the account-deletion page. Google requires a URL reachable **without signing in** | Andy, once the page exists (`E17-20`) — it can be a section of the privacy page |

---

## 6. One source — `E12-25`, done 2026-08-14

The legal name, the registered address and the GSTIN each appeared as a **separate token in two
documents**, with different task ids on them. Filling them meant answering the same question twice
and hoping the copies matched.

They now come from **`docs/legal/company.json`**. The documents keep their `«…»` tokens — they
stay readable as documents — and substitution happens at render time, in three places that all
read that one file:

| Reader | For |
|---|---|
| `apps/web/src/lib/policy.ts` | `/privacy`, `/terms`, `/refunds` |
| `scripts/build-policy-docs.mjs` | the app's policy gate |
| `scripts/check-placeholders.mjs` | this register |

**A `null` is never substituted.** Its token survives into the rendered document and
`assertPublishable` refuses to publish it, so this file cannot quietly turn an unanswered question
into a published claim by defaulting it to an empty string. `company.test.ts` asserts that the
same fact resolves identically in both documents, and that an unanswered one passes through
untouched.

Fill a value once, in `company.json`, and every document that states it changes together.

---

## 7. What is deliberately not in this register

- **`docs/legal/superseded/`.** Superseded drafts carrying old tokens, including four
  `-PENDING-ANDY` ones. They are history and are published nowhere.
- **`docs/open-questions.md`, `planning/`, `PROGRESS.md`, `docs/learnings.md`.** These mention the
  token convention in prose. None is a value awaiting an answer.
- **`apps/web/src/lib/policy.test.ts`.** Test fixtures using `«A»`, `«B»` and
  `«DATE-PENDING-E20-12»` to prove the guard works.

A sweep that counts those reports 33 tokens and is useless. The number that matters is **10
blocking**, and 12 more on documents that will be published but are not built yet.
