-- Rollback for 0051.
--
-- Deliberately NOT reinstating the unqualified DELETE: rolling back to a function that raises
-- `21000` on every settlement through PostgREST would be rolling forward into the incident. The
-- previous body is in `0038` if it is ever genuinely needed.
--
-- There is nothing to undo. `0051` changes one statement inside a `create or replace`, and the
-- corrected form is valid everywhere the old one was.
select 1;
