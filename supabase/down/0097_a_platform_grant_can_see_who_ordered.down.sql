-- Rollback for `0097`. `E09-46`.
--
-- Restores `0095`'s guard verbatim, including its bug: a platform-scoped `orders.view_pii` and the
-- platform owner both read nothing, so every Super Admin sees "Ordered by — not shown" again while
-- kitchen-scoped accounts keep working.
--
-- Written out rather than left as "irreversible" because it genuinely is reversible, and the
-- honest rollback of a fix is the broken state — not a third behaviour invented for the occasion.

begin;

create or replace view kitchen_order_contact as
  select o.id  as order_id,
         u.email as customer_email
    from "order" o
    join app_user u on u.id = o.customer_user_id
   where auth_is_live_user()
     and u.deleted_at is null
     and exists (
       select 1
         from permission_grant g
        where g.user_id         = (select auth.uid())
          and g.permission_code = 'orders.view_pii'
          and g.revoked_at is null
          and (g.expires_at is null or g.expires_at > now())
          and (
               (g.scope_type = 'school' and g.scope_id = o.school_id)
            or (g.scope_type = 'kitchen'
                and exists (select 1 from school s
                             where s.id = o.school_id and s.kitchen_id = g.scope_id))
          )
     );

commit;
