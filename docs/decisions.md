# Decision log — index

Every decision **currently in force**, with the reasoning, split one file per area under
`docs/decisions/`. This file is the index and holds no decisions itself.

**Read this index, then open only the areas you are about to touch.** The full log is ~85 KB;
reading it whole on every task is what made it expensive. If you change a decision, change it
in the same PR as the code — never silently diverge (`DOC1`).

**Decision IDs are permanent.** `M2` is `M2` wherever it lives; splitting the file moved no
ID. Cite them bare (`SUB1`, `PY3`) as every other document already does — do not cite a path.

Superseded entries and the build-log narrative are in `docs/decisions-archive.md`. That file is
history and is **never authoritative**: if it disagrees with an area file, the area file wins.
You do not need to read it to make a change — only to understand why a decision was reversed.

| Area | IDs | Scope |
|---|---|---|
| [Architecture](decisions/architecture.md) | `A1`–`A8` | Stack, hosting, the `api/` module rule, observability |
| [The `api/` module rule](decisions/api-module.md) | `AP1`–`AP4` | How `A4` is enforced: the lint gate, the shared `no-restricted-syntax` slot, the write ban |
| [Data model](decisions/data-model.md) | `D1`–`D18` | Roles, recipients, config chain, ledger, money types, RLS default-deny |
| [Auth](decisions/auth.md) | `U1`–`U5` | Google / Apple / email-OTP, no passwords, sender identity, and how a signed-out user reads the menu |
| [Product](decisions/product.md) | `P1`–`P16` | Attendance, delivery, reports, offline, device tier |
| [Navigation and the app shell](decisions/navigation.md) | `NV1`–`NV9` | One graph, one gate reached by intent, four tabs, the AR7 assertion, the menu screen |
| [Network resilience](decisions/network.md) | `NR1`–`NR4` | Per-attempt timeouts, full jitter, what is never retried, and why a write is not |
| [Money](decisions/money.md) | `M1`–`M9` | Seller of record, GST split, invoice numbering, revenue share, refunds |
| [Design system and motion](decisions/design-system.md) | `S1`–`S38` | Closed motion catalogue, duration/easing tokens, the 500 rule, contrast bar, lint gates |
| [Order lifecycle](decisions/order-lifecycle.md) | `L1`–`L9` | The state machine, cutoff snapshotting, `paid` means captured |
| [Payments integration](decisions/payments.md) | `PY1`–`PY9` | Razorpay secrets, webhook contract, refund arithmetic, reconciliation |
| [Menu import and the cache token](decisions/menu-import.md) | `MI1`–`MI13`, `MC1`–`MC5` | Blank allergens mean unknown, plan-then-apply, and what bumps `school_menu_version` |
| [GST and invoicing](decisions/gst-invoicing.md) | `G1`–`G10` | Per-line rounding, CGST/SGST computed independently, gapless series |
| [Consent, retention and DPDP](decisions/dpdp.md) | `C1`–`C9` | Consent atomicity, purpose immutability, retention as data, breach clock |
| [Release](decisions/release.md) | `R1`–`R8` | Closed beta, cutover freeze window, rollback-by-default gates |
| [Policy documents](decisions/policy-documents.md) | `PP1`–`PP4` | Cross-reference not duplicate, retention tokens, allergy disclaimer |
| [Store submission](decisions/store-submission.md) | `SUB1`–`SUB3` | Declarations derived from the policy, no tracking, no ad ID |
| [Secret rotation and testing](decisions/secrets-and-testing.md) | `SR1`–`SR3` | Where secrets live, what gates merge, what CI cannot prove |
| [Migrations](decisions/migrations.md) | `MG1`–`MG6` | Rollback location, reversibility, version numbering, immutability |
| [Environments and secrets](decisions/environments.md) | `EN1`–`EN11` | Test/live key isolation, load-time assertions, `secrets:set`, the client `.env` pattern, OTA |
| [CI](decisions/ci.md) | `CI1`–`CI4` | Smoke test only on PR, integration on `supabase/**` |
| [Seed data](decisions/seed-data.md) | `SD1`–`SD5` | Fixed UUIDs, no orders/money, fixtures chosen for untestable states |
| [Deployment](decisions/deployment.md) | `DP1`–`DP5` | Environment approval gate, branch policies, the repo is public |
| [Branch protection](decisions/branch-protection.md) | `BP1`–`BP4` | No bypass actors, PR required, strict status checks |
| [Scope confirmations](decisions/scope-confirmations.md) | `SC1`–`SC3` | Mohali only; menu prices GST-exclusive; Amity launches with zero migration |
| [Authorization fixes](decisions/authorization-fixes.md) | `AZ8`–`AZ10` | Fulfilment scope binding found by running the suite |
| [Legacy assets outside git](decisions/legacy-assets.md) | `RH1`–`RH4` | Why the 46 MB design package and the fonts are not in history |
| [The privilege baseline](decisions/privilege-baseline.md) | `PB1`–`PB5` | GRANT written down, not inherited from the platform |
| [Bubble export constraints](decisions/bubble-export.md) | `BR1`, `BR3`–`BR5`, `BR7` | Migration key, draft orders, label mapping, regulated free text |
| [Andy's rulings on the recon findings](decisions/recon-rulings.md) | `AR1`–`AR8` | Parent↔child from orders, binary roles, the moving email domain |
| [Documentation](decisions/documentation.md) | `DOC1` | Why the decision log is one index plus per-area files |

## Finding a decision by ID

```bash
grep -rn '^| M2 ' docs/decisions/          # one decision
grep -rln 'PY3' docs/ planning/            # everywhere it is cited
```
