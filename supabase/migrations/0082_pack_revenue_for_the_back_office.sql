-- =============================================================================
-- `E21-63`. The back office can tell pack-paid meals from cash revenue — without meeting a child.
--
-- Andy, 2026-08-28: *"a back-office account can't read `meal_pack_redemption` at all, so Reports
-- and Today can't separate pack-paid meals from cash revenue. The web thread correctly refused to
-- render '0 paid with a pack' when the truth is 'we can't see'. Add a back-office read policy,
-- gated on `orders.view_financials` at platform scope. Aggregates and order references only — no
-- child identity through that path."*
--
-- ## Why this is a VIEW and not the read policy that was asked for
--
-- `meal_pack_redemption.recipient_id` is **which child ate** — tier-S data about a named minor
-- (non-negotiable #4). RLS filters rows and cannot filter columns, so a back-office SELECT policy
-- on the table would hand over `recipient_id` for every redemption in the system. That is
-- precisely the constraint Andy attached to the request, and a row policy cannot satisfy it.
--
-- Nor can a column grant. There is exactly **one** `authenticated` role, shared by parents and
-- back-office accounts, and a parent legitimately reads `recipient_id` for their own redemptions
-- through `meal_pack_redemption_read_own` — they are entitled to know which of their children the
-- meal was for. `revoke select (recipient_id)` would take that away from parents too. No policy
-- and no column grant can express "this authenticated user but not that one". A `where` clause
-- can. This is `E02-36`'s finding, in a second place.
--
-- So the back office gets a view that **does not contain the column at all**, and the base table
-- gets no new policy. The distinction matters: a back-office account cannot reach child identity
-- here — not "is not supposed to", but cannot, because nothing admits them to the table.
--
-- ## The second definer exception, argued as hard as the first
--
-- `authorization.test.sql` requires every view in `public` to be `security_invoker`, because a
-- definer view skips the base table's policies and fails **silently** — it simply returns rows it
-- should not. `order_money` (`E02-36`) was the first deliberate exception and the suite says a
-- second should be argued for as hard. The argument:
--
--   · An **invoker** view would run under the caller's policies, and the back office has none on
--     this table, so it would return nothing to the one audience it exists for. Adding a policy to
--     fix that reintroduces the `recipient_id` leak this design exists to prevent — the invoker
--     route cannot be made safe, rather than merely being less convenient.
--   · Definer is **narrower here than for `order_money`**, which needed it to survive a `revoke`.
--     Nothing is revoked. The privilege this view holds is used for one query returning nine
--     columns, none of which identifies a person.
--
-- **The price of the exception is restating every restriction bypassed**, so the predicate leads
-- with `auth_is_live_user()` to cover the RESTRICTIVE `deny_dead_accounts` a definer view skips.
--
-- ## And it is redundant TODAY, which was worth finding out rather than assuming
--
-- Mutation-checking removed the clause and **every assertion still passed**. The reason is real,
-- not a gap in the tests: this view's only route in is `auth_can_platform`, which resolves through
-- `auth_has_permission`, which already requires `is_disabled = false and deleted_at is null`. A
-- disabled account is refused one step earlier.
--
-- `order_money` is different and genuinely needs it — its predicate has a customer half
-- (`customer_user_id = auth.uid()`) that asks no such question, which is exactly the hole the
-- `E02-36` review found. Here there is no customer half by design.
--
-- **Kept anyway, with the reason stated rather than a false claim about what it prevents.** It
-- costs one function call on a back-office report, and it is what keeps the view honest the day
-- somebody adds a second permissive branch — which is precisely how `order_money` acquired the
-- hole. What is NOT true, and what an earlier draft of this comment said, is that removing it
-- fails a test. It does not, and a comment asserting a test that cannot fail is worse than no
-- comment.
-- =============================================================================

begin;

/**
 * Pack redemptions as money, for the back office only.
 *
 * `auth_can_platform` rather than `auth_can` — **platform scope only**, as asked. A school- or
 * kitchen-scoped grant does not open this: pack revenue is a whole-business figure, and a
 * kitchen operator holding `orders.view_financials` for their own kitchen has no business reading
 * the revenue recognised across every school.
 *
 * There is deliberately **no customer half** to this predicate. A parent reads their own
 * redemptions through `meal_pack_redemption_read_own` on the base table, where they can see
 * `recipient_id` and should. Adding them here would be a second path to the same rows with
 * different columns, and two paths to one fact is how they come to disagree.
 *
 * `reversed_at` is exposed because a reversed redemption is not revenue and a report that counted
 * it would overstate the business. `reversal_reason` is NOT: it is free text written by an
 * operator about a cancellation, and free text near a child's meal is where identity leaks back
 * in through the one column nobody audits.
 */
create or replace view meal_pack_redemption_money as
  select r.id,
         r.order_id,
         o.order_ref,
         r.meal_pack_id,
         r.service_date,
         r.revenue_paise,
         r.tax_paise,
         r.redeemed_at,
         r.reversed_at
    from meal_pack_redemption r
    join "order" o on o.id = r.order_id
   where auth_is_live_user()
     and auth_can_platform('orders.view_financials');

grant select on meal_pack_redemption_money to authenticated;

comment on view meal_pack_redemption_money is
  'E21-63. The only back-office path to pack revenue. Deliberately WITHOUT recipient_id: RLS '
  'filters rows not columns, and one authenticated role is shared by parents and admins, so a row '
  'policy on the base table would expose which child ate every meal. Definer (the second '
  'deliberate exception after order_money) because an invoker view would return nothing to the '
  'only audience it has. Platform scope only — pack revenue is a whole-business figure.';

commit;
