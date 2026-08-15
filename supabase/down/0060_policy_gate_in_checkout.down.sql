-- Rollback for 0060.
--
-- Removing the guard returns `create_checkout` to the state `0001`'s comment already described
-- incorrectly: an ordering gate that exists only in the client. If this is rolled back while any
-- policy_version sets `blocks_ordering`, orders will be accepted from customers who have not
-- accepted the current wording — and nothing will say so.
--
-- The function is left in place; only the call is removed, so the guard can be re-attached
-- without re-creating it.
do $$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_checkout';
  if v_src is null then return; end if;
  v_new := regexp_replace(
    v_src,
    E'\\n[^\\n]*-- `E20-55`[^\\n]*\\n[^\\n]*\\n[^\\n]*\\n[^\\n]*perform assert_policies_accepted\\(p_customer_user_id\\);',
    '', 'g');
  if v_new <> v_src then execute v_new; end if;
end;
$$;

notify pgrst, 'reload schema';
