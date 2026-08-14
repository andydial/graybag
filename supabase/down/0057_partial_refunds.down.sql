-- Rollback for 0057.
--
-- **This does not restore `0054`'s bodies**, and that is deliberate rather than lazy. Rolling
-- back to them would reinstate `partial_refund_unsupported` — the refusal Andy called a state he
-- cannot operate in — and, worse, would restore `issue_credit_note`'s keying on the *invoice*
-- rather than the refund, under which a second partial refund silently returns the first refund's
-- credit note and goes undocumented. That is rolling forward into a defect.
--
-- Dropping `post_refund_reversal` alone is the meaningful step: `record_refund` then fails loudly
-- on every refund rather than posting a wrong one. `0054`'s bodies are in that file if they are
-- ever genuinely wanted.
--
-- **Credit notes and ledger postings already written are left alone.** They carry numbers out of
-- the gapless series and they record money that really moved.
drop function if exists post_refund_reversal(uuid, uuid, bigint, bigint, refund_destination, text);

notify pgrst, 'reload schema';
