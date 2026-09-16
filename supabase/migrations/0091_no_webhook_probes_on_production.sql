-- A webhook probe cannot be written to production. `E21-84`.
--
-- Andy, 2026-09-17, on the row I left behind: *"the rule exists precisely because 'it touches no
-- money' is how every one of these starts."*
--
-- I wrote one `payment_webhook_event` row to production by `curl`ing the live endpoint with
-- `{"event":"probe.ignore"}` to check it still answered after a deploy. Non-negotiable #8 names
-- **webhook probes** explicitly, in that list, in those words. The row was inert — unverified,
-- `ignored`, never processed, no money — and that is exactly the reasoning the rule exists to
-- refuse. It has been deleted with Andy's approval; this is what stops the next one.
--
-- ## Where a guard can actually stand
--
-- `scripts/lib/prod-write-guard.mjs` cannot help here and CLAUDE.md says why in terms: *"The guard
-- cannot save you from a terminal, and that is the honest limit of it."* I did not use a script. I
-- used `curl`. So the guard has to be somewhere `curl` still has to go through, and the only such
-- place is the database.
--
-- ## What this refuses, and what it deliberately does not
--
-- **Refused on production:** an INSERT whose `event_type` is not a real Razorpay event. Razorpay's
-- vocabulary is `<entity>.<verb>` over a known set of entities; `probe.ignore` is in none of them,
-- and neither is anything else a person makes up to see whether an endpoint answers.
--
-- **Allowed, and it matters that they are:**
--
--   * `unparseable` — what the function writes for a malformed body from a *verified* sender. That
--     is a real event we could not read, and losing it would lose the evidence.
--   * any genuine Razorpay type with a **bad signature**. That is either an attack or a
--     misconfiguration, and `E06-28`'s alert depends on it being recorded. A guard that refused
--     unverified events would blind the alert that exists to catch them — which would be a worse
--     bug than the one it fixed.
--
-- So the line is not "verified or not", it is **"is this a thing Razorpay can send"**. A probe is
-- distinguishable from an attack by its vocabulary, not by its intent.
--
-- ## The honest limit, stated rather than glossed
--
-- Someone determined to probe production could use `payment.captured` as the event type and this
-- would allow it — it would be recorded unverified and ignored, exactly like a hostile request,
-- because at that point it IS indistinguishable from one. This closes the careless case, which is
-- the one that actually happened. It does not close the deliberate one, and nothing at this layer
-- could. `E21-85` adds the detector for what gets through.

begin;

create or replace function refuse_webhook_probe_on_production()
returns trigger
language plpgsql
as $$
declare
  v_environment text;
  v_entity      text;
begin
  select environment into v_environment from platform_config;
  if v_environment is distinct from 'production' then
    -- Staging and local are where probing is supposed to happen. Unchanged there, deliberately:
    -- a guard that made verification harder everywhere would push it back onto production.
    return new;
  end if;

  -- What the function itself writes when a verified body will not parse. Real, and kept.
  if new.event_type = 'unparseable' then
    return new;
  end if;

  v_entity := split_part(new.event_type, '.', 1);

  -- Razorpay's entity vocabulary. A type outside it did not come from Razorpay, whatever the
  -- signature says, so recording it proves nothing and writing it was somebody testing.
  if v_entity not in (
    'payment', 'order', 'refund', 'settlement', 'subscription', 'invoice',
    'payment_link', 'fund_account', 'transfer', 'account', 'virtual_account', 'payout'
  ) or position('.' in new.event_type) = 0 then
    raise exception
      'refusing to record webhook event type % on production — it is not a Razorpay event, so '
      'this is a probe (non-negotiable #8)', new.event_type
      using errcode = 'P0001', hint = 'webhook_probe_refused';
  end if;

  return new;
end;
$$;

create trigger trg_refuse_webhook_probe_on_production
  before insert on payment_webhook_event
  for each row execute function refuse_webhook_probe_on_production();

comment on function refuse_webhook_probe_on_production is
  'E21-84. A made-up event type cannot be recorded on production, so probing the live webhook by '
  'hand fails instead of leaving a row. Deliberately does NOT key on signature_verified: a '
  'genuine Razorpay type with a bad signature must still be recorded, because E06-28''s alert is '
  'what makes an attack or a missing secret visible. The line is the vocabulary, not the trust.';

commit;
