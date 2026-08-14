---
title: The placeholder register
status: Live. Regenerate the counts with `npm run check:placeholders` before relying on them.
covers: Every unresolved `«…-PENDING-…»` token on a surface we publish
audience: Andy, filling these in; and whoever adds the next one
---

# Every placeholder we publish

One list, because scattered findings do not get finished. Each row says **what it is**, **what it
needs**, and **who can supply it**.

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

## 2. `docs/terms.md` — 10 tokens, and these block the build

### Facts you already have (7)

| Token | Line | What it needs |
|---|---|---|
| `«GRAYBAG-LEGAL-ENTITY-NAME-PENDING-E20-01»` | 28 | Registered company name, exactly as on the incorporation certificate |
| `«GRAYBAG-REGISTERED-ADDRESS-PENDING-E20-01»` | 28 | Registered office address |
| `«GRAYBAG-GSTIN-PENDING-E00-10»` | 29 | The 15-character GSTIN |
| `«GRAYBAG-SUPPORT-EMAIL-PENDING-E20-01»` | 173 | Support address. `U4` forbids a `no-reply@` anywhere |
| `«GRIEVANCE-OFFICER-EMAIL-PENDING-E20-21»` | 174 | **Already answered elsewhere** — the published privacy policy §7A names Vivek, `vivek@graybag.com`. Copy it here rather than deciding again |
| `«JURISDICTION-CITY-PENDING-E20-01»` | 165 | The city whose courts hear disputes. Mohali or Chandigarh |
| `«TERMS-EFFECTIVE-DATE-PENDING-E20-12»` | 18 | The "Last updated" date. Today, when you publish |

**Who:** Andy, today. Six are company facts; the seventh is already published in the privacy
policy and only needs copying across so the two documents agree.

### The accountant's answer (1)

| Token | Line | What it needs |
|---|---|---|
| `«SIGNATURE-TREATMENT-PENDING-E00-10»` | 77 | One sentence on whether invoices carry a digital signature or state that none is required. The same answer fills `docs/gst-invoicing.md` line 224 |

**Who:** the accountant (`E00-10`). One question, and it settles two documents.

### Wording, not values (2)

| Token | Line | What it needs |
|---|---|---|
| `«ALLERGY-LIABILITY-WORDING-PENDING-E20-01»` | 130 | The allergy-liability clause |
| `«LIABILITY-CAP-WORDING-PENDING-E20-01»` | 150 | The liability-cap clause |

**These two are different in kind from the other eight, and worth pausing on.** They are not
values to paste; they are legal language about health and safety and about how much we owe when
something goes wrong. `E20-25` is a `risk:high` task for exactly these two, and the document says
in place that each must be reviewed by a lawyer.

If the legacy application published terms, lift both clauses from there — that is the same "reuse
what is already approved" move that makes the privacy and refund policies fine, and it needs no
lawyer. **If the legacy app had no terms of service, these two are the genuine gap**, and the
honest options are to have them reviewed or to publish terms without a liability cap at all,
which is a decision rather than an oversight.

---

## 3. `docs/dpdp-compliance.md` — 6 tokens, none of them blocking

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

## 4. `docs/gst-invoicing.md` — 5 tokens, on a document parents receive

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

## 6. The shape problem underneath this

The legal name, the registered address and the GSTIN each appear as a **separate token in two
different documents**, with two different task ids on them. Filling them means answering the same
question twice and hoping both copies match — and an invoice whose GSTIN disagrees with the terms
is a worse outcome than either being blank.

They should come from one place. `packages/shared/src/config` or a small `docs/legal/company.md`
that both documents cite. Raised as `E12-25`, deliberately **not** done as part of this register:
it changes how two published documents are assembled, and that is worth doing deliberately rather
than in the same pass as writing the list.

Until then, fill them in this order so the copies cannot drift:

1. `docs/terms.md` — the legal name, address and GSTIN.
2. `docs/gst-invoicing.md` — paste the same three, verbatim.
3. `docs/dpdp-compliance.md` — the grievance block, copied from the published privacy policy.

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
