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
> **5 tokens block a build, down from 10. 8 more on surfaces not yet built, down from 12.**

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
| `«GRAYBAG-LEGAL-ENTITY-NAME-PENDING-E20-01»` | Graybag Pty Ltd |
| `«GRAYBAG-SUPPORT-EMAIL-PENDING-E20-01»` | info@graybag.com |
| `«JURISDICTION-CITY-PENDING-E20-01»` | SAS Nagar (Mohali), India |
| `«GRIEVANCE-OFFICER-EMAIL-PENDING-E20-21»` | vivek@graybag.com — copied from privacy §7A |
| `«TERMS-EFFECTIVE-DATE-PENDING-E20-12»` | 2026-08-14 |

**`Graybag Pty Ltd` is worth one look before it reaches a tax document.** `Pty Ltd` is an
Australian suffix and everything around it is Indian — a GSTIN, SAS Nagar jurisdiction, DPDP, 5%
GST as CGST + SGST. An Australian entity can hold an Indian GST registration through a branch, so
it is not necessarily wrong; it is the combination most likely to be a slip, and an invoice is the
worst place to find out.

### Still outstanding (5)

| Token | Who | Note |
|---|---|---|
| `«GRAYBAG-REGISTERED-ADDRESS-PENDING-E20-01»` | Andy | Checking the filed details rather than typing from memory |
| `«GRAYBAG-GSTIN-PENDING-E00-10»` | Andy | Same |
| `«SIGNATURE-TREATMENT-PENDING-E00-10»` | Accountant | On the accountant list, not blocking |
| `«ALLERGY-LIABILITY-WORDING-PENDING-E20-01»` | Andy — **decision** | See below |
| `«LIABILITY-CAP-WORDING-PENDING-E20-01»` | Andy — **decision** | See below |

### The two liability clauses: there is nothing to lift

Checked 2026-08-14. **`graybag.com` serves a placeholder page** — no terms, no privacy, no links
of any kind. And `docs/legal/` holds a baseline for the privacy policy and the refund policy only:
both were supplied by Andy on 2026-08-11 as the lawyer-drafted texts published for the legacy
Bubble application. **There is no terms baseline, because the legacy application never published
terms.**

So the reuse that makes the other two documents fine does not exist here. The options are a real
choice rather than an oversight:

1. **Have the two clauses reviewed** (`E20-25`, already `risk:high`). Slowest, and the only one
   that ends with language somebody has stood behind.
2. **Publish terms without a liability cap.** Lawful, and it means the cap is whatever the law
   gives us rather than what we asked for.
3. **Adapt the clauses from the privacy policy's approved register.** Cheapest, and the weakest:
   the privacy policy's lawyer approved a privacy notice, not an allergy disclaimer.

Andy's call. The rest of the document is publishable without it.

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
