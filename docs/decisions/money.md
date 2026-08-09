# Decisions — Money

`M1`–`M9` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

| # | Decision | Why |
|---|---|---|
| M1 | **GrayBag is seller of record**; kitchens are paid monthly | Determines who invoices the parent and how GST flows. |
| M2 | 5% GST, shown as **CGST 2.5% + SGST 2.5%** | Place of supply Mohali / SAS Nagar — intra-state. Cart currently shows a single lump "5% tax", which is not compliant. |
| M3 | **Gapless sequential invoice numbers per financial year** | Statutory. Failed payments must not burn numbers — needs deliberate design. |
| M4 | School revenue share **10% default, editable per school by Admin only** | Via the config chain (D5). |
| M5 | Razorpay **MDR on refunds comes out of the school's share** | Andy's decision. |
| M6 | Settlement is **manual bank transfer**; Razorpay Route deferred | Admin report computes what is owed, allows an edit, then mark-as-paid. |
| M7 | **Refund to wallet by default**, refund-to-source as an option | Instant vs T+5 days, and cheaper. Wallet *top-up* UI is deferred; the balance and the ledger are not. |
| M8 | Any tax incurred on the school share comes **out of the agreed 10%** | GrayBag pays no tax on top of the share. |
| M9 | **The ledger's sign convention is structural, not a convention** — `E06-31`, migration `0013`. Three things: a CHECK constraint pins `normal_balance` per `account_type` (wallet, payable, tax_payable, revenue → credit; receivable, provider_clearing, provider_fees, suspense → debit); `ledger_balance(account_id)` is the **only** way to read a balance and consults the account's own `normal_balance`; and `assert_ledger_integrity()` checks structural invariants nightly rather than recomputing a derived balance. Also seeds the eleven `category = 'ledger'` reason codes (`E06-22`), without which no posting could be written at all. | Andy's ruling 2026-08-10: resolve it structurally rather than by picking a convention and writing it down. **The failure being designed out is one that does not look like a bug.** A wallet is a liability and a provider clearing account is an asset, so their balances run in opposite directions. A single-signed `balance()` helper — "debits minus credits" — returns plausible numbers for both and correct ones for half, and the nightly assertion meant to catch the drift is the thing computing it wrongly. The numbers are numbers; nothing is red. Making the mapping a constraint means a wallet cannot be *created* debit-normal, and making the balance function consult the account means a caller cannot pick a sign at all — there is only one helper and it decides. The nightly check deliberately does **not** compare two derivations of the same quantity, because two derivations sharing one sign error agree with each other and the check passes in exactly the case it exists for. What it does compare is `wallet_balance` against the ledger (`I8`, `[DM-04]`), which earns its place because those two are maintained by different code paths. Zero-sum-per-transaction was already enforced by a deferred constraint trigger in `0001` and is untouched. Still missing: `bank` on `ledger_account_type` (`E06-23`), left out because `ALTER TYPE … ADD VALUE` cannot be used in the transaction that adds it and the pairing belongs with the settlement work. |

