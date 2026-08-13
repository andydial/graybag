-- =============================================================================
-- 0031_invoice_buyer_name_optional.sql — the buyer's name is optional, exactly as far as the
-- law says it is. `E07-22`, `P18`.
-- =============================================================================
--
-- `invoice.buyer_name_snapshot` was `not null` with no default, and **every `app_user` in the
-- system has a null name**: nothing has ever written `app_user.first_name` (`0018`'s signup
-- trigger does not), and `P18`'s capture is optional, skippable, and deliberately lands *after*
-- payment. So the first invoice ever generated would have raised `23502` on its own constraint
-- — in production, with the money already taken, on a checkout that had otherwise succeeded.
--
-- Nothing has issued an invoice yet (`insert into invoice` appears nowhere outside a test
-- fixture), which is the only reason this is a migration rather than an incident.
--
-- =============================================================================
-- WHY THE COLUMN IS NULLABLE AND NOT A FALLBACK CHAIN
-- =============================================================================
--
-- The obvious fix is a chain: the name, else the email local-part, else something like
-- "GrayBag customer". Andy proposed one and then withdrew it on the research, which changed the
-- answer.
--
-- **CGST Rule 46 clause (f):** for a supply to an **unregistered** recipient where the value of
-- the taxable supply is **less than fifty thousand rupees**, the recipient's name and address
-- are required *only where the recipient requests that such details be recorded in the tax
-- invoice*. Clause (e) makes them mandatory at fifty thousand or more.
--
-- Every invoice GrayBag will issue in v1 is a school lunch — a few hundred rupees — and `P14`
-- keeps bulk class ordering out of scope. So the `not null` was **stricter than the law**, and
-- the constraint rather than GST would have been the thing that stopped an order.
--
-- Given that omission is lawful, a placeholder is worse than nothing:
--
--   * the email local-part is not a name. `anuragdial` on a tax invoice is a username, and
--     `app_user.email` is nullable anyway (`0018` stores null for Apple private-relay opt-out),
--     so the chain needs a third tier and the third tier is the same problem again;
--   * "GrayBag customer" is a label. Writing it into a document retained under §13.4 as the
--     statutory record states, in the buyer field, something that is not the buyer's name;
--   * **the recipient's own name is wrong twice.** The child is not the buyer — `M1` makes the
--     invoice GrayBag → the paying adult — and it would put a minor's name in the buyer field
--     of a document we must keep long after any erasure request, which is the opposite of what
--     non-negotiable #4 exists for.
--
-- =============================================================================
-- THE CHECK IS THE RULE, WRITTEN DOWN
-- =============================================================================
--
-- Dropping `not null` alone would leave the schema saying "a name is never required", which is
-- also false. The constraint below says what Rule 46 says: **required exactly when the law
-- requires it**, at fifty thousand rupees or more.
--
-- ₹50,000 is 5,000,000 paise (non-negotiable #3 — integer paise, everywhere).
--
-- It is a `check` rather than a trigger or an application rule because it must hold for every
-- writer including `service_role`, and because the failure it guards is one we would otherwise
-- discover from a customer holding a non-compliant invoice. If we ever do issue at that value,
-- this fails at write time and says why.
--
-- **`>=`, not `>`.** Clause (e) is "fifty thousand rupees or more".
-- =============================================================================

alter table invoice alter column buyer_name_snapshot drop not null;

alter table invoice add constraint invoice_buyer_name_required_above_threshold
  check (buyer_name_snapshot is not null or total_paise < 5000000);

comment on column invoice.buyer_name_snapshot is
  'The paying adult, not the child. Personal data tier A (§13.3); retained on erasure because it IS the statutory record (§13.4). NULLABLE since 0031 (E07-22): under CGST Rule 46(f) a buyer name is required on a supply to an unregistered recipient below ₹50,000 only where the recipient requests it, and every v1 invoice is far below that. NEVER write a placeholder here — not the email local-part, not "GrayBag customer", and never the recipient''s name (the child is not the buyer, M1). Omission is lawful; a fabricated buyer name in a statutory record is not. invoice_buyer_name_required_above_threshold enforces the other half of the rule.';

comment on constraint invoice_buyer_name_required_above_threshold on invoice is
  'CGST Rule 46(e): the recipient''s name and address are mandatory where the recipient is unregistered and the value of the taxable supply is fifty thousand rupees or more. Below that, Rule 46(f) makes them optional unless requested. 5000000 paise = ₹50,000. E07-22.';
