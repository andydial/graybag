# Decisions — The privilege baseline

`PB1`–`PB5` · part of the decision log. Index: `docs/decisions.md`. Superseded entries and build-log history: `docs/decisions-archive.md` (never authoritative).

**Decision IDs are permanent and never move between files.** If you change a decision here, change it in the same PR as the code — never silently diverge.

`0005_explicit_table_privileges.sql`, closing `E02-25` and the implementation half of `E02-21`.
Supabase's default privileges exist on a hosted project and not on the local CLI stack, so
`0001` and `0002` were revoking from a baseline they never established. Detail in the archive.

| # | Decision | Why |
|---|---|---|
| PB1 | **The GRANT is written down in a migration rather than inherited from the platform** | The suite could not mean the same thing in CI and in production, so a green run in CI was not evidence about what ships. That is the same class of false confidence as `E02-24`'s `Tests: 0`, one layer down: not a test that did not run, but a test that ran against a different security model. A privilege model half of which lives in a vendor default is not reviewable, not diffable, and not testable |
| PB2 | **Grant broadly, then re-apply `0001`'s and `0002`'s revokes, rather than granting a computed positive list** | The positive list is "every table except these 37, and except UPDATE/DELETE on these 6" — a second copy of a list `0002` already owns and that the suite asserts against. Two copies drift, and the drift direction is *opening writes*. Both copied lists were verified identical to their originals before merge (37 class-3, 6 append-only) |
| PB3 | **`service_role` gets the baseline and no revokes at all** | It is the only writer of every class-3 table, so revoking there would break the plane the model routes all writes through. On the six append-only tables it deliberately keeps UPDATE and DELETE **privileges**, because §9 item 14 requires the *trigger* to be what refuses them. The distinction is not cosmetic: the suite caught `42501 permission denied` where it wanted `23001`, i.e. append-only enforcement appearing to work for the wrong reason. A trigger states immutability once for every caller; a revoke exempts anyone who acquires the privilege by another route |
| PB4 | **`anon` is granted nothing and the revoke is re-asserted anyway** | The grants name `authenticated` and `service_role` only, so anon is untouched by construction — but "untouched by construction" is an argument, and `[AZ-03]` is not a thing to hold by argument. The statement is free |
| PB5 | **Default privileges are set too, so later migrations inherit the baseline** | Without it, migration `0006` creates a table nobody can read, and that surfaces as an empty screen rather than an error — the worst way to find out |

**The rollback is asymmetric and says so.** `0005`'s down migration leaves an app that cannot
read and a backend that cannot write, and `0001`/`0002`'s revokes are deliberately not undone:
rolling back a baseline must never re-open a class-3 write.
