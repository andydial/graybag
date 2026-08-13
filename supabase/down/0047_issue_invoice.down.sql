-- Rollback for 0047 — nothing issues a tax invoice.
--
-- Settlement still works (`0046` calls this only if it exists after `0048`), so customers are
-- charged and orders confirmed with **no tax document**. Invoices already issued are left alone:
-- they are the statutory record, and `invoice_sequence` keeps its counter so that re-applying
-- this migration continues the series rather than restarting it and colliding.
drop function if exists issue_invoice(uuid);
drop function if exists financial_year_at(timestamptz, text);
