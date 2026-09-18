-- Rollback for `0095`. `E09-46`.
--
-- Genuinely reversible, unlike most of the pack migrations around it: `0095` adds one view and
-- takes nothing away, so dropping it restores the previous state exactly. No table changed, no
-- policy changed, no function was replaced.
--
-- What this costs if it is ever run: the Kitchen screen stops showing who placed each order and
-- renders "not shown" on every card. It does not break the board —
-- `fetchKitchenOrderContacts` returns `{}` on a missing relation by design, which is the case
-- this rollback creates and `kitchen-contact.test.ts` asserts directly.

begin;

drop view if exists kitchen_order_contact;

commit;
