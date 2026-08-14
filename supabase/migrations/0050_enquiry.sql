-- `E12-15` — the enquiry table, written to `docs/enquiry-submission-contract.md` §2.
--
-- Replaces the legacy Bubble `Interest_Submission`. `reason_to_use` and `most_important_thing`
-- are deliberately dropped: survey questions answered by nobody in a hurry, and a longer form on
-- a patchy connection converts worse.
--
-- **The payments thread's unmerged branch also has a `0050`** — `0050_one_confirmation_email.sql`
-- on `e06-02-e06-16-e08`, already applied to staging by hand. Whichever of the two merges second
-- renumbers, and `check-migrations` catches the clash as `duplicate-version` rather than letting
-- it through: versions are permanent and unique.
--
-- 0051 was the first attempt, to sidestep that. It is worse. `check-migrations` requires
-- consecutive versions with no gaps, and its reasoning is right — a gap means a migration was
-- dropped or renumbered, so the applied order no longer matches the committed order on some
-- database somewhere. A loud duplicate at merge beats a silent gap for ever.

create type enquiry_role as enum (
  'principal',
  'vice_principal',
  'administrator',
  'canteen_manager',
  'management',
  'other'
);

create table public.enquiry (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  name          text  not null check (length(btrim(name))    between 2 and 80),
  role          enquiry_role not null,
  school        text  not null check (length(btrim(school))  between 2 and 120),
  city          text  not null check (length(btrim(city))    between 2 and 60),
  email         text  not null check (length(email) <= 254 and position('@' in email) > 1),

  -- Stored as text, never as a number. The legacy `mobile` column was a Bubble *number* field
  -- and lost every leading zero and every `+91` it was ever given.
  phone         text  not null check (phone ~ '^\+91[6-9][0-9]{9}$'),
  message       text  null     check (message is null or length(message) <= 2000),

  -- Operational, not content. Who has picked this up and what came of it.
  status        text  not null default 'new'
                  check (status in ('new', 'contacted', 'qualified', 'declined', 'spam')),
  notes         text  null,

  -- Provenance. **No IP address and no user agent**: neither is needed to answer an enquiry,
  -- and both are personal data we would then have to justify holding.
  source        text  not null default 'website'
);

create index enquiry_created_at_idx on public.enquiry (created_at desc);

-- Default-deny, non-negotiable #2.
--
-- **No policy for `anon` or `authenticated`, and that is the whole design.** Nothing may read or
-- write this table through PostgREST. Inserts arrive only via `enquiry-submit`'s service role;
-- back-office reads come later through a scoped grant (`D3`), when there is a screen to read
-- them. An `anon` insert policy would put a public, unrate-limited write endpoint on the
-- database and would break `A4`.
alter table public.enquiry enable row level security;

revoke all on public.enquiry from anon, authenticated;

comment on table public.enquiry is
  'School enquiries from the public website. Written only by the enquiry-submit Edge Function '
  '(service role); no anon or authenticated policy exists by design. See '
  'docs/enquiry-submission-contract.md.';

-- ---------------------------------------------------------------------------- rate limiting

-- Per-IP counters for `enquiry-submit`, §7: 10 per hour, 30 per day.
--
-- The IP is **hashed and never stored in the clear**, and never lands on the enquiry row — §2's
-- table has no `ip` column deliberately, so that answering enquiries does not turn into a log of
-- who visited the site. This table holds a hash, a window and a count, and nothing else.
--
-- A school with several administrators behind one NAT is a real case, which is why the limits
-- catch volume rather than enthusiasm.
create table public.enquiry_rate (
  ip_hash       text        not null,
  window_start  timestamptz not null,
  window_length interval    not null,
  hits          integer     not null default 0 check (hits >= 0),
  primary key (ip_hash, window_length, window_start)
);

alter table public.enquiry_rate enable row level security;
revoke all on public.enquiry_rate from anon, authenticated;

comment on table public.enquiry_rate is
  'Hashed-IP rate counters for enquiry-submit. Never joined to enquiry, never stores an IP in '
  'the clear, and safe to delete wholesale.';

/**
 * Count a hit and say whether it is over the limit, in one round trip.
 *
 * Doing this as a function rather than a read-then-write from the Edge Function matters: two
 * concurrent submissions would both read the old count and both write the same new one, so a
 * burst slips straight through the limit it was meant to hit. `on conflict do update` makes the
 * increment atomic.
 *
 * `security definer` because the caller is the service role and the table is default-deny.
 */
create or replace function public.enquiry_rate_hit(
  p_ip_hash text,
  p_window  interval,
  p_limit   integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_hits  integer;
begin
  -- Fixed windows, not sliding: cheaper, and the difference does not matter at ten an hour.
  v_start := date_trunc('hour', now());
  if p_window >= interval '1 day' then
    v_start := date_trunc('day', now());
  end if;

  insert into enquiry_rate (ip_hash, window_length, window_start, hits)
  values (p_ip_hash, p_window, v_start, 1)
  on conflict (ip_hash, window_length, window_start)
  do update set hits = enquiry_rate.hits + 1
  returning hits into v_hits;

  -- Old windows are never read again; clearing them here keeps the table from growing without
  -- needing a scheduled job for a handful of rows a day.
  delete from enquiry_rate where window_start < now() - interval '2 days';

  return v_hits > p_limit;
end;
$$;

revoke all on function public.enquiry_rate_hit(text, interval, integer) from public, anon, authenticated;
