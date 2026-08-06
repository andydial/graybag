-- =============================================================================
-- 0001_initial_schema.sql — GrayBag target schema
-- =============================================================================
--
-- Generated from docs/data-model.md (Q01) and nothing else. Where this file and
-- that document disagree, the document is right and this file is a bug.
--
-- Section numbers in the comments below (§4.1, §8.4, …) refer to that document.
-- Decision references (D5, M2, P4, …) refer to docs/decisions.md.
-- Open decisions are marked [DM-nn] and are listed in docs/open-questions.md.
-- Nothing marked [DM-nn] is settled; where a placeholder was needed to make the
-- schema coherent, the recommended option is used and labelled as such.
--
-- Non-negotiables this file enforces (CLAUDE.md):
--   * All money is integer paise in a bigint column named `*_paise`. No floats,
--     no numeric, no rupees, anywhere.
--   * All percentages are integer basis points in a column named `*_bps`.
--   * Row Level Security is enabled on every table in `public` with no policies,
--     which is default deny. Policies are added by 0002 (Q03/Q04).
--   * Children's data is regulated. Sensitive columns carry a COMMENT naming
--     their tier from §13.3 so the E20-09 / E20-10 tests can find them from
--     pg_description rather than from a hand-maintained list in application code.
--
-- What is deliberately NOT here:
--   * RLS policies                      -> 0002_rls_policies.sql (Q04)
--   * The order state-machine trigger   -> docs/order-lifecycle.md (Q06, E06-05)
--   * Allergen seed rows                -> blocked on [DM-13] / Q08
--   * Real retention day counts         -> blocked on E20-01 / E20-05
--
-- Ordering of this file is by dependency, not by document section, so it applies
-- top to bottom.
--
-- There is deliberately no explicit BEGIN/COMMIT: the Supabase migration runner
-- already wraps each file in a transaction, and a nested BEGIN would warn and then
-- commit the outer transaction early.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Preconditions and extensions
-- -----------------------------------------------------------------------------

-- app_user.id is the Supabase Auth user id (§4.1), so this schema only applies to
-- a Supabase-flavoured database. Fail here with a readable message rather than
-- three hundred lines later with a confusing foreign-key error.
do $$
begin
  if to_regclass('auth.users') is null then
    raise exception 'auth.users is missing. This migration requires a Supabase database (run `supabase start` locally). See docs/learnings.md.';
  end if;
end
$$;

-- gen_random_uuid() is in core Postgres from 13 onwards, so pgcrypto is not needed.
create extension if not exists citext;      -- case-insensitive email (§4.1)
create extension if not exists btree_gist;  -- uuid `WITH =` in the gist exclusion
                                            -- constraints on menu_assignment (§6.5)
                                            -- and menu_item_price_override (§6.6)

-- Migration staging lives in its own schema so it can be dropped wholesale after
-- cutover and can never be confused with live data (§12.5).
create schema if not exists migration;

-- -----------------------------------------------------------------------------
-- 1. Enum types (§13.1)
--
-- Enum vs lookup table follows §1.6: a native enum is used only for closed
-- technical sets the application branches on. Business sets that admin will
-- extend without a deploy (dish_category, allergen, reason_code, permission,
-- consent_purpose, policy_document) are tables.
--
-- Note that `ALTER TYPE … ADD VALUE` cannot be used in the same transaction that
-- adds it, which makes enum growth awkward in a migration — a second reason the
-- enum set is kept small.
--
-- A handful of closed sets in the document (device platform, notification channel
-- and category, notification delivery status, payout line kind) are NOT in the
-- §13.1 enum inventory. Those are implemented as text with a CHECK listing exactly
-- the documented values, rather than inventing enum types the model does not name.
-- -----------------------------------------------------------------------------

create type institution_type        as enum ('school', 'college');
create type guardian_relationship   as enum ('self', 'mother', 'father', 'guardian', 'carer', 'staff');
create type allergy_severity        as enum ('intolerance', 'allergy', 'anaphylaxis');
create type allergen_presence       as enum ('contains', 'may_contain');
create type food_type               as enum ('veg', 'non_veg', 'egg');
create type menu_status             as enum ('draft', 'active', 'retired');
create type delivery_mode           as enum ('classroom', 'counter');
create type order_group_status      as enum ('draft', 'pending_payment', 'paid', 'payment_failed', 'cancelled', 'refunded', 'partially_refunded');
create type order_status            as enum ('draft', 'pending_payment', 'paid', 'preparing', 'delivered', 'cancelled', 'refunded');
create type order_line_status       as enum ('ordered', 'cancelled', 'refunded', 'partially_refunded');
create type actor_type              as enum ('customer', 'kitchen', 'admin', 'system', 'payment_provider');
create type reason_category         as enum ('cancellation', 'refund', 'ledger', 'adjustment');
create type payment_provider        as enum ('razorpay');
create type payment_method          as enum ('upi', 'card', 'netbanking', 'wallet', 'emi', 'unknown');
create type payment_status          as enum ('created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded');
create type webhook_processing_status as enum ('pending', 'processed', 'ignored', 'failed');
create type refund_destination      as enum ('wallet', 'source');
create type refund_status           as enum ('pending', 'processing', 'completed', 'failed');
create type mdr_bearer              as enum ('school', 'platform', 'kitchen');
create type ledger_direction        as enum ('debit', 'credit');
create type ledger_owner_type       as enum ('platform', 'user', 'school', 'kitchen', 'provider');
create type ledger_account_type     as enum ('wallet', 'revenue', 'receivable', 'payable', 'tax_payable', 'provider_clearing', 'provider_fees', 'suspense');
create type ledger_source_type      as enum ('payment', 'refund', 'payout', 'adjustment', 'migration', 'subscription');
create type invoice_document_type   as enum ('tax_invoice', 'credit_note');
create type invoice_status          as enum ('issued', 'cancelled');
create type payout_payee_type       as enum ('school', 'kitchen');
create type payout_status           as enum ('draft', 'confirmed', 'paid', 'cancelled');
create type scope_type              as enum ('platform', 'city', 'kitchen', 'school');
create type policy_audience         as enum ('app', 'web', 'both');
create type acceptance_source       as enum ('app', 'web', 'migration');
create type consent_subject_type    as enum ('user', 'recipient');
create type consent_subject_scope   as enum ('self', 'dependent', 'both');
create type consent_action          as enum ('granted', 'withdrawn', 'expired', 'superseded');
create type consent_capture_method  as enum ('in_app_checkbox', 'web_checkbox', 'written', 'admin_recorded', 'migration_backfill');
create type dsr_type                as enum ('access', 'correction', 'erasure', 'consent_withdrawal', 'grievance');
create type dsr_channel             as enum ('app', 'email', 'web_form');
create type dsr_status              as enum ('received', 'in_progress', 'completed', 'rejected');
create type asset_kind              as enum ('dish_image', 'category_image', 'invoice_pdf', 'report_pdf', 'import_file');
create type report_status           as enum ('draft', 'sent');
create type event_source            as enum ('app', 'web', 'edge_function', 'job');
create type migration_source        as enum ('native', 'bubble_migrated');
create type migration_issue         as enum ('duplicate_phone', 'unparseable_phone', 'missing_phone', 'ambiguous_parent_link', 'conflicting_parent_link', 'missing_school', 'orphan_order', 'junk_record', 'unresolvable_break_time', 'missing_image');
create type review_status           as enum ('open', 'resolved', 'left_behind');

-- -----------------------------------------------------------------------------
-- 2. Shared trigger functions
-- -----------------------------------------------------------------------------

-- §1.5 — one shared updated_at maintainer, attached at the end of this file.
create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Append-only enforcement for the tables where history is the point: order_event,
-- ledger_transaction, ledger_entry, consent_record, user_policy_acceptance,
-- audit_log (§7.5, §8.4, §11.5, §12.6). Corrections are new rows — a reversing
-- ledger transaction, a withdrawal consent event — never edits.
--
-- UPDATE/DELETE are also revoked from the application roles at the end of this
-- file. Both are here on purpose: the grant is the access control, the trigger is
-- the guarantee, and the trigger still fires for a role that is later granted
-- something by accident.
create function forbid_update_delete() returns trigger
language plpgsql as $$
begin
  raise exception
    '% is append-only; % is not permitted. Write a compensating row instead.',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Reference and geography (§3), identity (§4), organisations (§5)
--
-- Foreign-key delete behaviour throughout this file:
--   * References to an entity (app_user, recipient, school, kitchen, city, dish)
--     are ON DELETE RESTRICT. §13.4 forbids hard-deleting anything an invoice or
--     ledger entry depends on; cascading deletes would destroy the books.
--   * Rows wholly owned by a parent (order_line, dish_allergen, invoice_line …)
--     are ON DELETE CASCADE, because they have no meaning without the parent.
--   * order_line's menu_item_id and dish_id are ON DELETE SET NULL, explicitly,
--     so order history survives a menu being deleted (§7.4).
-- -----------------------------------------------------------------------------

-- §3.1 — a table rather than an enum because D9 expects multi-city expansion and
-- because the GST state code for place of supply (E07-02) has to live somewhere.
create table city (
  id            uuid primary key default gen_random_uuid(),
  code          text        not null unique,      -- slug, e.g. sas_nagar
  name          text        not null,             -- "SAS Nagar (Mohali)"
  state_name    text        not null,
  gst_state_code char(2)    not null,             -- statutory 2-digit code:
                                                  -- Chandigarh 04, Punjab 03, Haryana 06
  country_code  char(2)     not null default 'IN',
  timezone      text        not null default 'Asia/Kolkata',  -- IANA name
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table city is
  'Replaces the legacy Cities option set. gst_state_code drives place of supply on the invoice (E07-02).';

-- §4.1 — one flat table, one ordering role (D1). Parent / CollegeStudent /
-- SchoolStaff are deleted. The row id IS the Supabase auth.users id, so every
-- customer RLS predicate is a direct auth.uid() comparison with no join.
create table app_user (
  id                uuid primary key references auth.users(id) on delete restrict,
  phone_e164        text        not null,
  phone_verified_at timestamptz,
  email             citext,
  email_verified_at timestamptz,
  first_name        text,
  last_name         text,
  is_disabled       boolean     not null default false,
  disabled_reason   text,
  locale            text        not null default 'en-IN',
  last_seen_at      timestamptz,
  migration_source  migration_source not null default 'native',
  claimed_at        timestamptz,                  -- when a migrated account was
                                                  -- first claimed by OTP (E03-11)
  deleted_at        timestamptz,                  -- soft delete (§13.4)
  anonymised_at     timestamptz,                  -- PII scrubbed, row retained for
                                                  -- invoice / ledger integrity
  legacy_bubble_id  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- E02-17. The legacy `mobile` was a *number* field, so leading zeros and +91
  -- are already lost in the stored data. Text plus a format check plus uniqueness
  -- is the fix, and the check is what stops the migration writing junk.
  constraint app_user_phone_e164_format check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);
create unique index uq_app_user_phone         on app_user (phone_e164);
create unique index uq_app_user_email         on app_user (email)            where email is not null;
create unique index uq_app_user_legacy_bubble on app_user (legacy_bubble_id) where legacy_bubble_id is not null;

comment on table app_user is
  'One flat user table (D1). Deliberately absent: Stripe_id and current_client_secret — Stripe is gone (A6) and a client secret must never be stored on a user row. There is no role column; back office capability is a permission_grant (D3).';
comment on column app_user.first_name  is 'Personal data tier A (§13.3) — identifies the customer.';
comment on column app_user.last_name   is 'Personal data tier A (§13.3) — identifies the customer.';
comment on column app_user.phone_e164  is 'Personal data tier A (§13.3). E.164 with a leading +, per E02-17.';
comment on column app_user.email       is 'Personal data tier A (§13.3). Optional (E03-07); used for invoices and receipts.';

-- §12.2 — every image and PDF. Legacy Bubble CDN URLs die at migration (E16-05),
-- so everything is re-hosted here.
create table asset (
  id                  uuid primary key default gen_random_uuid(),
  kind                asset_kind  not null,
  bucket              text        not null,
  path                text        not null,
  mime_type           text,
  byte_size           bigint,
  width               integer,
  height              integer,
  checksum_sha256     text,                       -- deduplicates re-uploads of the
                                                  -- same dish image
  variants            jsonb,                      -- E04-07: three sizes x AVIF/WebP,
                                                  -- shaped {size: {format: path}}
  uploaded_by_user_id uuid references app_user(id) on delete restrict,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint asset_bucket_path_unique unique (bucket, path)
);
comment on table asset is
  'Invoice and report PDFs live in a private bucket; dish and category images in a public, long-cached one (§12.2).';

-- §3.2 — replaces the legacy Categories option set. The legacy value "All" is
-- deliberately not migrated: it is a UI affordance, not a category.
create table dish_category (
  id             uuid primary key default gen_random_uuid(),
  code           text        not null unique,     -- e.g. quick_bites
  display_name   text        not null,
  sort_order     smallint    not null default 0,  -- drives tab order in the app
  image_asset_id uuid references asset(id) on delete restrict,
  is_active      boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- §3.3 — D7. Structured tags from day one, because the source Excel already has
-- an Allergens column. This is what makes the add-to-cart warning (E05-05) free.
--
-- [DM-13] OPEN — the seed list is NOT written here. The authoritative input is the
-- distinct values actually present in the Allergens column of the source workbook,
-- which Q08 produces. An allergen that exists in the data but not in this table
-- becomes an unwarned allergy, so the rows are added once Q08 has run and Andy has
-- confirmed the mapping.
create table allergen (
  id           uuid primary key default gen_random_uuid(),
  code         text        not null unique,
  display_name text        not null,
  description  text,                              -- shown in the warning sheet
  is_major     boolean     not null default false,-- statutory major-allergen set
  sort_order   smallint    not null default 0,
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- §3.4 — one lookup for every "why did this happen" code, so cancellations,
-- refunds and ledger postings share a vocabulary and reports can group by it.
-- Natural text primary key (§1.2): the code IS the meaning, and it reads correctly
-- in a query and in a log line.
create table reason_code (
  code                text primary key,
  category            reason_category not null,
  display_name        text        not null,
  requires_note       boolean     not null default false,  -- forces free text in admin
  is_customer_visible boolean     not null default false,
  is_active           boolean     not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- §5.1
create table kitchen (
  id               uuid primary key default gen_random_uuid(),
  code             text        not null unique,   -- used in report filenames and log lines
  name             text        not null,
  city_id          uuid        not null references city(id) on delete restrict,
  address_line1    text,
  address_line2    text,
  postcode         text,
  contact_name     text,
  contact_email    citext,
  contact_phone    text,
  is_active        boolean     not null default true,
  legacy_bubble_id text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index ix_kitchen_city on kitchen (city_id, is_active);
comment on table kitchen is
  'Legacy Kitchen.owner-email — a string standing in for a person — is deleted; kitchen staff are real app_user rows with a kitchen-scoped permission_grant (E16-17). Legacy default_menu is also deleted: menu reach is decided entirely by menu_assignment (D4).';

-- §5.2
create table school (
  id               uuid primary key default gen_random_uuid(),
  code             text        not null unique,
  name             text        not null,
  city_id          uuid        not null references city(id)    on delete restrict,
  -- [DM-16] OPEN — can one school be served by more than one kitchen? Modelled as
  -- a plain NOT NULL foreign key, which is correct today. If a school is ever split
  -- across kitchens this becomes a school_kitchen join with validity dates, and
  -- that is a contained migration because nothing else keys off it.
  kitchen_id       uuid        not null references kitchen(id) on delete restrict,
  institution_type institution_type not null default 'school', -- replaces legacy isCollege
  address_line1    text,
  address_line2    text,
  postcode         text,
  contact_name     text,
  contact_email    citext,                        -- where the monthly PDF goes (E11-05)
  contact_phone    text,
  is_active        boolean     not null default true,
  onboarded_at     timestamptz,                   -- only onboarded schools appear in
                                                  -- the app's school picker (P1)
  offboarded_at    timestamptz,
  legacy_bubble_id text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index ix_school_city    on school (city_id, is_active);
create index ix_school_kitchen on school (kitchen_id);
comment on table school is
  'Legacy School.menu is deleted — it was the third competing path to a menu. D4 / menu_assignment is the single answer.';

-- §5.3 — admin-maintained list of the classes and sections that exist at a school.
-- NOT a roster: P1 stands, schools refused to maintain who is in each class. They
-- are only being asked what the classes are, which is ~30 rows per school.
-- See [DM-08].
create table school_class (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid        not null references school(id) on delete restrict,
  class_label   text        not null,             -- "5", "Grade 5", "V" — the
                                                  -- school's own words
  section_label text,                             -- "A". Null = class has no sections
  sort_order    smallint    not null default 0,   -- so the packing list prints in
                                                  -- school order, not alphabetical
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- coalesce(), not a plain unique, because NULL is not equal to NULL in a unique
-- constraint and two sectionless "Grade 5" rows would otherwise both be allowed.
create unique index uq_school_class on school_class (school_id, class_label, coalesce(section_label, ''));

-- §5.4 — the legacy Break-Timings stored break_start and break_end as TEXT, and
-- the option set's db values contradict their labels (10__00_am renders as
-- "10:40AM - 11:15AM"). Both defects are fixed here (E02-14).
create table break_time (
  id                   uuid primary key default gen_random_uuid(),
  school_id            uuid        not null references school(id) on delete restrict,
  code                 text        not null,      -- e.g. break_1
  label                text        not null,      -- "Morning break" — what the customer sees
  starts_at            time        not null,      -- a real time type, at last
  ends_at              time        not null,
  sort_order           smallint    not null default 0,
  is_active            boolean     not null default true,
  legacy_option_value  text,                      -- e.g. 10__00_am
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint break_time_ends_after_start check (ends_at > starts_at),
  constraint break_time_school_code_unique unique (school_id, code)
);
create index ix_break_time_school on break_time (school_id, is_active, sort_order);
comment on column break_time.legacy_option_value is
  'Never trust this value. The legacy option-set db values contradict their labels; migration goes through the hand-verified migration.break_time_legacy_map (E16-15).';

-- §5.5 — designed, unused in v1. E05-06 needs break selection to support different
-- times for different class groups later, and an empty table now is cheaper than a
-- new table after orders exist.
--
-- SEMANTICS: an empty set means the break applies to every class. v1 never writes
-- here; the resolver reads "no rows for this break => applies to all", so switching
-- it on later is data, not code.
create table break_time_class (
  break_time_id   uuid not null references break_time(id)   on delete cascade,
  school_class_id uuid not null references school_class(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (break_time_id, school_class_id)
);

-- §4.2 — the person who eats the food: either the ordering adult themself
-- (is_self) or a dependent. This single table is what removes all the legacy role
-- branching (D2).
create table recipient (
  id                 uuid primary key default gen_random_uuid(),
  is_self            boolean     not null default false,
  first_name         text        not null,
  last_name          text,
  school_id          uuid        not null references school(id)       on delete restrict,
  school_class_id    uuid references school_class(id)                 on delete restrict,
  class_label        text,                        -- free-text fallback, see [DM-08]
  section_label      text,
  -- [DM-12] OPEN — how a minor is identified for DPDP. Modelled as a declared
  -- boolean with NO date of birth, which is the minimising option: storing a
  -- child's date of birth collects more data about a child, not less. Blocked on
  -- the E20-01 legal review; if age must be verified rather than declared, this
  -- column changes and so does the dependent-creation flow.
  is_minor           boolean     not null default true,
  allergy_note       text,
  created_by_user_id uuid references app_user(id) on delete restrict,
  is_active          boolean     not null default true,
  deleted_at         timestamptz,
  anonymised_at      timestamptz,
  legacy_bubble_id   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index ix_recipient_school       on recipient (school_id, is_active);
create index ix_recipient_school_class on recipient (school_class_id);

comment on table recipient is
  'School lives here, not on app_user (D2). That is what makes a teacher ordering for themselves, a university student, and a parent with children at two schools the same code path with no role logic.';
comment on column recipient.created_by_user_id is
  'AUDIT ONLY. D10: this column must NEVER appear in an RLS policy. The single worst structural defect in the legacy model was two parallel parent-to-child links, so there were two answers to "may this user see this child" and they could disagree. guardian_link is the only path.';
comment on column recipient.first_name      is 'Personal data tier P (§13.3) — identifies a minor.';
comment on column recipient.last_name       is 'Personal data tier P (§13.3) — identifies a minor.';
comment on column recipient.school_id       is 'Personal data tier P (§13.3) — identifies a minor.';
comment on column recipient.school_class_id is 'Personal data tier P (§13.3) — identifies a minor.';
comment on column recipient.class_label     is 'Personal data tier P (§13.3) — identifies a minor.';
comment on column recipient.section_label   is 'Personal data tier P (§13.3) — identifies a minor.';
comment on column recipient.allergy_note    is 'Personal data tier S (§13.3) — SPECIAL CATEGORY: health data about a minor. Never logged, never sent to Sentry or analytics, never in a school report.';

-- §4.3 — the ONLY path from a user to a recipient. Replaces both legacy mechanisms
-- (Child.Parent list and Guardian_Link). D10.
create table guardian_link (
  id                 uuid primary key default gen_random_uuid(),
  recipient_id       uuid        not null references recipient(id) on delete cascade,
  user_id            uuid        not null references app_user(id)  on delete restrict,
  relationship       guardian_relationship not null,  -- a real enum, not the legacy free text
  can_order          boolean     not null default true,
  can_manage         boolean     not null default true,  -- edit details and allergies
  is_primary         boolean     not null default false, -- contact for notifications
                                                         -- and the invoice
  created_by_user_id uuid references app_user(id) on delete restrict,
  revoked_at         timestamptz,                        -- links are revoked, never
                                                         -- deleted: the audit trail matters
  revoked_by_user_id uuid references app_user(id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index uq_guardian_link_active
  on guardian_link (recipient_id, user_id) where revoked_at is null;
create unique index uq_guardian_link_one_primary
  on guardian_link (recipient_id)          where is_primary and revoked_at is null;
-- The hot RLS lookup: "which recipients may this user reach".
create index ix_guardian_link_user
  on guardian_link (user_id)               where revoked_at is null;

comment on table guardian_link is
  'The only authorization path from a user to a recipient (D10). The legacy Guardian_Relationship option set had Father->parent, Mother->mother, Parent->parent0 — two display values collapsing to overlapping db values. E16-03 maps on db value with a hand-written table and REPORTS conflicts rather than guessing.';

-- §4.4 — health data about a minor. The most sensitive table in the system.
create table recipient_allergen (
  recipient_id        uuid not null references recipient(id) on delete cascade,
  allergen_id         uuid not null references allergen(id)  on delete restrict,
  severity            allergy_severity,           -- nullable: v1 only warns, but the
                                                  -- kitchen will want the distinction
  note                text,
  recorded_by_user_id uuid references app_user(id) on delete restrict,
  recorded_at         timestamptz not null default now(),
  primary key (recipient_id, allergen_id)
);
comment on table recipient_allergen is
  'Personal data tier S (§13.3) — SPECIAL CATEGORY: health data about a minor. Everything in §13.3 applies with no exceptions. Deleted outright on erasure (§13.4): there is no statutory reason to retain a child''s health data.';
comment on column recipient_allergen.note is 'Personal data tier S (§13.3) — health data about a minor.';

-- -----------------------------------------------------------------------------
-- 4. Menu (§6)
-- -----------------------------------------------------------------------------

-- §6.1 — price is deliberately NOT on dish. The legacy model already moved it to
-- Menu_Item, which was correct, and it stays there.
create table dish (
  id               uuid primary key default gen_random_uuid(),
  -- [DM-06] OPEN — kitchen-owned, or a platform catalogue kitchens inherit?
  -- Modelled as kitchen-owned: calories, portion and ingredients are properties of
  -- *that kitchen's* version of the dish, so two kitchens making a "Veg Sandwich"
  -- get two rows, which is honest. Revisit if a new city's kitchen is meant to
  -- inherit a standard GrayBag menu.
  kitchen_id       uuid        not null references kitchen(id)       on delete restrict,
  name             text        not null,
  description      text,
  ingredients_text text,                          -- free text from the Excel
  calories_kcal    integer,                       -- legacy stored this as TEXT. Parsed
                                                  -- on import and left NULL when
                                                  -- unparseable, never guessed
  portion_text     text,                          -- from Portion/Weight
  nutrition        jsonb,                         -- unstructured extras; nothing queries it
  category_id      uuid        not null references dish_category(id) on delete restrict,
  -- [DM-17] OPEN — veg / non-veg / egg is not a column in the source Excel, so the
  -- importer cannot fill it. In the Indian market this is close to a required field
  -- and getting it wrong is a serious trust failure. Nullable for now; admin fills
  -- it for the existing dishes before launch, then it becomes required for new ones.
  food_type        food_type,
  image_asset_id   uuid references asset(id) on delete restrict,
  is_active        boolean     not null default true,
  legacy_bubble_id text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- A soft guard so a re-run of the Excel importer updates rather than duplicating.
create unique index uq_dish_kitchen_name on dish (kitchen_id, lower(name));
create index ix_dish_kitchen  on dish (kitchen_id, is_active);
create index ix_dish_category on dish (category_id);

-- §6.2
create table dish_allergen (
  dish_id     uuid not null references dish(id)     on delete cascade,
  allergen_id uuid not null references allergen(id) on delete restrict,
  presence    allergen_presence not null default 'contains',
  created_at  timestamptz not null default now(),
  primary key (dish_id, allergen_id)
);
-- "Which dishes contain peanuts" — the reverse of the primary key.
create index ix_dish_allergen_allergen on dish_allergen (allergen_id);
comment on column dish_allergen.presence is
  'The Excel only supports `contains`; `may_contain` exists because a kitchen will eventually need it.';

-- §6.3
create table menu (
  id                 uuid primary key default gen_random_uuid(),
  kitchen_id         uuid        not null references kitchen(id) on delete restrict,
  name               text        not null,
  status             menu_status not null default 'draft',
  version            integer     not null default 1,  -- bumped on ANY change to the
                                                      -- menu or its items (E04-08)
  notes              text,
  published_at       timestamptz,
  retired_at         timestamptz,
  created_by_user_id uuid references app_user(id) on delete restrict,
  legacy_bubble_id   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index ix_menu_kitchen_status on menu (kitchen_id, status);
comment on table menu is
  'Deliberately absent: the legacy active_from / active_to / is_default_for_kitchen. Validity and reach belong to menu_assignment (D4); keeping them would restore exactly the three-competing-paths ambiguity D4 exists to remove.';

-- §6.4
create table menu_item (
  id             uuid primary key default gen_random_uuid(),
  menu_id        uuid        not null references menu(id) on delete cascade,
  dish_id        uuid        not null references dish(id) on delete restrict,
  price_paise    bigint      not null,
  category_id    uuid references dish_category(id) on delete restrict,  -- override;
                                                  -- falls back to dish.category_id
  -- ISO weekday numbers, 1 = Monday. The legacy option set for this was named
  -- `unavailable_days` but used as *available* days; this column is named for what
  -- it means (E02-14).
  available_days smallint[]  not null default '{1,2,3,4,5,6}'::smallint[],
  is_active      boolean     not null default true,
  sort_order     smallint    not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint menu_item_price_non_negative check (price_paise >= 0),
  constraint menu_item_available_days_valid
    check (available_days <@ array[1,2,3,4,5,6,7]::smallint[]),
  constraint menu_item_menu_dish_unique unique (menu_id, dish_id)
);
create index ix_menu_item_menu on menu_item (menu_id, is_active);
comment on column menu_item.price_paise is
  'Integer paise (§1.3). What this figure means with respect to GST is [DM-14] — whether the source Price is tax-inclusive or exclusive is unanswered, and platform_config.price_is_tax_inclusive is deliberately NULL until it is.';

-- §6.5 — D4. The single answer to "which menu does this school see today".
create table menu_assignment (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references school(id) on delete restrict,
  menu_id            uuid not null references menu(id)   on delete restrict,
  valid_from         date not null,                -- inclusive
  valid_to           date,                         -- EXCLUSIVE. Null = open-ended
  created_by_user_id uuid references app_user(id)  on delete restrict,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint menu_assignment_valid_range check (valid_to is null or valid_to > valid_from),
  -- THIS is the constraint that makes the legacy ambiguity structurally impossible.
  -- The database, not the application, guarantees a school never has two live menus
  -- on the same day. Requires btree_gist for the `school_id WITH =` term.
  constraint menu_assignment_no_overlap exclude using gist (
    school_id with =,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[)') with &&
  ) where (revoked_at is null)
);
create index ix_menu_assignment_menu on menu_assignment (menu_id);

-- §6.6 — E04-05 allows a per-school price override in the importer, and D5 puts
-- prices in the config chain. This is the concrete table the chain reads.
--
-- Resolution order for the price of a dish at a school on a date:
--   menu_item_price_override -> menu_item.price_paise
-- Whichever wins is SNAPSHOTTED onto the order line at write time, so a later
-- price change never rewrites history.
create table menu_item_price_override (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid   not null references school(id)    on delete restrict,
  menu_item_id       uuid   not null references menu_item(id) on delete cascade,
  price_paise        bigint not null,
  valid_from         date   not null,
  valid_to           date,                         -- exclusive, null = open-ended
  created_by_user_id uuid references app_user(id)  on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint menu_item_price_override_non_negative check (price_paise >= 0),
  constraint menu_item_price_override_valid_range  check (valid_to is null or valid_to > valid_from),
  constraint menu_item_price_override_no_overlap exclude using gist (
    school_id    with =,
    menu_item_id with =,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[)') with &&
  )
);

-- §6.7 — designed, unused in v1 (E02-12, P3). Per-dish limits are not in v1, but
-- the table is designed now so it drops in without a rewrite.
--
-- The decrement is a single atomic statement, never a COUNT(*):
--   UPDATE menu_item_capacity SET remaining = remaining - $qty, updated_at = now()
--    WHERE menu_item_id = $1 AND service_date = $2 AND remaining >= $qty
--   RETURNING remaining;
-- Zero rows returned means sold out. A row ABSENT means unlimited, so switching
-- capacity on is an insert.
create table menu_item_capacity (
  menu_item_id   uuid    not null references menu_item(id) on delete cascade,
  service_date   date    not null,
  capacity_total integer not null,
  remaining      integer not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (menu_item_id, service_date),
  constraint menu_item_capacity_total_non_negative check (capacity_total >= 0),
  constraint menu_item_capacity_remaining_in_range check (remaining >= 0 and remaining <= capacity_total)
);

-- §6.8 — E04-09 needs GET /menu/version?school=X to return a few bytes with no
-- menu computation, and E04-10 caches on the result. One row per school.
--
-- This is NOT menu.version. Two schools sharing one menu but with different price
-- overrides must invalidate independently, and a school whose assignment simply
-- flipped to a different menu has to invalidate even though neither menu changed.
-- The endpoint is called by every user on every app open, so it is also the first
-- thing to CDN-cache (E15-10) — a short TTL is safe because the value is monotonic.
create table school_menu_version (
  school_id  uuid primary key references school(id) on delete cascade,
  menu_id    uuid references menu(id) on delete set null,  -- currently effective
                                                           -- menu, advisory only
  version    bigint      not null default 1,               -- monotonic
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 5. Configuration resolution chain (§9)
--
-- D5 and E02-06: platform -> kitchen -> school, resolved at write time and
-- snapshotted onto the order, so there is no read-time cost and order history
-- stays correct when a setting changes.
--
-- [DM-07] OPEN — typed columns (modelled here) or a generic key/value table.
-- Typed columns give real types and real constraints, and the admin UI that shows
-- "Cutoff: 12:00 AM (platform default)" with an override toggle (E10-06) reads
-- straight off the three rows. The cost is a migration for every new setting; the
-- setting list is short and stable. A key/value table needs no migration but every
-- read needs a cast, no constraint can be expressed, and a typo in a key is a
-- silent default.
--
-- The three tables carry the SAME column set. platform_config has every setting
-- NOT NULL (it is the floor); kitchen_config and school_config have every setting
-- nullable, where NULL MEANS INHERIT. Resolution is one COALESCE per column.
--
-- Scope exceptions from §9.1:
--   * timezone           — platform and kitchen only. A school does not get its own.
--   * tax rates, SAC, price_is_tax_inclusive — PLATFORM ONLY. Tax rates are
--     statutory; a school must not be able to override them.
-- -----------------------------------------------------------------------------

-- Singleton (§9.2). A row rather than a key/value blob so "what is the default" is
-- answerable with SELECT *.
create table platform_config (
  id                                    smallint primary key default 1,
  timezone                              text        not null default 'Asia/Kolkata',
  order_cutoff_time                     time        not null default '00:00',  -- D5: midnight
  -- cutoff_at = (service_date - days_before) at cutoff_time, in the resolved
  -- timezone. 0 days + 00:00 = midnight at the start of the service day.
  order_cutoff_days_before              smallint    not null default 0,
  max_advance_order_days                smallint    not null default 14,       -- E05-08 horizon
  min_advance_order_days                smallint    not null default 0,
  default_delivery_mode                 delivery_mode not null default 'classroom', -- P5, parked
  allow_classroom_delivery              boolean     not null default true,
  allow_counter_pickup                  boolean     not null default true,
  pickup_code_enabled                   boolean     not null default true,
  revenue_share_bps                     integer     not null default 1000,     -- M4: 10%
  -- [DM-14] OPEN, and DELIBERATELY NULLABLE — the one setting on this table that
  -- is not NOT NULL. Whether the source Excel `Price` is GST-inclusive or exclusive
  -- is unanswered (it blocks E04-04 and E07-06). A default here would be a guess
  -- about money that silently propagates into every invoice, so the column is left
  -- NULL and the tax calculation must refuse to run until Andy answers. See the
  -- note in docs/open-questions.md.
  price_is_tax_inclusive                boolean,
  cgst_rate_bps                         integer     not null default 250,      -- M2: 2.5%
  sgst_rate_bps                         integer     not null default 250,      -- M2: 2.5%
  igst_rate_bps                         integer     not null default 0,        -- intra-state
  sac_code                              text        not null default '996331', -- unconfirmed, E00-10
  refund_default_destination            refund_destination not null default 'wallet', -- M7
  wallet_at_checkout_enabled            boolean     not null default true,     -- E06-10 kill switch
  allergen_warning_enabled              boolean     not null default true,     -- E05-05
  customer_cancellation_allowed         boolean     not null default true,     -- E05-11
  customer_cancellation_cutoff_minutes  integer     not null default 0,        -- minutes before
                                                                               -- cutoff_at; 0 = up to it
  updated_at                            timestamptz not null default now(),
  updated_by_user_id                    uuid references app_user(id) on delete restrict,
  constraint platform_config_singleton        check (id = 1),
  constraint platform_config_revenue_share_bps check (revenue_share_bps between 0 and 10000),
  constraint platform_config_cgst_bps          check (cgst_rate_bps    between 0 and 10000),
  constraint platform_config_sgst_bps          check (sgst_rate_bps    between 0 and 10000),
  constraint platform_config_igst_bps          check (igst_rate_bps    between 0 and 10000),
  constraint platform_config_cancel_minutes    check (customer_cancellation_cutoff_minutes >= 0),
  constraint platform_config_advance_days      check (max_advance_order_days >= min_advance_order_days)
);

create table kitchen_config (
  kitchen_id                            uuid primary key references kitchen(id) on delete cascade,
  timezone                              text,
  order_cutoff_time                     time,
  order_cutoff_days_before              smallint,
  max_advance_order_days                smallint,
  min_advance_order_days                smallint,
  default_delivery_mode                 delivery_mode,
  allow_classroom_delivery              boolean,
  allow_counter_pickup                  boolean,
  pickup_code_enabled                   boolean,
  revenue_share_bps                     integer,
  refund_default_destination            refund_destination,
  wallet_at_checkout_enabled            boolean,
  allergen_warning_enabled              boolean,
  customer_cancellation_allowed         boolean,
  customer_cancellation_cutoff_minutes  integer,
  updated_at                            timestamptz not null default now(),
  updated_by_user_id                    uuid references app_user(id) on delete restrict,
  constraint kitchen_config_revenue_share_bps check (revenue_share_bps is null or revenue_share_bps between 0 and 10000),
  constraint kitchen_config_cancel_minutes    check (customer_cancellation_cutoff_minutes is null or customer_cancellation_cutoff_minutes >= 0)
);
comment on table kitchen_config is 'NULL in any setting column means "inherit from platform_config" (§9.3).';

create table school_config (
  school_id                             uuid primary key references school(id) on delete cascade,
  order_cutoff_time                     time,
  order_cutoff_days_before              smallint,
  max_advance_order_days                smallint,
  min_advance_order_days                smallint,
  default_delivery_mode                 delivery_mode,
  allow_classroom_delivery              boolean,
  allow_counter_pickup                  boolean,
  pickup_code_enabled                   boolean,
  revenue_share_bps                     integer,
  refund_default_destination            refund_destination,
  wallet_at_checkout_enabled            boolean,
  allergen_warning_enabled              boolean,
  customer_cancellation_allowed         boolean,
  customer_cancellation_cutoff_minutes  integer,
  updated_at                            timestamptz not null default now(),
  updated_by_user_id                    uuid references app_user(id) on delete restrict,
  constraint school_config_revenue_share_bps check (revenue_share_bps is null or revenue_share_bps between 0 and 10000),
  constraint school_config_cancel_minutes    check (customer_cancellation_cutoff_minutes is null or customer_cancellation_cutoff_minutes >= 0)
);
comment on table school_config is
  'NULL means inherit (§9.3). There is deliberately no timezone or tax-rate column here: tax rates are statutory and revenue_share_bps is admin-only (M4), which is why school.config_edit is never granted at school scope (§10.1).';

-- §9.4 — feeds E10-11 (who changed a price, who issued a refund) and is the
-- evidence trail when a school queries a payout. Written by trigger on all three
-- config tables so it cannot be bypassed by a direct update.
create table config_change_log (
  id                 bigint generated always as identity primary key,
  scope_type         scope_type  not null,
  scope_id           uuid,                          -- null for platform
  setting_key        text        not null,
  old_value          jsonb,
  new_value          jsonb,
  changed_by_user_id uuid references app_user(id) on delete restrict,
  changed_at         timestamptz not null default now(),
  reason             text
);
create index ix_config_change_log_scope on config_change_log (scope_type, scope_id, changed_at desc);

-- §9.3 — the resolver. STABLE so the planner can inline it and cache it within a
-- statement (E02-10). Returns one composite row; the caller writes it to
-- order.config_snapshot at order-create time.
create type effective_config as (
  timezone                              text,
  order_cutoff_time                     time,
  order_cutoff_days_before              smallint,
  max_advance_order_days                smallint,
  min_advance_order_days                smallint,
  default_delivery_mode                 delivery_mode,
  allow_classroom_delivery              boolean,
  allow_counter_pickup                  boolean,
  pickup_code_enabled                   boolean,
  revenue_share_bps                     integer,
  price_is_tax_inclusive                boolean,
  cgst_rate_bps                         integer,
  sgst_rate_bps                         integer,
  igst_rate_bps                         integer,
  sac_code                              text,
  refund_default_destination            refund_destination,
  wallet_at_checkout_enabled            boolean,
  allergen_warning_enabled              boolean,
  customer_cancellation_allowed         boolean,
  customer_cancellation_cutoff_minutes  integer
);

-- Note: NO `SET search_path` clause here, deliberately. A SET clause blocks SQL
-- function inlining, and inlining is the entire reason this is STABLE. It is not
-- SECURITY DEFINER, so it runs with the caller's privileges and search_path is not
-- part of its security boundary — unlike auth_has_permission(), where the pin is
-- mandatory.
create function resolve_effective_config(p_school_id uuid)
returns effective_config
language sql stable
as $$
  select row(
    coalesce(kc.timezone, pc.timezone),
    coalesce(sc.order_cutoff_time,                    kc.order_cutoff_time,                    pc.order_cutoff_time),
    coalesce(sc.order_cutoff_days_before,             kc.order_cutoff_days_before,             pc.order_cutoff_days_before),
    coalesce(sc.max_advance_order_days,               kc.max_advance_order_days,               pc.max_advance_order_days),
    coalesce(sc.min_advance_order_days,               kc.min_advance_order_days,               pc.min_advance_order_days),
    coalesce(sc.default_delivery_mode,                kc.default_delivery_mode,                pc.default_delivery_mode),
    coalesce(sc.allow_classroom_delivery,             kc.allow_classroom_delivery,             pc.allow_classroom_delivery),
    coalesce(sc.allow_counter_pickup,                 kc.allow_counter_pickup,                 pc.allow_counter_pickup),
    coalesce(sc.pickup_code_enabled,                  kc.pickup_code_enabled,                  pc.pickup_code_enabled),
    coalesce(sc.revenue_share_bps,                    kc.revenue_share_bps,                    pc.revenue_share_bps),
    pc.price_is_tax_inclusive,   -- platform only
    pc.cgst_rate_bps,            -- platform only, statutory
    pc.sgst_rate_bps,            -- platform only, statutory
    pc.igst_rate_bps,            -- platform only, statutory
    pc.sac_code,                 -- platform only
    coalesce(sc.refund_default_destination,           kc.refund_default_destination,           pc.refund_default_destination),
    coalesce(sc.wallet_at_checkout_enabled,           kc.wallet_at_checkout_enabled,           pc.wallet_at_checkout_enabled),
    coalesce(sc.allergen_warning_enabled,             kc.allergen_warning_enabled,             pc.allergen_warning_enabled),
    coalesce(sc.customer_cancellation_allowed,        kc.customer_cancellation_allowed,        pc.customer_cancellation_allowed),
    coalesce(sc.customer_cancellation_cutoff_minutes, kc.customer_cancellation_cutoff_minutes, pc.customer_cancellation_cutoff_minutes)
  )::effective_config
  from school s
  join platform_config pc on pc.id = 1
  left join kitchen_config kc on kc.kitchen_id = s.kitchen_id
  left join school_config  sc on sc.school_id  = s.id
  where s.id = p_school_id;
$$;
comment on function resolve_effective_config(uuid) is
  'D5 config chain: COALESCE(school, kitchen, platform) per column. E02-10 unit tests must cover nothing overridden, kitchen only, school only, both, and a school whose kitchen changed.';

-- -----------------------------------------------------------------------------
-- 6. Ordering (§7)
--
-- [DM-01] OPEN, AND IT IS THE ONE TO READ FIRST. This is the three-level shape:
--   order_group  = the checkout and payment unit
--   order        = one (recipient, service_date, break) — the fulfilment unit
--   order_line   = dishes
-- One payment and one invoice attach to the group; status, cutoff, delivery and
-- refunds attach to the order. That keeps order.status a clean state machine, makes
-- the kitchen packing list a single indexed query, and makes "one group, seven
-- orders" the natural shape for ordering a week ahead (E05-08) and for future
-- subscriptions (E18-07).
--
-- The alternative is two levels with recipient and service_date on the line, which
-- is what the legacy model did. If Andy confirms a checkout is always one child for
-- one day, order_group collapses into order and this table is waste. Everything
-- below assumes three levels. Needs Andy: can a parent pay once for two children
-- and/or two days?
-- -----------------------------------------------------------------------------

-- §7.2
create table order_group (
  id                    uuid primary key default gen_random_uuid(),
  customer_user_id      uuid        not null references app_user(id) on delete restrict,
  -- E02-13 / §13.6. Generated once here and COPIED, never regenerated, onto order,
  -- order_event, payment, payment_webhook_event, refund, ledger_transaction,
  -- notification_delivery, audit_log and every structured log line. Support path:
  -- customer quotes order_ref -> look up correlation_id -> one query per table
  -- returns the entire life of that order across the app, the Edge Functions,
  -- Razorpay and the ledger.
  correlation_id        uuid        not null default gen_random_uuid(),
  idempotency_key       text        not null,   -- supplied by the client (E05-12)
  status                order_group_status not null default 'draft',
  city_id               uuid        not null references city(id) on delete restrict, -- D9
  currency              char(3)     not null default 'INR',
  subtotal_paise        bigint      not null default 0,   -- sum over member orders
  tax_total_paise       bigint      not null default 0,   -- sum over member orders
  discount_paise        bigint      not null default 0,
  wallet_applied_paise  bigint      not null default 0,   -- E06-10
  payable_paise         bigint      not null default 0,   -- what Razorpay is asked for
  placed_at             timestamptz,
  paid_at               timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint order_group_subtotal_non_negative check (subtotal_paise       >= 0),
  constraint order_group_tax_non_negative      check (tax_total_paise      >= 0),
  constraint order_group_discount_non_negative check (discount_paise       >= 0),
  constraint order_group_wallet_non_negative   check (wallet_applied_paise >= 0),
  constraint order_group_payable_non_negative  check (payable_paise        >= 0),
  -- Row-local arithmetic, so a plain CHECK rather than a trigger. It fires
  -- immediately, which means the totals must be updated in ONE statement — that is
  -- the intended discipline, not an accident. The cross-row half of the invariant
  -- (these totals equal the sum over member orders) is a deferred constraint
  -- trigger further down, because the rows are written in one transaction.
  constraint order_group_payable_arithmetic check (
    payable_paise = subtotal_paise + tax_total_paise - discount_paise - wallet_applied_paise
  )
);
-- E05-12 in a single constraint: two devices submitting the same cart collide on
-- insert, and the second gets the first's result back. Idempotency is a database
-- constraint, not application logic that can be refactored away (D16).
create unique index uq_order_group_idempotency on order_group (customer_user_id, idempotency_key);
create index ix_order_group_customer on order_group (customer_user_id, placed_at desc);

-- §7.3 — one recipient, one service date, one break. The unit the kitchen makes
-- and delivers. `order` is a reserved word in ORDER BY context, so it is quoted
-- throughout; the domain term is worth the quoting and PostgREST handles it.
create table "order" (
  id                      uuid primary key default gen_random_uuid(),
  order_group_id          uuid        not null references order_group(id) on delete cascade,
  order_ref               text        not null,   -- short human code for support,
                                                  -- e.g. GB-8F3K2Q. Generated by the
                                                  -- application; no format is
                                                  -- specified in the model, so none
                                                  -- is invented here.
  correlation_id          uuid        not null,   -- copied from the group, never regenerated
  -- Denormalised from the group DELIBERATELY, so the customer RLS predicate on the
  -- hottest table in the system is a column compare with no join.
  customer_user_id        uuid        not null references app_user(id)  on delete restrict,
  recipient_id            uuid        not null references recipient(id) on delete restrict,
  school_id               uuid        not null references school(id)    on delete restrict,
  kitchen_id              uuid        not null references kitchen(id)   on delete restrict,
  city_id                 uuid        not null references city(id)      on delete restrict,
  service_date            date        not null,   -- the day the food is eaten
  break_time_id           uuid references break_time(id) on delete restrict,  -- null for
                                                                              -- counter pickup
  delivery_mode           delivery_mode not null,
  -- [DM-10] OPEN — a 4-digit code is 10,000 values and is therefore guessable.
  -- Modelled as unique per (school, service_date), valid only on the service date,
  -- with the handover screen showing the recipient name so staff match code AND
  -- name, and a rate-limited lookup requiring orders.mark_delivered. Do NOT extend
  -- the code length: P4 chose 4 digits because it is read aloud by children.
  pickup_code             char(4),
  status                  order_status not null default 'draft',
  subtotal_paise          bigint      not null default 0,
  tax_cgst_paise          bigint      not null default 0,  -- M2: split, never a
  tax_sgst_paise          bigint      not null default 0,  --     single "5% tax"
  tax_igst_paise          bigint      not null default 0,  -- always 0 while place of
                                                           -- supply is intra-state
  discount_paise          bigint      not null default 0,
  total_paise             bigint      not null default 0,
  refunded_total_paise    bigint      not null default 0,  -- running total
  -- SNAPSHOT of the resolved cutoff (D5). Enforcement compares against this, not a
  -- re-resolution: an admin changing the cutoff at 9pm cannot retroactively
  -- invalidate orders placed at 8pm.
  cutoff_at               timestamptz not null,
  -- The whole resolved config row at write time — revenue share bps, tax rates,
  -- cutoff, delivery rules. A report run next year still reads the rates that
  -- actually applied (D5).
  config_snapshot         jsonb       not null,
  school_name_snapshot    text        not null,
  break_label_snapshot    text,
  recipient_name_snapshot text        not null,
  class_label_snapshot    text,
  section_label_snapshot  text,
  placed_at               timestamptz,
  confirmed_at            timestamptz,            -- payment captured
  preparing_at            timestamptz,
  delivered_at            timestamptz,
  delivered_by_user_id    uuid references app_user(id) on delete restrict,
  cancelled_at            timestamptz,
  cancelled_by_user_id    uuid references app_user(id) on delete restrict,
  cancel_reason_code      text references reason_code(code) on delete restrict,
  legacy_bubble_id        text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint order_subtotal_non_negative  check (subtotal_paise       >= 0),
  constraint order_cgst_non_negative      check (tax_cgst_paise       >= 0),
  constraint order_sgst_non_negative      check (tax_sgst_paise       >= 0),
  constraint order_igst_non_negative      check (tax_igst_paise       >= 0),
  constraint order_discount_non_negative  check (discount_paise       >= 0),
  constraint order_total_non_negative     check (total_paise          >= 0),
  constraint order_refunded_non_negative  check (refunded_total_paise >= 0),
  constraint order_refunded_not_over      check (refunded_total_paise <= total_paise),
  constraint order_pickup_code_numeric    check (pickup_code is null or pickup_code ~ '^[0-9]{4}$')
);

create unique index uq_order_ref on "order" (order_ref);
-- E09-06 code lookup, and collision prevention within a school-day.
create unique index uq_order_pickup_code
  on "order" (school_id, service_date, pickup_code) where pickup_code is not null;

-- Indexes chosen against the actual query set (§7.3), not speculatively.
create index ix_order_kitchen_service  on "order" (kitchen_id, service_date, status);        -- E09-01, the 7am query
create index ix_order_school_service   on "order" (school_id, service_date, break_time_id);  -- E09-03 packing list
create index ix_order_customer_history on "order" (customer_user_id, placed_at desc);        -- E05-10
create index ix_order_recipient        on "order" (recipient_id, service_date);              -- per-child view
create index ix_order_city_service     on "order" (city_id, service_date);                   -- D9 city-scoped reporting
create index ix_order_group            on "order" (order_group_id);
create index ix_order_correlation      on "order" (correlation_id);                          -- support
-- Partial index over the open working set: small and hot, while the table is
-- mostly closed history.
create index ix_order_open_statuses
  on "order" (status) where status in ('pending_payment', 'paid', 'preparing');

comment on table "order" is
  'Deliberately absent: order_ymd / order_week / order_month / order_year (E02-14 — the legacy pre-computed date parts existed only because Bubble could not query dates); payment_id AND payment-id as two live text fields; actor_user / order-parent / staff_user as three parallel user pointers. There is one paying customer and one recipient, and who DID something is in order_event.';
comment on column "order".recipient_name_snapshot is
  'Personal data tier P (§13.3) — identifies a minor. Needed so the packing list is right even if the parent renames or removes the recipient. Purged by the retention policy (§13.4).';
comment on column "order".class_label_snapshot   is 'Personal data tier P (§13.3) — identifies a minor.';
comment on column "order".section_label_snapshot is 'Personal data tier P (§13.3) — identifies a minor.';
comment on column "order".break_label_snapshot   is
  'Legacy break labels drifted from their values, so a snapshot means an admin fixing the break record never rewrites a delivered order.';
comment on column "order".status is
  'The legal transitions (draft -> pending_payment -> paid -> preparing -> delivered, plus cancelled and refunded) are enforced by a trigger added with the state machine in docs/order-lifecycle.md (Q06, E06-05). This migration only guarantees the columns exist to record it.';

-- §7.4
create table order_line (
  id                        bigint generated always as identity primary key,
  order_id                  uuid    not null references "order"(id) on delete cascade,
  line_no                   smallint not null,     -- stable line numbering for the invoice
  -- ON DELETE SET NULL, explicitly: order history survives menu deletion.
  menu_item_id              uuid references menu_item(id) on delete set null,
  dish_id                   uuid references dish(id)      on delete set null,
  quantity                  integer not null,
  unit_price_paise          bigint  not null,      -- the resolved price: override or menu price
  line_subtotal_paise       bigint  not null,
  tax_cgst_paise            bigint  not null default 0,
  tax_sgst_paise            bigint  not null default 0,
  line_total_paise          bigint  not null,
  special_comments          text,                  -- legacy special-comments, kept
  status                    order_line_status not null default 'ordered',
  refunded_quantity         integer not null default 0,
  refunded_amount_paise     bigint  not null default 0,
  -- Snapshots (E02-04). The sharpest legacy defect after authorization: legacy
  -- Dish_In_Order snapshotted unit_price but NOT the dish name, so editing a dish
  -- rewrote the history of every order that ever contained it. An invoice that
  -- changes retroactively is not a valid tax document.
  dish_name_snapshot        text    not null,
  dish_description_snapshot text,
  category_code_snapshot    text,
  portion_snapshot          text,
  food_type_snapshot        food_type,
  -- Here for the same reason plus a stronger one: if a child had a reaction, the
  -- record must say what the dish was declared to contain ON THE DAY, not what it
  -- says today.
  allergen_codes_snapshot   text[]  not null default '{}',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint order_line_quantity_positive     check (quantity > 0),
  constraint order_line_unit_price_non_neg    check (unit_price_paise      >= 0),
  constraint order_line_subtotal_non_neg      check (line_subtotal_paise   >= 0),
  constraint order_line_cgst_non_neg          check (tax_cgst_paise        >= 0),
  constraint order_line_sgst_non_neg          check (tax_sgst_paise        >= 0),
  constraint order_line_total_non_neg         check (line_total_paise      >= 0),
  constraint order_line_refunded_qty_in_range check (refunded_quantity between 0 and quantity),
  constraint order_line_refunded_amt_in_range check (refunded_amount_paise between 0 and line_total_paise),
  constraint order_line_subtotal_arithmetic   check (line_subtotal_paise = unit_price_paise * quantity),
  constraint order_line_order_line_no_unique  unique (order_id, line_no)
);
create index ix_order_line_order on order_line (order_id);
create index ix_order_line_dish  on order_line (dish_id);
comment on table order_line is
  'Deliberate non-optimisation: the E09-01 aggregate production list joins order_line to "order" to filter by kitchen_id and service_date. At the volumes in §1.7 that join is free. If it ever is not, copy kitchen_id and service_date here by trigger — a justified, documented denormalisation, unlike the legacy date parts. Not built.';

-- §7.5 — append-only history of every status change. This is what makes "why is
-- this order in this state" answerable in support, and it replaces the legacy
-- model's total silence on the point.
create table order_event (
  id             bigint generated always as identity primary key,
  order_id       uuid        not null references "order"(id) on delete cascade,
  from_status    order_status,                    -- null on creation
  to_status      order_status not null,
  actor_type     actor_type   not null,
  actor_user_id  uuid references app_user(id) on delete restrict,  -- null for system
                                                                   -- and provider
  reason_code    text references reason_code(code) on delete restrict,
  note           text,
  correlation_id uuid        not null,
  metadata       jsonb,                           -- provider event ids etc.
  created_at     timestamptz not null default now()
);
create index ix_order_event_order       on order_event (order_id, created_at);
create index ix_order_event_correlation on order_event (correlation_id);
comment on column order_event.note     is 'Must not contain a recipient''s name (§13.3 rule 2).';
comment on column order_event.metadata is 'No PII (§13.3).';

-- -----------------------------------------------------------------------------
-- 7. Money (§8)
--
-- Everything here obeys §1.3 without exception: bigint integer paise, columns
-- ending _paise, integer basis points ending _bps. E02-05 is the highest-risk task
-- in the schema, because a modelling error here is discovered by a customer, not by
-- a test.
--
-- bigint rather than integer because int4 tops out at ~Rs 21.4 million, which a
-- cumulative ledger account or a multi-year payout total will exceed. The extra
-- four bytes are irrelevant.
-- -----------------------------------------------------------------------------

-- §8.1 — one row PER ATTEMPT, not per order. A customer who fails on UPI and
-- retries on card produces two rows, and both are needed for E06-06 and for
-- reconciliation.
create table payment (
  id                  uuid primary key default gen_random_uuid(),
  order_group_id      uuid        not null references order_group(id) on delete restrict,
  provider            payment_provider not null default 'razorpay',   -- only value in v1 (A6)
  provider_order_id   text        not null,
  provider_payment_id text,
  method              payment_method,
  amount_paise        bigint      not null,       -- what was asked for
  currency            char(3)     not null default 'INR',
  status              payment_status not null default 'created',
  attempt_no          smallint    not null default 1,
  failure_code        text,                       -- Razorpay's code, stored verbatim
  failure_description text,
  provider_fee_paise  bigint,                     -- MDR as reported by Razorpay —
                                                  -- the input to M5 / E07-11
  provider_tax_paise  bigint,                     -- GST on the MDR
  authorized_at       timestamptz,
  captured_at         timestamptz,
  failed_at           timestamptz,
  correlation_id      uuid        not null,
  notes               jsonb,                      -- provider metadata, REDACTED
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint payment_amount_non_negative      check (amount_paise       >= 0),
  constraint payment_provider_fee_non_negative check (provider_fee_paise is null or provider_fee_paise >= 0),
  constraint payment_provider_tax_non_negative check (provider_tax_paise is null or provider_tax_paise >= 0),
  constraint payment_attempt_no_positive      check (attempt_no > 0),
  constraint payment_provider_order_unique    unique (provider, provider_order_id)
);
create unique index uq_payment_provider_payment_id
  on payment (provider, provider_payment_id) where provider_payment_id is not null;
-- D16. The database refuses a second capture on one checkout. A genuine duplicate
-- payment therefore FAILS TO INSERT and is routed to refund, rather than silently
-- double-charging (E06-06).
create unique index uq_payment_one_capture_per_group
  on payment (order_group_id) where status = 'captured';
create index ix_payment_group  on payment (order_group_id, created_at);
create index ix_payment_status on payment (status, created_at);   -- reconciliation job

comment on table payment is
  'There is NO signature column, by design (D12). The legacy Temp table stored Razorpay signatures in an unbounded, world-readable table. Signatures are verified server-side on receipt (E06-03) and then discarded: nothing downstream needs them, and storing them creates a credential-shaped asset with no owner.';
comment on column payment.notes is
  'Must never contain card data, a VPA, or a signature. The redaction list is enforced in the webhook handler and asserted by a test (E06-03).';

-- §8.2 — E06-04. Razorpay retries; the same event must never be processed twice.
create table payment_webhook_event (
  id                 bigint generated always as identity primary key,
  provider           payment_provider not null,
  provider_event_id  text        not null,        -- Razorpay's x-razorpay-event-id
  event_type         text        not null,        -- payment.captured, refund.processed, …
  -- NOT NULL with no default, deliberately. The handler must state a verdict; there
  -- is no "we didn't check". An event with signature_verified = false is RECORDED
  -- and never acted on, and raises the E15-05 alert — a burst of signature failures
  -- is an attack signal, so recording it matters.
  signature_verified boolean     not null,
  payload            jsonb       not null,        -- redacted copy of the body
  received_at        timestamptz not null default now(),
  processing_status  webhook_processing_status not null default 'pending',
  processed_at       timestamptz,
  attempt_count      integer     not null default 0,
  error_text         text,
  related_payment_id uuid references payment(id) on delete restrict,
  correlation_id     uuid,
  -- THIS CONSTRAINT IS THE IDEMPOTENCY GUARANTEE (D16). The handler inserts first;
  -- a unique violation means "already seen, stop". Idempotency is a database
  -- constraint, not application logic that can be refactored away.
  constraint payment_webhook_event_unique unique (provider, provider_event_id)
);
create index ix_payment_webhook_event_retry
  on payment_webhook_event (processing_status, received_at)
  where processing_status in ('pending', 'failed');

-- §8.3 — E06-08 (full and per-line), E06-09 (wallet by default), E07-11 / M5.
create table refund (
  id                    uuid primary key default gen_random_uuid(),
  order_group_id        uuid   not null references order_group(id) on delete restrict,
  order_id              uuid references "order"(id)  on delete restrict,  -- null when the
                                                                          -- refund spans the group
  payment_id            uuid references payment(id)  on delete restrict,  -- null for a
                                                                          -- wallet-only refund
  destination           refund_destination not null,  -- default resolved from config (M7)
  amount_paise          bigint not null,
  reason_code           text   not null references reason_code(code) on delete restrict,
  initiated_by_user_id  uuid references app_user(id) on delete restrict,  -- null when system
  status                refund_status not null default 'pending',
  provider_refund_id    text,
  mdr_paise             bigint not null default 0,    -- the MDR Razorpay does not
                                                      -- return on a refund
  mdr_borne_by          mdr_bearer not null default 'school',  -- M5, Andy's decision
  initiated_at          timestamptz not null default now(),
  completed_at          timestamptz,
  failed_at             timestamptz,
  failure_reason        text,
  correlation_id        uuid   not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint refund_amount_positive  check (amount_paise > 0),
  constraint refund_mdr_non_negative check (mdr_paise    >= 0)
);
create unique index uq_refund_provider_refund_id
  on refund (provider_refund_id) where provider_refund_id is not null;
create index ix_refund_group  on refund (order_group_id);
create index ix_refund_inflight
  on refund (status, initiated_at) where status in ('pending', 'processing');

create table refund_line (
  refund_id     uuid   not null references refund(id)     on delete cascade,
  order_line_id bigint not null references order_line(id) on delete restrict,
  quantity      integer not null,   -- supports "one of the three sandwiches was
                                    -- unavailable"
  amount_paise  bigint not null,
  created_at    timestamptz not null default now(),
  primary key (refund_id, order_line_id),
  constraint refund_line_quantity_positive check (quantity > 0),
  constraint refund_line_amount_positive   check (amount_paise > 0)
);

-- §8.4 — the ledger. D6: from v1, even though there is no visible wallet, because
-- refunds-to-wallet, school revenue share and future subscriptions are all the same
-- primitive and retrofitting after money has moved is painful.
--
-- [DM-03] OPEN, technical, expensive to reverse. Modelled as DOUBLE ENTRY: every
-- movement is a transaction containing two or more entries that sum to zero, so a
-- missing counterpart is a constraint violation at write time rather than a
-- discrepancy discovered a month later. It is what makes the E06-11 daily
-- reconciliation meaningful ("does our clearing account equal what Razorpay says it
-- holds" is one query), and it makes M5 (MDR out of the school's share), M8 (tax out
-- of the 10%) and the revenue split expressible with no special-case columns.
-- Single-entry is simpler to write and lets a bug credit a wallet without debiting
-- anywhere, invisibly.
create table ledger_account (
  id             uuid primary key default gen_random_uuid(),
  -- Human-readable and unique: platform:revenue, platform:tax_payable:cgst,
  -- user:<uuid>:wallet, school:<uuid>:payable, provider:razorpay:clearing.
  code           text        not null unique,
  owner_type     ledger_owner_type not null,
  owner_id       uuid,        -- null for platform and provider accounts. Polymorphic
                              -- by design, so no foreign key.
  account_type   ledger_account_type not null,
  normal_balance ledger_direction not null,   -- which way this account is expected to run
  currency       char(3)     not null default 'INR',
  is_active      boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ledger_account_owner_shape check (
    (owner_type in ('platform', 'provider') and owner_id is null)
    or (owner_type in ('user', 'school', 'kitchen') and owner_id is not null)
  ),
  constraint ledger_account_owner_unique unique (owner_type, owner_id, account_type)
);
comment on table ledger_account is 'A user''s wallet account is created lazily on first credit (§8.4).';

create table ledger_transaction (
  id                          uuid primary key default gen_random_uuid(),
  reason_code                 text        not null references reason_code(code) on delete restrict,
  source_type                 ledger_source_type not null,
  source_id                   uuid,                -- the payment / refund / payout
                                                   -- that caused it. Polymorphic.
  occurred_at                 timestamptz not null,  -- when the money moved; may be
                                                     -- backdated for a settlement
  posted_at                   timestamptz not null default now(),  -- when we wrote it.
                                                                   -- Never backdated.
  correlation_id              uuid,
  created_by_user_id          uuid references app_user(id) on delete restrict,
  memo                        text,                -- no PII
  reversal_of_transaction_id  uuid references ledger_transaction(id) on delete restrict,
  -- D16, and the second half of E06-04: a second webhook delivery for the same
  -- payment cannot post the same transaction twice. Again a constraint rather than
  -- logic.
  constraint ledger_transaction_source_unique unique (source_type, source_id, reason_code)
);
create index ix_ledger_transaction_occurred on ledger_transaction (occurred_at);
create index ix_ledger_transaction_source   on ledger_transaction (source_type, source_id);
comment on column ledger_transaction.reversal_of_transaction_id is
  'Corrections are REVERSALS, never edits. This table is append-only, enforced by trigger.';

create table ledger_entry (
  id             bigint generated always as identity primary key,
  transaction_id uuid    not null references ledger_transaction(id) on delete restrict,
  account_id     uuid    not null references ledger_account(id)     on delete restrict,
  direction      ledger_direction not null,
  amount_paise   bigint  not null,
  created_at     timestamptz not null default now(),
  -- The sign lives in `direction`, never in the amount. A negative amount would
  -- make "sum the debits" ambiguous.
  constraint ledger_entry_amount_positive check (amount_paise > 0)
);
create index ix_ledger_entry_account     on ledger_entry (account_id, id);  -- running balance
create index ix_ledger_entry_transaction on ledger_entry (transaction_id);

-- §8.5 — [DM-04] OPEN, technical. Modelled as a MAINTAINED row, written in the same
-- transaction as the ledger posting, with a nightly assertion that every wallet row
-- equals the sum of its ledger entries (riding along with the E06-11 reconciliation
-- job) and an alert on any drift. Checkout needs the balance on a hot path, and
-- summing a ledger per user per checkout is the kind of query that is fine at 400
-- users and not at 20,000. Deriving on read is impossible to drift and slower.
create table wallet_balance (
  user_id               uuid primary key references app_user(id) on delete restrict,
  balance_paise         bigint not null default 0,
  last_ledger_entry_id  bigint references ledger_entry(id) on delete restrict,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- The database refuses a negative wallet.
  constraint wallet_balance_non_negative check (balance_paise >= 0)
);
comment on table wallet_balance is
  'v1 holds REFUND-DERIVED CREDIT ONLY. Nothing writes here from a cash or card top-up: cash top-up of stored value is what the RBI Prepaid Payment Instrument rules regulate, and E18-09 / E18-10 stay blocked until that question is answered. The schema does not change either way; the constraint is on what may write to it. Migrated off-system balances enter as ledger credits with reason_code = migration_opening_balance, never as a direct write here (§12.5).';

-- §8.6 — [DM-02] OPEN. Modelled as ONE INVOICE PER order_group: a tax invoice
-- documents a supply that was paid for, the customer paid once, so they get one
-- invoice, which is also what their bank statement will match. Per-order invoices
-- would mean one checkout generates three invoice numbers, burning the gapless
-- sequence faster and confusing customers. Follows [DM-01]; if that lands on the
-- two-level shape, the question disappears.
create table invoice (
  id                         uuid primary key default gen_random_uuid(),
  invoice_number             text        not null unique,   -- rendered, e.g. GB/2026-27/000417
  financial_year             text        not null,          -- Indian FY, April to March
  sequence_no                integer     not null,
  document_type              invoice_document_type not null default 'tax_invoice',
  credit_note_of_invoice_id  uuid references invoice(id) on delete restrict,  -- E07-07
  order_group_id             uuid        not null references order_group(id) on delete restrict,
  issued_at                  timestamptz not null default now(),
  -- Seller identity is SNAPSHOTTED because a reprinted invoice must be
  -- byte-identical to the one issued (§13.2).
  seller_gstin               text        not null,   -- PLACEHOLDER until E00-10
  seller_legal_name          text        not null,
  seller_address             text        not null,
  place_of_supply_state_code char(2)     not null,   -- from city.gst_state_code
  sac_code                   text        not null,   -- 996331 assumed, unconfirmed (E00-10)
  buyer_name_snapshot        text        not null,   -- the paying adult, not the child
  buyer_email_snapshot       text,
  buyer_phone_snapshot       text,
  buyer_gstin                text,                   -- B2B is not expected; the column
                                                     -- costs nothing
  taxable_value_paise        bigint      not null,
  cgst_rate_bps              integer     not null,   -- 250 = 2.5% (M2)
  cgst_paise                 bigint      not null,
  sgst_rate_bps              integer     not null,
  sgst_paise                 bigint      not null,
  igst_rate_bps              integer     not null default 0,   -- 0 intra-state
  igst_paise                 bigint      not null default 0,
  -- SIGNED, deliberately. [DM-19] OPEN: rounding per line or per invoice. The schema
  -- supports either — per-line tax columns exist on invoice_line, and this column
  -- absorbs the difference between the sum of lines and the invoice total. Q09 must
  -- pick one rule, unit-test it (E07-02), and record which won in docs/data-model.md.
  round_off_paise            bigint      not null default 0,
  total_paise                bigint      not null,
  pickup_codes               text[],                 -- E07-03
  pdf_asset_id               uuid references asset(id) on delete restrict,
  status                     invoice_status not null default 'issued',
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint invoice_taxable_non_negative check (taxable_value_paise >= 0),
  constraint invoice_cgst_non_negative    check (cgst_paise >= 0),
  constraint invoice_sgst_non_negative    check (sgst_paise >= 0),
  constraint invoice_igst_non_negative    check (igst_paise >= 0),
  constraint invoice_total_non_negative   check (total_paise >= 0),
  constraint invoice_cgst_bps_range       check (cgst_rate_bps between 0 and 10000),
  constraint invoice_sgst_bps_range       check (sgst_rate_bps between 0 and 10000),
  constraint invoice_igst_bps_range       check (igst_rate_bps between 0 and 10000),
  constraint invoice_fy_sequence_unique   unique (financial_year, sequence_no)
);
create unique index uq_invoice_one_tax_invoice_per_group
  on invoice (order_group_id) where document_type = 'tax_invoice';
create index ix_invoice_issued on invoice (issued_at);
create index ix_invoice_group  on invoice (order_group_id);
comment on column invoice.buyer_name_snapshot  is 'Personal data tier A (§13.3). Retained on erasure because it IS the statutory record (§13.4).';
comment on column invoice.buyer_email_snapshot is 'Personal data tier A (§13.3). Retained on erasure — statutory record.';
comment on column invoice.buyer_phone_snapshot is 'Personal data tier A (§13.3). Retained on erasure — statutory record.';

create table invoice_line (
  id                  bigint generated always as identity primary key,
  invoice_id          uuid     not null references invoice(id) on delete cascade,
  line_no             smallint not null,
  order_line_id       bigint references order_line(id) on delete restrict,
  description         text     not null,
  sac_code            text     not null,
  quantity            integer  not null,
  unit_price_paise    bigint   not null,
  taxable_value_paise bigint   not null,
  cgst_paise          bigint   not null default 0,
  sgst_paise          bigint   not null default 0,
  total_paise         bigint   not null,
  created_at          timestamptz not null default now(),
  constraint invoice_line_quantity_positive check (quantity > 0),
  constraint invoice_line_unit_non_neg      check (unit_price_paise    >= 0),
  constraint invoice_line_taxable_non_neg   check (taxable_value_paise >= 0),
  constraint invoice_line_cgst_non_neg      check (cgst_paise          >= 0),
  constraint invoice_line_sgst_non_neg      check (sgst_paise          >= 0),
  constraint invoice_line_total_non_neg     check (total_paise         >= 0),
  constraint invoice_line_no_unique         unique (invoice_id, line_no)
);

-- §8.6 — how E07-01 / M3 is satisfied.
--
-- A Postgres SEQUENCE CANNOT BE USED HERE. Sequences are explicitly
-- non-transactional: a rolled-back transaction consumes its value and leaves a
-- permanent hole, which is precisely the "failed payments must not burn numbers"
-- failure M3 forbids. Instead, inside the same transaction that captures payment
-- and inserts the invoice:
--
--   UPDATE invoice_sequence
--      SET last_sequence_no = last_sequence_no + 1, updated_at = now()
--    WHERE financial_year = $fy
--   RETURNING last_sequence_no;
--
-- The row lock serialises invoice creation, which is CORRECT — gapless numbering
-- requires serialisation — and at a few thousand invoices a month the contention is
-- irrelevant. The number is allocated only AFTER payment capture, so a failed or
-- abandoned payment never reaches this statement. (D14, docs/learnings.md.)
create table invoice_sequence (
  financial_year   text primary key,          -- '2026-27'
  last_sequence_no integer     not null default 0,
  updated_at       timestamptz not null default now(),
  constraint invoice_sequence_non_negative check (last_sequence_no >= 0)
);

-- §8.7 — M6: settlement is a manual bank transfer; Razorpay Route is deferred
-- (E18-18). The report computes what is owed, admin may edit, then marks it paid
-- (E07-10). A payout only becomes settled when marked paid; until then it is a
-- report.
create table payout (
  id                     uuid primary key default gen_random_uuid(),
  payee_type             payout_payee_type not null,     -- E07-12
  payee_id               uuid    not null,               -- school or kitchen id.
                                                         -- Polymorphic, so no FK.
  period_start           date    not null,
  period_end             date    not null,
  currency               char(3) not null default 'INR',
  -- [DM-18] OPEN — the base. M4 fixes the rate (10%) and M8 says any tax on it comes
  -- out of it, but neither says 10% OF WHAT. Modelled as the TAXABLE VALUE excluding
  -- GST: paying a share of tax collected on the government's behalf is paying out
  -- money that was never GrayBag's revenue. Also undecided: earned on PAID or on
  -- DELIVERED orders, and what happens on a refund (modelled as reversed, with the
  -- MDR deducted per M5). Needs Andy, and probably the accountant.
  gross_sales_paise      bigint  not null,
  share_bps              integer not null,               -- SNAPSHOT of the resolved
                                                         -- rate, so the school can
                                                         -- check what was used
  share_paise            bigint  not null,
  mdr_deduction_paise    bigint  not null default 0,     -- M5
  adjustment_paise       bigint  not null default 0,     -- SIGNED: where the admin edit lands
  tax_withheld_paise     bigint  not null default 0,     -- M8
  net_payable_paise      bigint  not null,
  status                 payout_status not null default 'draft',
  computed_at            timestamptz not null default now(),
  confirmed_by_user_id   uuid references app_user(id) on delete restrict,  -- requires
                                                                           -- payouts.manage
  confirmed_at           timestamptz,
  paid_at                timestamptz,
  payment_reference      text,                           -- bank transfer reference
  -- Posted when marked paid, NOT when computed. A computed payout has moved no money.
  ledger_transaction_id  uuid references ledger_transaction(id) on delete restrict,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint payout_period_order         check (period_end >= period_start),
  constraint payout_gross_non_negative   check (gross_sales_paise   >= 0),
  constraint payout_share_non_negative   check (share_paise         >= 0),
  constraint payout_mdr_non_negative     check (mdr_deduction_paise >= 0),
  constraint payout_tax_non_negative     check (tax_withheld_paise  >= 0),
  constraint payout_share_bps_range      check (share_bps between 0 and 10000)
);
create unique index uq_payout_period
  on payout (payee_type, payee_id, period_start, period_end) where status <> 'cancelled';

create table payout_line (
  id           bigint generated always as identity primary key,
  payout_id    uuid   not null references payout(id) on delete cascade,
  order_id     uuid references "order"(id) on delete restrict,
  kind         text   not null,
  -- SIGNED. This is a report, not the ledger — the ledger's sign lives in
  -- ledger_entry.direction, but a payout line legitimately subtracts.
  amount_paise bigint not null,
  note         text,
  created_at   timestamptz not null default now(),
  -- Not an enum: `payout_line.kind` is not in the §13.1 enum inventory, so it is
  -- constrained text rather than an invented type.
  constraint payout_line_kind_valid check (kind in ('revenue_share', 'mdr_deduction', 'manual_adjustment'))
);
create index ix_payout_line_payout on payout_line (payout_id);

-- -----------------------------------------------------------------------------
-- 8. Permissions and grants (§10)
--
-- D3 and E02-07. There is NO ROLE COLUMN ANYWHERE. A back-office capability is a
-- permission_grant row: this user, this discrete permission, over this scope. The
-- legacy User.Role enum, which mixed *who you are* with *what you can do*, is
-- deleted.
--
-- The table is named permission_grant because GRANT is a SQL keyword and a table
-- called `grant` would need quoting in every statement forever.
-- -----------------------------------------------------------------------------

create table permission (
  code              text primary key,             -- e.g. orders.mark_delivered
  category          text        not null,         -- groups the admin UI
  display_name      text        not null,
  description       text        not null,         -- shown when granting, so nobody
                                                  -- grants orders.refund thinking it
                                                  -- means "cancel"
  is_sensitive      boolean     not null default false,
  valid_scope_types scope_type[] not null,        -- which scopes this may be granted at
  is_active         boolean     not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint permission_scope_types_non_empty check (cardinality(valid_scope_types) > 0)
);

-- §10.3 — D11. Grants remain the source of truth; a role template is only a bundle
-- that EXPANDS INTO GRANTS at assignment time. Editing a template later does not
-- retroactively change anyone's access — that is deliberate. Access changes should
-- be explicit and audited.
create table role_template (
  code               text primary key,
  display_name       text        not null,
  description        text,
  default_scope_type scope_type  not null,
  is_active          boolean     not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table role_template_permission (
  role_code       text not null references role_template(code) on delete cascade,
  permission_code text not null references permission(code)    on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (role_code, permission_code)
);

create table permission_grant (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid        not null references app_user(id)  on delete restrict,
  permission_code       text        not null references permission(code) on delete restrict,
  scope_type            scope_type  not null,
  scope_id              uuid,                     -- the city / kitchen / school id.
                                                  -- Polymorphic, so no FK.
  granted_via_role_code text references role_template(code) on delete set null,  -- provenance
                                                                                 -- only; the
                                                                                 -- grant is the truth
  granted_by_user_id    uuid        not null references app_user(id) on delete restrict,
  granted_at            timestamptz not null default now(),
  expires_at            timestamptz,              -- time-boxed access, e.g. a contractor
  revoked_at            timestamptz,              -- revoked, never deleted
  revoked_by_user_id    uuid references app_user(id) on delete restrict,
  revoke_reason         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Null scope_id IF AND ONLY IF the grant is platform-wide. Without the biconditional
  -- a school-scoped grant with a null scope_id would silently mean "every school".
  constraint permission_grant_scope_shape check ((scope_type = 'platform') = (scope_id is null))
);
create unique index uq_permission_grant_active
  on permission_grant (user_id, permission_code, scope_type, scope_id) where revoked_at is null;
-- The hottest authorization lookup in the system. now() is not IMMUTABLE, so the
-- expiry test lives in the query rather than in the index predicate; the partial
-- index on revoked_at is the part that matters.
create index ix_permission_grant_user on permission_grant (user_id) where revoked_at is null;

-- -----------------------------------------------------------------------------
-- 9. Policy, consent and data-subject rights (§11)
--
-- The legal shape of all of this is blocked on E20-01. What follows is the
-- STRUCTURE needed to record whatever the lawyer says, not a claim about what the
-- law requires.
-- -----------------------------------------------------------------------------

create table policy_document (
  code         text primary key,   -- privacy_policy, terms_of_service,
                                   -- refund_policy, child_data_notice
  display_name text not null,
  applies_to   policy_audience not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- §11.2 — E02-15
create table policy_version (
  id                 uuid primary key default gen_random_uuid(),
  policy_code        text        not null references policy_document(code) on delete restrict,
  version            text        not null,        -- monotonic within a policy: 1, 2, 2.1
  effective_from     timestamptz not null,
  published_at       timestamptz,                 -- null while drafted
  content_md         text,                        -- the text itself, so a version is
                                                  -- reproducible without a deploy
  content_url        text,
  content_sha256     text        not null,        -- proof that what a user accepted is
                                                  -- what is stored
  requires_acceptance boolean    not null default true,   -- some updates are informational
  blocks_ordering    boolean     not null default false,  -- E20-03
  summary_of_changes text,
  created_by_user_id uuid references app_user(id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint policy_version_unique unique (policy_code, version)
);
create index ix_policy_version_effective on policy_version (policy_code, effective_from desc);
comment on table policy_version is
  'Rows are IMMUTABLE once published_at is set — a trigger blocks updates. A "correction" is a new version; content_sha256 is meaningless otherwise.';

-- §11.3 — E02-15. Append-only.
create table user_policy_acceptance (
  id                bigint generated always as identity primary key,
  user_id           uuid        not null references app_user(id)       on delete restrict,
  policy_version_id uuid        not null references policy_version(id) on delete restrict,
  accepted_at       timestamptz not null default now(),
  source            acceptance_source not null,
  app_version       text,
  -- Hashed with a server-side pepper, NEVER the raw IP or user agent. Enough to
  -- evidence a distinct acceptance; not a location record.
  ip_hash           text,
  user_agent_hash   text,
  constraint user_policy_acceptance_unique unique (user_id, policy_version_id)
);
create index ix_user_policy_acceptance_user on user_policy_acceptance (user_id, accepted_at desc);
comment on table user_policy_acceptance is
  'The E20-03 ordering gate: order creation checks that, for every policy_version where blocks_ordering and effective_from <= now() and it is the latest version of its policy, a matching acceptance row exists for the customer. source = migration is used only for a pre-cutover acceptance carried over WITH EVIDENCE, never to fabricate consent nobody gave.';

-- §11.4 — E02-16. Consent is PURPOSE-SCOPED. One blanket "I agree" is exactly what
-- DPDP is designed to stop.
create table consent_purpose (
  code                    text primary key,
  display_name            text        not null,   -- written in the words shown to the user
  description             text,
  legal_basis             text,                   -- to be filled from E20-01
  is_required_for_service boolean     not null default false,
  applies_to_subject      consent_subject_scope not null,
  is_active               boolean     not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- §11.5 — E02-16. NOT a row per consent that gets flipped: a row per EVENT, so the
-- history is "granted on the 3rd, withdrawn on the 20th, granted again on the 22nd",
-- which is what a regulator asks for and what E20-04 needs.
create table consent_record (
  id                  bigint generated always as identity primary key,
  user_id             uuid        not null references app_user(id) on delete restrict,  -- the
                                                    -- adult giving or withdrawing consent
  subject_type        consent_subject_type not null,
  subject_id          uuid        not null,        -- polymorphic (app_user or recipient)
  purpose_code        text        not null references consent_purpose(code) on delete restrict,
  action              consent_action not null,
  policy_version_id   uuid references policy_version(id) on delete restrict,  -- the privacy
                                                    -- notice in force at the time (E20-02)
  occurred_at         timestamptz not null default now(),
  capture_method      consent_capture_method not null,
  -- [DM-12] OPEN — how the parent was verified. DPDP requires parental consent for a
  -- child's data to be VERIFIABLE. What counts (a tick box by an OTP-authenticated
  -- adult, a payment-instrument check, a government-ID check) is a legal question
  -- (E20-01) and the answers differ enormously in build cost. This column exists to
  -- record whichever answer comes back, and is deliberately untyped text until it
  -- does. DO NOT BUILD THE CONSENT UI UNTIL E20-01 RETURNS.
  verification_method text,
  capture_context     jsonb,                       -- screen name, app version, the exact
                                                   -- wording id shown. NO PII.
  evidence_text       text,                        -- for written / admin_recorded
  recorded_by_user_id uuid references app_user(id) on delete restrict
);
create index ix_consent_record_subject on consent_record (subject_type, subject_id, purpose_code, occurred_at desc);
create index ix_consent_record_user    on consent_record (user_id, occurred_at desc);
comment on table consent_record is
  'The consent capture point is dependent creation (E05-01 / E20-02): adding a dependent writes the recipient, the guardian_link and the consent_record rows in ONE transaction. If the consent write fails, the recipient does not exist.';

-- What application code reads: the latest event per subject and purpose.
--
-- security_invoker = true is essential. Without it a view runs with the owner's
-- privileges and would read straight past the RLS on consent_record, which would
-- make this view a hole in the default-deny promise (§13.7).
create view current_consent with (security_invoker = true) as
select distinct on (cr.subject_type, cr.subject_id, cr.purpose_code)
       cr.subject_type,
       cr.subject_id,
       cr.purpose_code,
       cr.user_id,
       cr.action,
       cr.occurred_at,
       cr.policy_version_id,
       cr.capture_method,
       cr.verification_method
  from consent_record cr
 order by cr.subject_type, cr.subject_id, cr.purpose_code, cr.occurred_at desc, cr.id desc;

-- §11.6 — E20-04, E20-07
create table data_subject_request (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid        not null references app_user(id) on delete restrict,
  subject_recipient_id uuid references recipient(id) on delete restrict,  -- null when the
                                                    -- request is about the user themself
  request_type         dsr_type    not null,
  channel              dsr_channel not null,
  status               dsr_status  not null default 'received',
  received_at          timestamptz not null default now(),
  due_at               timestamptz not null,       -- statutory deadline computed from
                                                   -- received_at; the number of days is
                                                   -- TBD by E20-01
  assigned_to_user_id  uuid references app_user(id) on delete restrict,   -- the grievance
                                                                          -- officer (E20-07)
  completed_at         timestamptz,
  resolution_note      text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- The "what is overdue" query. Missing a statutory deadline is the failure mode.
create index ix_data_subject_request_due
  on data_subject_request (status, due_at) where status in ('received', 'in_progress');

-- §11.7 — E20-05. Retention as DATA, not as a comment in a cron job, so the policy
-- is inspectable and its enforcement is evidenced.
--
-- Deliberately NOT seeded: the retention minimum for GST invoices is an open
-- question with the accountant, and inventing a number here would be inventing the
-- law. [DM-15] settles the SHAPE (soft delete, then anonymise in place, never a hard
-- delete where an invoice or ledger entry depends on the row); the NUMBERS are open.
create table retention_policy (
  entity              text primary key,           -- table name
  retention_days      integer     not null,
  basis               text        not null,       -- why
  action              text        not null,
  is_statutory        boolean     not null default false,
  last_reviewed_at    timestamptz,
  reviewed_by_user_id uuid references app_user(id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint retention_policy_days_positive check (retention_days > 0),
  constraint retention_policy_action_valid  check (action in ('delete', 'anonymise'))
);

create table purge_run (
  id            bigint generated always as identity primary key,
  entity        text        not null,
  ran_at        timestamptz not null default now(),
  cutoff_date   date        not null,
  rows_affected bigint      not null default 0,
  is_dry_run    boolean     not null default false,
  error_text    text
);
comment on table purge_run is
  'Every run logs, INCLUDING dry runs, so "we said we delete after N days" is demonstrable to a regulator.';

-- -----------------------------------------------------------------------------
-- 10. Operational tables (§12). `asset` is defined earlier, with the reference
--     tables, because dish_category and dish depend on it.
-- -----------------------------------------------------------------------------

-- §12.1 — generic, used by order creation (E05-12) and any other non-idempotent
-- Edge Function. order_group's own unique (customer_user_id, idempotency_key) is
-- the AUTHORITATIVE guard for orders; this table exists so the RESPONSE can be
-- replayed rather than the second caller receiving a bare conflict.
create table idempotency_key (
  key             text primary key,
  scope           text        not null,           -- endpoint name, so keys cannot
                                                  -- collide across features
  user_id         uuid references app_user(id) on delete restrict,
  -- A repeat with the SAME key and a DIFFERENT body is an error, not a replay.
  request_hash    text        not null,
  resource_type   text,
  resource_id     uuid,
  response_status integer,
  response_body   jsonb,                          -- replayed verbatim to the second caller
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null            -- 24h TTL, purged by job
);
create index ix_idempotency_key_expiry on idempotency_key (expires_at);

-- §12.3 — E08
create table device_token (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid        not null references app_user(id) on delete restrict,
  platform        text        not null,
  expo_push_token text,
  native_token    text,
  app_version     text,
  os_version      text,
  last_seen_at    timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Not an enum: device platform is not in the §13.1 enum inventory.
  constraint device_token_platform_valid check (platform in ('ios', 'android', 'web'))
);
create unique index uq_device_token_expo
  on device_token (expo_push_token) where expo_push_token is not null and revoked_at is null;
create index ix_device_token_user on device_token (user_id) where revoked_at is null;

-- E08-09. An ABSENT row means the category default, so a user who has never touched
-- preferences has no rows at all.
create table notification_preference (
  user_id    uuid    not null references app_user(id) on delete restrict,
  channel    text    not null,
  category   text    not null,
  enabled    boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, channel, category),
  constraint notification_preference_channel_valid  check (channel in ('push', 'email', 'sms')),
  constraint notification_preference_category_valid check (category in ('order_updates', 'cutoff_reminder', 'menu_updates', 'marketing'))
);

create table notification_delivery (
  id                  bigint generated always as identity primary key,
  user_id             uuid   not null references app_user(id) on delete restrict,
  channel             text   not null,
  template_code       text   not null,
  order_id            uuid references "order"(id)     on delete set null,
  order_group_id      uuid references order_group(id) on delete set null,
  status              text   not null default 'queued',
  provider            text,
  provider_message_id text,
  queued_at           timestamptz not null default now(),
  sent_at             timestamptz,
  failed_at           timestamptz,
  error_text          text,
  suppressed_reason   text,
  correlation_id      uuid,
  constraint notification_delivery_channel_valid check (channel in ('push', 'email', 'sms')),
  constraint notification_delivery_status_valid  check (status in ('queued', 'sent', 'delivered', 'failed', 'suppressed'))
);
create index ix_notification_delivery_user  on notification_delivery (user_id, queued_at desc);
create index ix_notification_delivery_order on notification_delivery (order_id);
comment on table notification_delivery is
  'RULE: never store the rendered message body. A push telling a parent "Aarav''s lunch has been delivered" contains a child''s name, and storing it multiplies the copies of children''s PII for no operational gain. Store template_code plus non-PII parameters and reconstruct if needed (E20-10 applied to the notification log, not only to Sentry). A transactional outbox is deliberately not modelled — Edge Functions writing directly to the provider with this table as the record is adequate at this volume.';

-- §12.4 — E11
create table school_report (
  id                    uuid primary key default gen_random_uuid(),
  school_id             uuid    not null references school(id) on delete restrict,
  period_month          date    not null,          -- first of the month
  order_count           integer not null default 0,
  delivered_count       integer not null default 0,
  gross_sales_paise     bigint  not null default 0,
  share_bps             integer not null,
  share_paise           bigint  not null default 0,
  cumulative_share_paise bigint not null default 0, -- E11-02, total paid to date
  pdf_asset_id          uuid references asset(id) on delete restrict,
  status                report_status not null default 'draft',
  generated_at          timestamptz not null default now(),
  sent_at               timestamptz,
  sent_to_email         text,
  regenerated_count     integer not null default 0,  -- E11-06
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint school_report_gross_non_negative      check (gross_sales_paise      >= 0),
  constraint school_report_share_non_negative      check (share_paise            >= 0),
  constraint school_report_cumulative_non_negative check (cumulative_share_paise >= 0),
  constraint school_report_share_bps_range         check (share_bps between 0 and 10000),
  constraint school_report_period_is_month_start   check (period_month = date_trunc('month', period_month::timestamp)::date),
  constraint school_report_period_unique           unique (school_id, period_month)
);
comment on table school_report is
  'AGGREGATES ONLY. There is no recipient_id on this table or on anything it references, and there never will be (E11-03, E20-09). The absence is the control.';

-- §12.6 — E10-11
create table audit_log (
  id                    bigint generated always as identity primary key,
  occurred_at           timestamptz not null default now(),
  actor_user_id         uuid references app_user(id) on delete restrict,  -- null for system
  actor_type            actor_type  not null,
  -- Set when acting under users.impersonate (E10-13). View-as-user is never invisible.
  impersonated_user_id  uuid references app_user(id) on delete restrict,
  action                text        not null,      -- order.refunded, config.changed,
                                                   -- grant.revoked
  entity_type           text,
  entity_id             uuid,
  scope_type            scope_type,
  scope_id              uuid,
  before                jsonb,
  after                 jsonb,
  changed_keys          text[],
  correlation_id        uuid,
  ip_hash               text,                      -- hashed, never raw
  user_agent_hash       text,
  source                event_source not null
);
create index ix_audit_log_entity   on audit_log (entity_type, entity_id, occurred_at desc);
create index ix_audit_log_actor    on audit_log (actor_user_id, occurred_at desc);
create index ix_audit_log_occurred on audit_log (occurred_at);   -- retention purging
comment on table audit_log is
  'REDACTION RULE: for any column tagged tier S or P in §13.3 (discoverable from the COMMENT on each such column in this schema), `before`/`after` record the key name in changed_keys and OMIT THE VALUE. An audit log that faithfully copies every change to recipient.allergy_note is a second, longer-lived, more widely-read copy of children''s health data. Asserted by a test (E20-10).';

-- -----------------------------------------------------------------------------
-- 11. Migration staging (§12.5) — schema `migration`
--
-- Kept in its own schema so it can be dropped wholesale after cutover and can never
-- be confused with live data.
-- -----------------------------------------------------------------------------

create table migration.legacy_id_map (
  entity_type      text not null,
  legacy_id        text not null,
  new_id           uuid not null,
  migration_run_id uuid,
  migrated_at      timestamptz not null default now(),
  notes            text,
  primary key (entity_type, legacy_id),
  constraint legacy_id_map_new_id_unique unique (entity_type, new_id)
);
comment on table migration.legacy_id_map is
  'Every table that came from Bubble ALSO carries legacy_bubble_id directly. The redundancy is deliberate: the column answers "where did this row come from" during a support call without a join to a schema that will be deleted.';

-- The "report conflicts rather than guessing" table that E16-03, E16-06 and E16-14
-- all need.
create table migration.migration_review (
  id                 bigint generated always as identity primary key,
  entity_type        text not null,
  legacy_id          text,
  issue              migration_issue not null,
  detail             jsonb,
  status             review_status not null default 'open',
  resolved_by_user_id uuid references public.app_user(id) on delete restrict,
  resolved_at        timestamptz,
  resolution_note    text,
  created_at         timestamptz not null default now()
);
create index ix_migration_review_open on migration.migration_review (status, entity_type) where status = 'open';
comment on table migration.migration_review is
  'ANY row here with status = open BLOCKS that record''s account from being auto-claimed by OTP (E03-11). One OTP claiming the wrong account also claims that family''s children''s records, which is the worst outcome available in this migration.';

-- E16-15. Populated BY HAND and verified by a human, because the legacy db values
-- contradict their labels (10__00_am renders as "10:40AM - 11:15AM"). Migrating on
-- either the value or the label silently puts orders in the wrong break.
create table migration.break_time_legacy_map (
  legacy_option_value text primary key,
  legacy_label        text,
  verified_starts_at  time not null,
  verified_ends_at    time not null,
  school_id           uuid references public.school(id)   on delete restrict,
  verified_by_user_id uuid references public.app_user(id) on delete restrict,
  verified_at         timestamptz,
  constraint break_time_legacy_map_range check (verified_ends_at > verified_starts_at)
);

-- E16-16. Only populated if E00-18 finds that off-system prepaid balances exist.
-- They enter the live system as LEDGER CREDITS with reason_code =
-- migration_opening_balance, never as a direct write to wallet_balance — otherwise
-- the ledger and the balance disagree from day one.
create table migration.wallet_opening_balance (
  id                          bigint generated always as identity primary key,
  legacy_user_id              text not null,
  phone_e164                  text,
  balance_paise               bigint not null,
  source_note                 text,
  verified_by_user_id         uuid references public.app_user(id) on delete restrict,
  posted_ledger_transaction_id uuid references public.ledger_transaction(id) on delete restrict,
  created_at                  timestamptz not null default now(),
  constraint wallet_opening_balance_non_negative check (balance_paise >= 0),
  constraint wallet_opening_balance_legacy_unique unique (legacy_user_id)
);

-- -----------------------------------------------------------------------------
-- 12. Authorization helper (§10.4)
--
-- SCOPE WIDENING is the single most important rule in the authorization model, and
-- the one most likely to be got wrong. A grant at a WIDER scope satisfies a check at
-- a narrower one:
--     platform     -> everything
--     city C       -> any kitchen in C, any school in C
--     kitchen K    -> kitchen K, and ANY SCHOOL WHOSE kitchen_id = K
--     school S     -> school S only
-- The kitchen -> school widening is what makes "a kitchen operator sees the orders
-- for all the schools their kitchen serves" work without enumerating schools in
-- grants (E09-10).
--
-- SECURITY DEFINER IS MANDATORY HERE AND THE REASON IS NOT OBVIOUS. An RLS policy on
-- permission_grant would otherwise call a function that reads permission_grant,
-- re-triggering the policy — infinite recursion, which Postgres reports as a
-- confusing error at query time rather than at definition time. A SECURITY DEFINER
-- function owned by a role that bypasses RLS breaks the cycle. It MUST pin
-- search_path or it is a privilege-escalation vector. (docs/learnings.md.)
-- -----------------------------------------------------------------------------

create function auth_has_permission(
  p_user       uuid,
  p_permission text,
  p_scope_type scope_type,
  p_scope_id   uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from permission_grant g
      join app_user u on u.id = g.user_id
     where g.user_id         = p_user
       and g.permission_code = p_permission
       and g.revoked_at is null
       and (g.expires_at is null or g.expires_at > now())
       -- A disabled or deleted account holds no permissions, whatever its grants say.
       and u.is_disabled = false
       and u.deleted_at is null
       and (
            g.scope_type = 'platform'
         or (g.scope_type = p_scope_type and g.scope_id = p_scope_id)
         or (g.scope_type = 'city'    and p_scope_type = 'kitchen'
             and exists (select 1 from kitchen k where k.id = p_scope_id and k.city_id    = g.scope_id))
         or (g.scope_type = 'city'    and p_scope_type = 'school'
             and exists (select 1 from school  s where s.id = p_scope_id and s.city_id    = g.scope_id))
         or (g.scope_type = 'kitchen' and p_scope_type = 'school'
             and exists (select 1 from school  s where s.id = p_scope_id and s.kitchen_id = g.scope_id))
       )
  );
$$;
comment on function auth_has_permission(uuid, text, scope_type, uuid) is
  'Scope widening per §10.4. The full policy-by-policy specification is Q03 / docs/authorization-model.md; the pgTAP suite asserting every allow AND every deny is E02-09 / Q04.';

-- -----------------------------------------------------------------------------
-- 13. Invariants enforced as deferred constraint triggers
--
-- These are DEFERRABLE INITIALLY DEFERRED because the rows they relate are written
-- in one transaction: a group and its orders, a ledger transaction and its entries,
-- a recipient and its first guardian link. Checking at commit lets the writer insert
-- in any order; checking per statement would force an artificial ordering on every
-- caller.
-- -----------------------------------------------------------------------------

-- §7.2 — the group's totals must equal the sum over its member orders. The row-local
-- half (payable = subtotal + tax - discount - wallet) is a plain CHECK on the table.
--
-- Note the consequence, which is intended: a group-level discount has to be
-- distributed across member orders rather than held only at the group, because the
-- invoice lines are built from the orders and a discount that exists only at the
-- group would not appear on any line.
create function assert_order_group_totals(p_group_id uuid) returns void
language plpgsql as $$
declare
  g order_group%rowtype;
  s record;
begin
  select * into g from order_group where id = p_group_id;
  if not found then
    return;   -- the group was deleted in this same transaction; nothing to assert
  end if;

  select coalesce(sum(o.subtotal_paise), 0)                                          as subtotal,
         coalesce(sum(o.tax_cgst_paise + o.tax_sgst_paise + o.tax_igst_paise), 0)    as tax,
         coalesce(sum(o.discount_paise), 0)                                          as discount
    into s
    from "order" o
   where o.order_group_id = p_group_id;

  if g.subtotal_paise <> s.subtotal
     or g.tax_total_paise <> s.tax
     or g.discount_paise <> s.discount then
    raise exception
      'order_group % totals do not match its orders: group (subtotal %, tax %, discount %) vs orders (subtotal %, tax %, discount %)',
      p_group_id, g.subtotal_paise, g.tax_total_paise, g.discount_paise, s.subtotal, s.tax, s.discount
      using errcode = 'check_violation';
  end if;
end;
$$;

create function trg_assert_order_group_totals() returns trigger
language plpgsql as $$
begin
  perform assert_order_group_totals(new.id);
  return null;
end;
$$;

create function trg_assert_order_group_totals_from_order() returns trigger
language plpgsql as $$
begin
  if tg_op <> 'INSERT' and old.order_group_id is not null then
    perform assert_order_group_totals(old.order_group_id);
  end if;
  if tg_op <> 'DELETE' then
    perform assert_order_group_totals(new.order_group_id);
  end if;
  return null;
end;
$$;

create constraint trigger order_group_totals_match_orders
  after insert or update on order_group
  deferrable initially deferred
  for each row execute function trg_assert_order_group_totals();

create constraint trigger order_totals_roll_up_to_group
  after insert or update or delete on "order"
  deferrable initially deferred
  for each row execute function trg_assert_order_group_totals_from_order();

-- §8.4 — the double-entry invariant. For every transaction, sum(debits) =
-- sum(credits), and a transaction has at least two entries. A missing counterpart is
-- a constraint violation at write time instead of a discrepancy found a month later,
-- which is the entire argument for double entry ([DM-03]).
create function assert_ledger_transaction_balances(p_transaction_id uuid) returns void
language plpgsql as $$
declare
  v_count  bigint;
  v_signed bigint;
begin
  if not exists (select 1 from ledger_transaction where id = p_transaction_id) then
    return;
  end if;

  select count(*),
         coalesce(sum(case when direction = 'debit' then amount_paise else -amount_paise end), 0)
    into v_count, v_signed
    from ledger_entry
   where transaction_id = p_transaction_id;

  if v_count < 2 then
    raise exception 'ledger_transaction % has % entries; a transaction needs at least two', p_transaction_id, v_count
      using errcode = 'check_violation';
  end if;
  if v_signed <> 0 then
    raise exception 'ledger_transaction % does not balance: debits minus credits = % paise', p_transaction_id, v_signed
      using errcode = 'check_violation';
  end if;
end;
$$;

create function trg_assert_ledger_transaction_balances() returns trigger
language plpgsql as $$
begin
  perform assert_ledger_transaction_balances(new.id);
  return null;
end;
$$;

create function trg_assert_ledger_entry_balances() returns trigger
language plpgsql as $$
begin
  perform assert_ledger_transaction_balances(new.transaction_id);
  return null;
end;
$$;

create constraint trigger ledger_transaction_must_balance
  after insert on ledger_transaction
  deferrable initially deferred
  for each row execute function trg_assert_ledger_transaction_balances();

create constraint trigger ledger_entry_must_balance
  after insert on ledger_entry
  deferrable initially deferred
  for each row execute function trg_assert_ledger_entry_balances();

-- §4.2 — a recipient must have at least one active guardian_link, and is_self = true
-- requires the sole active link to be relationship = 'self'.
--
-- Soft-deleted recipients are exempt: §13.4 stops access by setting deleted_at and
-- then anonymises, and an erasure legitimately revokes the links.
create function assert_recipient_guardian_links(p_recipient_id uuid) returns void
language plpgsql as $$
declare
  r recipient%rowtype;
  v_active bigint;
  v_self   bigint;
begin
  select * into r from recipient where id = p_recipient_id;
  if not found or r.deleted_at is not null then
    return;
  end if;

  select count(*), count(*) filter (where relationship = 'self')
    into v_active, v_self
    from guardian_link
   where recipient_id = p_recipient_id and revoked_at is null;

  if v_active = 0 then
    raise exception 'recipient % has no active guardian_link; guardian_link is the only path to a recipient (D10)', p_recipient_id
      using errcode = 'check_violation';
  end if;

  if r.is_self and not (v_active = 1 and v_self = 1) then
    raise exception 'recipient % is is_self, so its sole active guardian_link must have relationship = self (% active, % self)', p_recipient_id, v_active, v_self
      using errcode = 'check_violation';
  end if;
end;
$$;

create function trg_assert_recipient_guardian_links() returns trigger
language plpgsql as $$
begin
  perform assert_recipient_guardian_links(new.id);
  return null;
end;
$$;

create function trg_assert_recipient_guardian_links_from_link() returns trigger
language plpgsql as $$
begin
  if tg_op <> 'INSERT' then
    perform assert_recipient_guardian_links(old.recipient_id);
  end if;
  if tg_op <> 'DELETE' then
    perform assert_recipient_guardian_links(new.recipient_id);
  end if;
  return null;
end;
$$;

create constraint trigger recipient_must_have_guardian
  after insert or update on recipient
  deferrable initially deferred
  for each row execute function trg_assert_recipient_guardian_links();

create constraint trigger guardian_link_keeps_recipient_reachable
  after insert or update or delete on guardian_link
  deferrable initially deferred
  for each row execute function trg_assert_recipient_guardian_links_from_link();

-- §8.3 — the sum of refunds for a group must not exceed what was captured.
-- Over-refunding is a real and expensive bug, so it is a constraint rather than a
-- code review.
create function trg_assert_refund_not_over_captured() returns trigger
language plpgsql as $$
declare
  v_group uuid := new.order_group_id;
  v_captured bigint;
  v_refunded bigint;
begin
  select coalesce(sum(amount_paise), 0) into v_captured
    from payment where order_group_id = v_group and status = 'captured';

  select coalesce(sum(amount_paise), 0) into v_refunded
    from refund where order_group_id = v_group and status <> 'failed';

  if v_refunded > v_captured then
    raise exception 'refunds for order_group % total % paise but only % paise were captured', v_group, v_refunded, v_captured
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger refund_not_over_captured
  after insert or update on refund
  deferrable initially deferred
  for each row execute function trg_assert_refund_not_over_captured();

-- §10.2 — scope_type must be one the permission allows. A CHECK constraint cannot
-- reference another table, so this is a trigger.
create function trg_assert_permission_grant_scope() returns trigger
language plpgsql as $$
declare
  v_valid scope_type[];
begin
  select valid_scope_types into v_valid from permission where code = new.permission_code;
  if v_valid is null then
    raise exception 'unknown permission %', new.permission_code using errcode = 'foreign_key_violation';
  end if;
  if not (new.scope_type = any (v_valid)) then
    raise exception 'permission % may not be granted at scope %; valid scopes are %', new.permission_code, new.scope_type, v_valid
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger permission_grant_scope_is_valid
  before insert or update on permission_grant
  for each row execute function trg_assert_permission_grant_scope();

-- §11.2 — a published policy version is immutable. A "correction" is a new version;
-- content_sha256 is meaningless otherwise.
create function trg_policy_version_immutable_once_published() returns trigger
language plpgsql as $$
begin
  if old.published_at is not null then
    raise exception 'policy_version % is published and therefore immutable; create a new version instead', old.id
      using errcode = 'restrict_violation';
  end if;
  -- NEW is not assigned in a DELETE trigger, so return OLD on that path.
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger policy_version_immutable
  before update or delete on policy_version
  for each row execute function trg_policy_version_immutable_once_published();

-- -----------------------------------------------------------------------------
-- 14. Cache-invalidation triggers (§6.3, §6.8)
-- -----------------------------------------------------------------------------

-- menu.version is incremented on ANY change to the menu or its items (E04-08).
-- Changes to `version` and `updated_at` alone are ignored, so the bump driven by a
-- menu_item change below does not bump a second time.
create function trg_bump_menu_version() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'version' - 'updated_at') is distinct from (to_jsonb(old) - 'version' - 'updated_at') then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

create trigger bump_menu_version
  before update on menu
  for each row execute function trg_bump_menu_version();

create function trg_bump_menu_version_from_item() returns trigger
language plpgsql as $$
declare
  v_old_menu uuid;
  v_new_menu uuid;
begin
  if tg_op <> 'INSERT' then v_old_menu := old.menu_id; end if;
  if tg_op <> 'DELETE' then v_new_menu := new.menu_id; end if;

  update menu set version = version + 1
   where id in (v_old_menu, v_new_menu) and id is not null;
  return null;
end;
$$;

create trigger bump_menu_version_from_item
  after insert or update or delete on menu_item
  for each row execute function trg_bump_menu_version_from_item();

-- §6.8 — the school-facing cache token. Monotonic, and deliberately NOT menu.version:
-- two schools sharing one menu but with different price overrides must invalidate
-- independently, and a school whose assignment flipped to a different menu has to
-- invalidate even though neither menu changed.
create function bump_school_menu_version(p_school_ids uuid[]) returns void
language plpgsql as $$
begin
  insert into school_menu_version (school_id, menu_id, version, updated_at)
  select s.id,
         (select ma.menu_id
            from menu_assignment ma
           where ma.school_id = s.id
             and ma.revoked_at is null
             and ma.valid_from <= current_date
             and (ma.valid_to is null or ma.valid_to > current_date)
           limit 1),
         1,
         now()
    from school s
   where s.id = any (p_school_ids)
      on conflict (school_id) do update
         set version    = school_menu_version.version + 1,
             menu_id    = excluded.menu_id,
             updated_at = now();
end;
$$;
comment on function bump_school_menu_version(uuid[]) is
  'menu_id here is ADVISORY — it is the menu effective on the day the token was last bumped. The guarantee the endpoint relies on is that `version` is monotonic and changes whenever anything a school sees changes. A FUTURE-DATED menu_assignment becomes effective on a day when no DML happens, so refresh_school_menu_versions() must be run by the nightly job to bump those schools; without it a school whose assignment rolls over at midnight would serve a stale cached menu until something else changed. Recorded in docs/learnings.md.';

-- Called by the nightly job. Bumps any school whose effective menu today differs
-- from the menu recorded on its token, which is exactly the set that rolled over.
create function refresh_school_menu_versions() returns integer
language plpgsql as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(smv.school_id), '{}')
    into v_ids
    from school_menu_version smv
   where smv.menu_id is distinct from (
           select ma.menu_id
             from menu_assignment ma
            where ma.school_id = smv.school_id
              and ma.revoked_at is null
              and ma.valid_from <= current_date
              and (ma.valid_to is null or ma.valid_to > current_date)
            limit 1
         );

  if cardinality(v_ids) > 0 then
    perform bump_school_menu_version(v_ids);
  end if;
  return cardinality(v_ids);
end;
$$;

-- One token row per school, created with the school.
create function trg_create_school_menu_version() returns trigger
language plpgsql as $$
begin
  insert into school_menu_version (school_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;

create trigger create_school_menu_version
  after insert on school
  for each row execute function trg_create_school_menu_version();

-- A change to a menu affects every school with a live assignment to it.
create function trg_bump_smv_from_menu() returns trigger
language plpgsql as $$
begin
  perform bump_school_menu_version(array(
    select ma.school_id from menu_assignment ma
     where ma.menu_id = new.id and ma.revoked_at is null
  ));
  return null;
end;
$$;

create trigger bump_smv_from_menu
  after update on menu
  for each row execute function trg_bump_smv_from_menu();

create function trg_bump_smv_from_menu_item() returns trigger
language plpgsql as $$
declare
  v_menus uuid[];
begin
  v_menus := array_remove(array[
    case when tg_op <> 'INSERT' then old.menu_id end,
    case when tg_op <> 'DELETE' then new.menu_id end
  ], null);

  perform bump_school_menu_version(array(
    select ma.school_id from menu_assignment ma
     where ma.menu_id = any (v_menus) and ma.revoked_at is null
  ));
  return null;
end;
$$;

create trigger bump_smv_from_menu_item
  after insert or update or delete on menu_item
  for each row execute function trg_bump_smv_from_menu_item();

-- The assignment itself changing is the case menu.version cannot express.
create function trg_bump_smv_from_assignment() returns trigger
language plpgsql as $$
begin
  perform bump_school_menu_version(array_remove(array[
    case when tg_op <> 'INSERT' then old.school_id end,
    case when tg_op <> 'DELETE' then new.school_id end
  ], null));
  return null;
end;
$$;

create trigger bump_smv_from_assignment
  after insert or update or delete on menu_assignment
  for each row execute function trg_bump_smv_from_assignment();

-- A per-school price override changes what one school sees and nobody else.
create function trg_bump_smv_from_price_override() returns trigger
language plpgsql as $$
begin
  perform bump_school_menu_version(array_remove(array[
    case when tg_op <> 'INSERT' then old.school_id end,
    case when tg_op <> 'DELETE' then new.school_id end
  ], null));
  return null;
end;
$$;

create trigger bump_smv_from_price_override
  after insert or update or delete on menu_item_price_override
  for each row execute function trg_bump_smv_from_price_override();

-- A dish changing affects only the schools whose assigned menus contain it.
create function trg_bump_smv_from_dish() returns trigger
language plpgsql as $$
begin
  perform bump_school_menu_version(array(
    select distinct ma.school_id
      from menu_item mi
      join menu_assignment ma on ma.menu_id = mi.menu_id and ma.revoked_at is null
     where mi.dish_id = new.id
  ));
  return null;
end;
$$;

create trigger bump_smv_from_dish
  after update on dish
  for each row execute function trg_bump_smv_from_dish();

-- Replacing a dish image is a menu change from the app's point of view.
create function trg_bump_smv_from_asset() returns trigger
language plpgsql as $$
begin
  perform bump_school_menu_version(array(
    select distinct ma.school_id
      from dish d
      join menu_item mi       on mi.dish_id = d.id
      join menu_assignment ma on ma.menu_id = mi.menu_id and ma.revoked_at is null
     where d.image_asset_id = new.id
  ));
  return null;
end;
$$;

create trigger bump_smv_from_asset
  after update on asset
  for each row execute function trg_bump_smv_from_asset();

-- -----------------------------------------------------------------------------
-- 15. Config change log (§9.4)
--
-- Written by trigger on all three config tables so it cannot be bypassed by a direct
-- update. UPDATE only: the initial insert of a config row is the row's creation, not
-- a change to a setting, and platform_config is seeded by this migration.
-- -----------------------------------------------------------------------------

create function trg_log_config_change() returns trigger
language plpgsql as $$
declare
  v_old        jsonb := to_jsonb(old);
  v_new        jsonb := to_jsonb(new);
  v_scope_type scope_type;
  v_scope_id   uuid;
  v_key        text;
  v_skip       text[] := array['id', 'kitchen_id', 'school_id', 'updated_at', 'updated_by_user_id'];
begin
  if tg_table_name = 'platform_config' then
    v_scope_type := 'platform';
    v_scope_id   := null;
  elsif tg_table_name = 'kitchen_config' then
    v_scope_type := 'kitchen';
    v_scope_id   := (v_new ->> 'kitchen_id')::uuid;
  else
    v_scope_type := 'school';
    v_scope_id   := (v_new ->> 'school_id')::uuid;
  end if;

  for v_key in select jsonb_object_keys(v_new) loop
    if v_key = any (v_skip) then
      continue;
    end if;
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      insert into config_change_log (scope_type, scope_id, setting_key, old_value, new_value, changed_by_user_id)
      values (v_scope_type, v_scope_id, v_key, v_old -> v_key, v_new -> v_key, (v_new ->> 'updated_by_user_id')::uuid);
    end if;
  end loop;

  return null;
end;
$$;

create trigger log_config_change after update on platform_config for each row execute function trg_log_config_change();
create trigger log_config_change after update on kitchen_config  for each row execute function trg_log_config_change();
create trigger log_config_change after update on school_config   for each row execute function trg_log_config_change();

-- -----------------------------------------------------------------------------
-- 16. updated_at maintenance (§1.5) and append-only enforcement
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'city', 'app_user', 'asset', 'dish_category', 'allergen', 'reason_code',
    'kitchen', 'school', 'school_class', 'break_time', 'recipient', 'guardian_link',
    'dish', 'menu', 'menu_item', 'menu_assignment', 'menu_item_price_override',
    'menu_item_capacity', 'platform_config', 'kitchen_config', 'school_config',
    'order_group', 'order', 'order_line', 'payment', 'refund', 'ledger_account',
    'wallet_balance', 'invoice', 'invoice_sequence', 'payout', 'permission',
    'role_template', 'permission_grant', 'policy_document', 'policy_version',
    'consent_purpose', 'data_subject_request', 'retention_policy', 'device_token',
    'notification_preference', 'school_report'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t
    );
  end loop;
end;
$$;

-- §7.5, §8.4, §11.3, §11.5, §12.6 — history is the point on these tables.
-- Corrections are new rows: a reversing ledger transaction, a withdrawal consent
-- event, a compensating order_event.
do $$
declare
  t text;
  r text;
begin
  foreach t in array array[
    'order_event', 'ledger_transaction', 'ledger_entry',
    'consent_record', 'user_policy_acceptance', 'audit_log'
  ] loop
    execute format(
      'create trigger append_only before update or delete on public.%I for each row execute function public.forbid_update_delete()', t
    );
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke update, delete on public.%I from %I', t, r);
      end if;
    end loop;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 17. Seed data
--
-- Only the rows the schema itself depends on, and only where the model states them
-- exactly. Deliberately NOT seeded:
--   * allergen       — [DM-13]: the authoritative list is the distinct values in the
--                      source workbook, which Q08 produces. An allergen present in
--                      the data but missing from this table is an unwarned allergy.
--   * city, kitchen, school, dish, menu — real business data, loaded by E16.
--   * retention_policy — the day counts are a legal question (E20-01, E20-05).
--   * policy_document / consent_purpose rows — the wording shown to a user is
--     drafted in Q10/Q11 and confirmed by E20-01; seeding placeholder consent text
--     would create consent records pointing at wording nobody approved.
-- -----------------------------------------------------------------------------

-- §9.2 — the singleton. Every column takes its documented platform default except
-- price_is_tax_inclusive, which stays NULL until [DM-14] is answered.
insert into platform_config (id) values (1);

-- §3.4 — the codes named in the model. `category` and the two booleans are a first
-- cut inferred from what each code means; they are admin-editable data, not schema.
insert into reason_code (code, category, display_name, requires_note, is_customer_visible) values
  ('dish_unavailable',          'cancellation', 'Dish unavailable',            false, true),
  ('customer_cancelled',        'cancellation', 'Cancelled by customer',       false, true),
  ('school_holiday',            'cancellation', 'School holiday',              false, true),
  ('kitchen_closed',            'cancellation', 'Kitchen closed',              false, true),
  ('payment_failed',            'cancellation', 'Payment failed',              false, true),
  ('duplicate_payment',         'refund',       'Duplicate payment',           false, true),
  ('goodwill',                  'refund',       'Goodwill',                    true,  true),
  ('migration_opening_balance', 'ledger',       'Migration opening balance',   true,  false);

-- §10.1 — the permission set. E02-07 names the first seven; the rest are the ones
-- the other epics require.
--
-- The split that matters most: orders.mark_delivered is its own permission, so the
-- day delivery is handed to a third party (E18-14) they get a grant with that
-- permission and nothing else — no refunds, no financials, no PII beyond what the
-- handover needs. That is E09-09, and it is free because it was designed in rather
-- than migrated to.
insert into permission (code, category, display_name, description, is_sensitive, valid_scope_types) values
  ('orders.view',            'orders',   'View orders',             'See orders within the granted scope, without customer or recipient names.',                    false, '{platform,city,kitchen,school}'),
  ('orders.view_pii',        'orders',   'View order names',        'See recipient names, class and section on orders. Split out so a future analyst grant can see orders without children''s names (E20-09).', true,  '{platform,kitchen,school}'),
  ('orders.mark_delivered',  'orders',   'Mark delivered',          'Mark orders delivered, individually or in bulk per class.',                                    false, '{platform,city,kitchen,school}'),
  ('orders.cancel',          'orders',   'Cancel orders',           'Cancel an order. Does NOT include issuing a refund.',                                          true,  '{platform,kitchen}'),
  ('orders.refund',          'orders',   'Refund orders',           'Issue a refund, in full or per line. Deliberately separate from marking delivered (E09-09).',   true,  '{platform,kitchen}'),
  ('orders.view_financials', 'orders',   'View order money',        'See amounts, taxes, payments and refunds on orders.',                                          true,  '{platform,city,kitchen,school}'),
  ('orders.create_on_behalf','orders',   'Order on behalf',         'Place an order for a customer, for support.',                                                  true,  '{platform}'),
  ('menu.view',              'menu',     'View menus',              'See menus and their items.',                                                                   false, '{platform,kitchen}'),
  ('menu.edit',              'menu',     'Edit menus',              'Create and change draft menus and their items and prices.',                                    false, '{platform,kitchen}'),
  ('menu.publish',           'menu',     'Publish menus',           'Make a menu live. Separated from drafting on purpose.',                                        true,  '{platform,kitchen}'),
  ('menu.import',            'menu',     'Import menus',            'Run the spreadsheet importer.',                                                                true,  '{platform,kitchen}'),
  ('dish.edit',              'menu',     'Edit dishes',             'Create and change dishes, including allergens and nutrition.',                                 false, '{platform,kitchen}'),
  ('school.view',            'schools',  'View schools',            'See school records.',                                                                          false, '{platform,city,school}'),
  ('school.onboard',         'schools',  'Onboard schools',         'Create a school and make it visible in the app''s school picker.',                             true,  '{platform}'),
  ('school.edit',            'schools',  'Edit schools',            'Change school details, classes and break times.',                                              false, '{platform,city,school}'),
  ('school.config_edit',     'schools',  'Edit school config',      'Change a school''s configuration, including revenue share. Admin only per M4, so never granted at school scope.', true, '{platform}'),
  ('kitchen.view',           'schools',  'View kitchens',           'See kitchen records.',                                                                         false, '{platform,kitchen}'),
  ('kitchen.edit',           'schools',  'Edit kitchens',           'Change kitchen details.',                                                                      false, '{platform,kitchen}'),
  ('kitchen.config_edit',    'schools',  'Edit kitchen config',     'Change a kitchen''s configuration overrides.',                                                 true,  '{platform}'),
  ('reports.view',           'schools',  'View reports',            'See operational and aggregate reports.',                                                       false, '{platform,city,kitchen,school}'),
  ('reports.financial_view', 'money',    'View financial reports',  'See revenue, tax and settlement reporting.',                                                   true,  '{platform,city}'),
  ('users.view',             'users',    'View users',              'See customer accounts.',                                                                       true,  '{platform}'),
  ('users.manage',           'users',    'Manage users',            'Disable and re-enable an account.',                                                            true,  '{platform}'),
  ('users.impersonate',      'users',    'View as user',            'Act as a customer for support. Always audited, never silent (E10-13).',                        true,  '{platform}'),
  ('grants.manage',          'platform', 'Manage access',           'Grant and revoke permissions. Held by platform admins only.',                                  true,  '{platform}'),
  ('payouts.view',           'money',    'View payouts',            'See computed and settled payouts.',                                                            true,  '{platform,school}'),
  ('payouts.manage',         'money',    'Manage payouts',          'Confirm a payout and mark it paid (E07-10).',                                                  true,  '{platform}'),
  ('invoices.view',          'money',    'View invoices',           'See issued tax invoices and credit notes.',                                                    true,  '{platform}'),
  ('config.platform_edit',   'platform', 'Edit platform config',    'Change platform defaults, including tax rates.',                                               true,  '{platform}'),
  ('audit.view',             'platform', 'View audit log',          'Read the audit trail.',                                                                        true,  '{platform}'),
  ('consent.view',           'platform', 'View consent records',    'Evidence consent to a regulator (E20).',                                                       true,  '{platform}');

-- §10.3 — D11. Templates are BUNDLES that expand into grants at assignment time.
-- Editing a template later does not retroactively change anyone's access.
insert into role_template (code, display_name, description, default_scope_type) values
  ('platform_admin',   'Platform admin',   'Everything. Held by GrayBag staff.',                                     'platform'),
  ('kitchen_operator', 'Kitchen operator', 'Runs a kitchen: sees and prepares orders, edits menus. No money.',        'kitchen'),
  ('school_viewer',    'School viewer',    'A school''s own contact: aggregate reports and payouts only, no names.',  'school'),
  ('delivery_agent',   'Delivery agent',   'Hands food over and marks it delivered. Defined now, granted to nobody in v1 (E18-14).', 'school');
-- delivery_agent's default_scope_type is `school`, which the model does not state.
-- It is only the scope the admin UI pre-selects when assigning the template, and it
-- is per-assignment editable — a third-party delivery contract will be per school.

-- platform_admin gets everything, expressed as a select over `permission` rather
-- than 31 literal rows. Note this is a one-time expansion: a migration that adds a
-- new permission must also insert the matching platform_admin row, and D11 means it
-- must additionally grant it to existing admins if they are meant to have it —
-- editing a template never changes anyone's existing access.
insert into role_template_permission (role_code, permission_code)
select 'platform_admin', code from permission;

-- Explicitly NOT orders.refund and NOT orders.view_financials — that is the whole
-- point of D3.
insert into role_template_permission (role_code, permission_code) values
  ('kitchen_operator', 'orders.view'),
  ('kitchen_operator', 'orders.view_pii'),
  ('kitchen_operator', 'orders.mark_delivered'),
  ('kitchen_operator', 'orders.cancel'),
  ('kitchen_operator', 'menu.view'),
  ('kitchen_operator', 'menu.edit'),
  ('kitchen_operator', 'dish.edit'),
  ('kitchen_operator', 'reports.view');

-- Aggregates only (E11-03, E20-09): none of tier S, P or A.
insert into role_template_permission (role_code, permission_code) values
  ('school_viewer', 'reports.view'),
  ('school_viewer', 'school.view'),
  ('school_viewer', 'payouts.view');

insert into role_template_permission (role_code, permission_code) values
  ('delivery_agent', 'orders.view'),
  ('delivery_agent', 'orders.view_pii'),
  ('delivery_agent', 'orders.mark_delivered');

-- -----------------------------------------------------------------------------
-- 18. Row Level Security (§13.7)
--
-- RLS is enabled on every table in `public` with NO POLICIES, which is default deny
-- (D8, CLAUDE.md non-negotiable #2). The policies themselves are 0002 (Q03/Q04), and
-- the pgTAP suite that asserts every allow AND EVERY DENY is E02-09.
--
-- Enabling it here rather than in 0002 means that if 0002 is ever missing, delayed
-- or partially applied, the failure mode is "nobody can read anything", not "anyone
-- can read everything". In the legacy app `Order` was readable and searchable by any
-- visitor, and ten types including `Child` had no rules at all. There is no
-- world-readable table in this schema, and `anon` gets nothing.
-- -----------------------------------------------------------------------------

do $$
declare
  t record;
begin
  for t in select schemaname, tablename from pg_tables where schemaname in ('public', 'migration') loop
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
  end loop;
end;
$$;

-- The migration schema is for the migration tooling and for humans resolving
-- conflicts. No app role reaches it at all.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema migration from %I', r);
      execute format('revoke usage on schema migration from %I', r);
    end if;
  end loop;
end;
$$;

-- The permission helper is SECURITY DEFINER, so its execute privilege is part of the
-- security boundary: PUBLIC must not hold it.
revoke all on function auth_has_permission(uuid, text, scope_type, uuid) from public;
do $$
declare
  r text;
begin
  foreach r in array array['authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant execute on function auth_has_permission(uuid, text, scope_type, uuid) to %I', r);
    end if;
  end loop;
end;
$$;

-- =============================================================================
-- End of 0001_initial_schema.sql
--
-- Next: 0002_rls_policies.sql (Q03/Q04) and supabase/tests/authorization.test.sql.
-- Until 0002 is applied, every table in this schema denies every application role,
-- which is the intended resting state.
-- =============================================================================
