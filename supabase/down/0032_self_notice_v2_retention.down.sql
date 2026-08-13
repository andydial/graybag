-- Rollback for 0032 — withdraws `self_data_notice` version 2.
--
-- **Deletes rather than unpublishes**, because §11.2's trigger makes a published version
-- immutable: `update policy_version set published_at = null` is refused by
-- `trg_policy_version_immutable_once_published`, and the trigger is right to refuse it. A
-- version that was published and then quietly unpublished is a version whose `content_sha256`
-- proves nothing.
--
-- `on delete restrict` from `user_policy_acceptance` means this **fails if anyone has accepted
-- version 2**, and that failure is correct: an acceptance is evidence that a named person
-- agreed to a specific wording, and deleting the wording would leave the evidence pointing at
-- nothing. If that happens, the right response is a version 3 saying whatever version 1 said —
-- not the removal of a record.
--
-- Rolling back also reinstates the defect: version 1 promises to delete order history at 24
-- months, which cannot be true of records the law requires us to keep for longer (`C19`).
delete from policy_version
 where policy_code = 'self_data_notice' and version = '2';
