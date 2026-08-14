-- Rollback for 0055.
--
-- Dropping the function removes the gate: every build is admitted, which is the state the system
-- was in before it. That is safe in the "nobody is locked out" direction and unsafe in the
-- "a 3.7.0 build keeps talking to a 4.0.0 schema" direction — so if this is rolled back during a
-- mandatory-update window, the window is not being enforced and somebody needs to know.
--
-- **The columns are kept.** `min_supported_app_version` is operational data that Andy may have
-- raised by hand; dropping it discards the floor itself rather than the mechanism, and re-applying
-- the migration would silently reset it to `0.0.0` — a floor of "none" that looks deliberate.
drop function if exists app_version_support(text);

notify pgrst, 'reload schema';
