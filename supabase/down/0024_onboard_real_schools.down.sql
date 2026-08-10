-- Rollback for 0024. Puts the synthetic fixtures back and un-onboards the real schools.
--
-- Note that this is a *data* rollback, so it restores the state this migration found rather than
-- an empty one: the three real schools go back to invisible, and the three fixtures return.

update school set onboarded_at = null, updated_at = now()
 where id in ('77308e75-d8e9-47ba-a503-7c38d482a72c',
              '50994394-8557-4985-a76f-707d16a83c1a',
              '79752fe3-841f-45b6-a47b-1169ce70e648');

update school set is_active = true, updated_at = now()
 where id in ('50000000-0000-0000-0000-000000000001',
              '50000000-0000-0000-0000-000000000002',
              '50000000-0000-0000-0000-000000000003');

update menu set status = 'active'
 where id in ('e0000000-0000-0000-0000-000000000001',
              'e0000000-0000-0000-0000-000000000002',
              'e0000000-0000-0000-0000-000000000003');
