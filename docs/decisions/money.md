# Decisions — Money

`M1`–`M8` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

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
