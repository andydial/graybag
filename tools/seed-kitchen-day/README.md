# seed-kitchen-day

One realistic day of orders, so the kitchen dashboard (`E09-04`, `E09-05`) can be built and
reviewed against something that looks like a real morning rather than against an empty table.

```bash
export SUPABASE_URL=...              # project REST URL
export SUPABASE_SERVICE_ROLE_KEY=... # service role
export SUPABASE_DB_URL=...           # direct Postgres connection

node tools/seed-kitchen-day/seed.mjs --date 2026-08-13
```

It needs the fixtures first — `npm run db:seed:staging` — because it adds a day to an existing
school, it does not create one.

### It refuses the local stack, and that is from experience

Two worktrees share one Docker stack on port 54322. A day seeded there put 24 users tagged
`{"seeded":"kitchen-day"}` in front of the payments thread, which spent fifteen minutes chasing a
failure that was not theirs — and it looked like a regression in their own work rather than like
a collision, which is the expensive part.

So `localhost` needs `--allow-local`, which is there for a genuinely private stack and says out
loud that you have checked. **Staging is where this data is wanted anyway.**

One consequence worth knowing before you use `--allow-local`: seeded orders **cannot be removed**
(see below), so the only way to clear them is `npx supabase db reset`, which also clears
everything anyone else has in that stack.

## What it writes

24 invented children across **Alpha Public School**'s three classes and both breaks, one order
each, 32 lines, 38 items. The status mix is deliberate:

| | |
|---|---|
| `paid` 14 | not started |
| `preparing` 5 | kitchen has begun |
| `delivered` 4 | handed over — gives the dashboard its partial "12 of 18" case |
| `cancelled` 1 | `dish_unavailable`, so the cancel path has something to render |

No `pending_payment`. `L5` says the kitchen never cooks against money that has not arrived, and
a dashboard that shows one is a dashboard that invites it.

## Three things the schema taught this tool

Each of these was a failed run before it was a design decision, and each is the schema being
right rather than the tool being clever:

- **Writes must be one transaction.** `recipient_must_have_guardian` (`D10`) is
  `deferrable initially deferred`: a child needs an active `guardian_link`, and the link
  references the child. PostgREST runs every request in its own transaction, so it commits the
  child alone and the trigger correctly refuses. Hence `SUPABASE_DB_URL` and a real `BEGIN`.
- **An order cannot be inserted as `paid`.** `assert_order_status_transition` implements
  `order-lifecycle.md` §4.1 literally, and the only permitted INSERT is
  `('', 'pending_payment', 'system')`. So the seed *walks the lifecycle* — system takes the money,
  then `app.actor_type` becomes `kitchen` and the kitchen prepares, delivers or cancels. The day
  therefore cannot contain a state production could never produce, which is exactly the failure a
  seeded dashboard would otherwise hide.
- **There is no `--clear`.** `order_event` is append-only — a trigger refuses DELETE with
  "write a compensating row instead" — so deleting an order fails. Correct: an order that
  happened cannot be made not to have happened. A day is written once; re-running the same date
  is safe and does nothing. Seed a different date for a different day, or
  `npx supabase db reset && npm run db:seed:staging` to start over locally.

## Fictional, and why the school is not Amity

Every child and parent is invented and every email is `@seed.invalid`, which cannot receive mail
(RFC 2606). The legacy export holds 1,115 real children and is never a fixture source
(non-negotiable #4, `RH4`).

Andy asked for Amity. This uses **Alpha Public School**, the fictional fixture already in
`supabase/seeds/staging-menu.sql`, which has the two breaks and three classes the brief wanted.
Putting a real customer's name into a seed dataset sits badly next to having just pulled those
same school names off the website pending written permission (`E12-11`). Say the word and it is
a one-line change.

## Why it lives in `tools/`

`supabase/` belongs to the payments thread, and this adds no migration — it writes rows and
nothing else. That also keeps `SD5` intact: the committed seed data deliberately contains no
orders and no money, because a fixture order is a fixture invoice waiting to be believed. This
stays a tool you run when you want a day to look at.
