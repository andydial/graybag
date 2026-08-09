-- Reverses 0014_create_checkout.sql.
--
-- After this, nothing can create an order and assert_cutoff_open has no caller again —
-- the mechanism exists and enforces nothing, which is the state E05-07 left behind.
drop function if exists create_checkout(uuid, text, text, bigint, jsonb);
drop function if exists generate_order_ref();
