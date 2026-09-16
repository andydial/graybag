-- Down for `0091`. Production accepts made-up webhook event types again.
--
-- Running this does not restore a behaviour, it removes a guard — and the guard exists because the
-- thing it stops already happened once. If it is in the way, the question to ask is what needed
-- probing on production and whether staging could have answered it (non-negotiable #8).
begin;
drop trigger if exists trg_refuse_webhook_probe_on_production on payment_webhook_event;
drop function if exists refuse_webhook_probe_on_production();
commit;
