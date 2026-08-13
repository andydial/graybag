-- =============================================================================
-- 0032_self_notice_v2_retention.sql — `self_data_notice` version 2. `E20-48`, `C18`, `C19`.
-- =============================================================================
--
-- **Version 1 promises something we cannot keep.** Its "How long" section says *"Order history
-- is kept for 24 months"*, while the privacy policy holds invoices, ledger entries **and order
-- history** to a statutory floor that is certainly longer. A promise to delete order history at
-- 24 months cannot survive a statutory floor on the invoices that reference it — the rows are
-- the same rows.
--
-- Of the two published statements the 24-month figure is the wrong one, and `C18` says why the
-- fix is not simply a better number: a period is stated **once**, in the document that publishes
-- it, and everything else defers. Version 2 defers.
--
-- =============================================================================
-- WHY TODAY, AND WHY THIS IS THE CHEAPEST IT WILL EVER BE
-- =============================================================================
--
-- `requires_acceptance` is true, so publishing a version re-prompts **everyone who accepted the
-- previous one**. Today that is nobody: no user has accepted anything, because nobody has
-- registered yet.
--
-- Once ~150 Amity parents register, the same correction becomes a second consent interruption
-- during onboarding — which is precisely the cost `0022` was written to avoid when it published
-- the self notice alongside the child one from day one rather than adding it later. Andy ruled
-- it on 2026-08-11 for exactly that reason: the window in which this is free closes at launch.
--
-- =============================================================================
-- WHAT CHANGED, AND WHAT DELIBERATELY DID NOT
-- =============================================================================
--
-- **One paragraph.** The body below was generated from version 1's own `content_md` with the
-- retention paragraph replaced, and asserted to differ in nothing else before being written
-- here. §11.2 makes a published version immutable and `content_sha256` is what makes that
-- meaningful — so a "correction" that quietly reworded three other sentences would defeat the
-- point of versioning it at all.
--
-- `child_data_notice` is **untouched and needs no version 2**: it already states no period, only
-- *"we delete what we are not legally required to keep"*, which is the deferring form `C18`
-- asks for. Checked rather than assumed.
--
-- The hash is computed here rather than pasted, as `0015` and `0022` both do — a hand-copied
-- digest is a digest of whatever was in the clipboard.
-- =============================================================================

insert into policy_version (
  policy_code, version, effective_from, published_at, content_md, content_sha256,
  requires_acceptance, blocks_ordering, summary_of_changes
)
select 'self_data_notice', '2', now(), now(), v.body,
       encode(sha256(v.body::bytea), 'hex'),
       -- Re-prompts everyone who accepted version 1. That is nobody today, which is the whole
       -- reason this is being done now (see the header).
       true,
       -- Unchanged from version 1, and for the same reason: this notice is consented to when
       -- you add yourself as a recipient, and somebody who has not done that has nothing to
       -- order for. It is not a gate in front of the menu (`AR7`).
       false,
       'Retention no longer states a period. Version 1 said order history was kept for 24 '
       'months, which cannot be true of records the law requires us to keep for longer; the '
       'notice now defers to the privacy policy, which is the single place a period is stated.'
  from (select $md$
# How we use your details when you order for yourself

If you are ordering lunch for **yourself** — as a member of school staff, or as a college
student — this is what we hold and why.

## What we hold

Your name, the school or college you collect from, and the days you have ordered for. If you
choose to tell us about allergies, we hold those too, and only then.

## Why

To make the right meal and to get it to the right person at the right time. Your name appears
on the kitchen's list for the day you ordered, and nowhere else.

## Allergies are separate, and optional

Allergy information is health information, so we ask for it separately and you can use GrayBag
without giving it. If you do not, we cannot warn you when a dish contains something — we will
say so rather than leave you to assume.

## How long

We keep your order history, and the invoices that go with it, for as long as Indian tax and
company law requires us to. Those are financial records and we cannot delete them on request.

Allergy details are different, and are yours to withdraw: they are kept until you remove them or
delete your account, and are deleted immediately when you do.

The periods themselves are set out in our privacy policy, which is the one place we state them.

## Your rights

You can see, correct, export or delete everything we hold about you, from the app. Deleting
your account deletes your allergy details; invoices are kept because we are required to keep
them.

Questions or complaints: our grievance officer's contact details are in the app under Support.$md$ as body) v
where not exists (
  select 1 from policy_version pv
   where pv.policy_code = 'self_data_notice' and pv.version = '2'
);

-- Version 1 is left published and untouched. It is the wording somebody would have consented to
-- had anyone consented, and §11.2 makes it immutable — the record of what was published is not
-- edited because it turned out to be wrong. That is what a version is for.
