# Open questions

Grouped by who unblocks them. Items here block specific backlog tasks.

## Blocked on legal / regulatory advice

| Q | Blocks | Notes |
|---|---|---|
| **DPDP Act 2023** — what applies to GrayBag given it stores minors' names, class, section and **allergies (health data)** | All of `E20` | Verifiable parental consent, grievance officer, breach notification. The legacy app had none of this |
| **RBI Prepaid Payment Instrument rules** — does refund-only wallet credit fall outside PPI regulation? | `E06-10`, `E18-09`, `E18-10` | Refund credit is usually fine; **cash top-up** of stored value is regulated. Ask before building top-up |
| Data retention minimums for GST invoices | `E20-05` | Statutory; drives the purge policy |

## Blocked on Andy's accountant

| Q | Blocks | Notes |
|---|---|---|
| GSTIN for GrayBag | `E07-02` | Required on every invoice |
| SAC code — 996331 assumed for catering | `E07-02` | Needs confirming |
| Does the school's 10% revenue share attract 18% GST on the school's invoice to GrayBag? | `E07-09`, `E07-10` | Andy's position: any such tax comes out of the agreed 10%, not on top |

## Blocked on Andy

| Q | Blocks | Notes |
|---|---|---|
| Is the Excel `Price` GST-inclusive or exclusive? | `E04-04`, `E07-06` | Cart currently adds 5% on top, implying exclusive |
| Original dish images — can all be re-sourced? | `E04-13`, `E16-05` | Bubble CDN URLs die on migration |
| Bubble data export (row counts for users/children/orders/lines) | `E16-06` | Needed to size migration and spot junk data |
| **VAG Rounded Next licence** — does it permit app embedding and webfont use? | `E19-03`, `E00-16`, all of `E13` | A bad answer means a different typeface before any UI is built |
| Do any **legacy prepaid card / wallet balances** exist off-system? | `E00-18`, `E16-16` | If yes, they must migrate as opening ledger credits or users lose money at cutover |

## Blocked on the GrayBag team / schools

| Q | Blocks | Notes |
|---|---|---|
| **Subscription model — entire design** | All of `E18-01`…`E18-08` | Discussed once internally; needs a conversation with a school. For planning, assume parents subscribe |
| Who buys — parent in-app, or school in bulk billed through fees? | `E18-01` | Radically different builds |
| Auto-generated daily orders vs prepaid credit with daily selection? | `E18-02` | Leaning toward pre-planning a week/month, editable until each day's cutoff |
| Meal-pack composition and whether the customer picks dishes | `E18-03` | Likely they can pick |
| Unused meals — expire, roll over, refund? | `E18-04` | |
| Mid-period cancellation and pro-rata | `E18-05` | |
| Per-school / per-city subscription pricing | `E18-06` | Almost certainly needed once kitchens vary by city |

## Parked (deliberately, until real data exists)

| Q | Notes |
|---|---|
| Default delivery mode — classroom bulk vs counter pickup | Depends on whether a school orders school-wide or a handful per class. Both mechanisms are built |
| Per-dish daily capacity limits | Table designed (`E02-12`), unused until a kitchen asks |
| Play App Signing upload key ownership | Mandatory since Aug 2021 so almost certainly enabled; Google resets the upload key on request if Bubble holds it. Low risk |
