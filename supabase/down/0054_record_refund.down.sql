-- Rollback for 0054.
--
-- `record_refund` goes first: it calls `issue_credit_note`, and dropping the callee first would
-- leave a function that raises `42883` on every refund rather than one that does not exist.
--
-- **Credit notes already issued are left in place.** They carry numbers out of the gapless
-- series, and a gap in a statutory series is a harder thing to explain than a document that
-- exists. `issue_credit_note` is idempotent per invoice, so re-applying this migration finds
-- them rather than issuing seconds.
drop function if exists record_refund(text, text, bigint, text);
drop function if exists issue_credit_note(uuid, uuid);

notify pgrst, 'reload schema';
