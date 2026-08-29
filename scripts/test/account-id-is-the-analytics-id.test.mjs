/**
 * `/admin/people` shows an account id so it can be pasted into PostHog — `E10-73`.
 *
 * Andy: *"PostHog identifies people by user id and deliberately never receives an email. That id
 * is the join between 'a parent emailed me' and 'here's what they actually did'."*
 *
 * That join rests on one fact which is true today and is nowhere asserted: **`app_user.id` and
 * `auth.users.id` are the same value.** `0001` declares `app_user.id` as a primary key that
 * *references* `auth.users(id)`, and `0018` inserts `new.id` from the auth trigger — so they are
 * equal by construction rather than by convention. The mobile app identifies to PostHog with the
 * id from `auth.getUser()`.
 *
 * ## Why this is a test and not a comment
 *
 * If `app_user` ever grows its own uuid with an `auth_user_id` beside it — an ordinary, sensible
 * refactor — the screen keeps rendering an id, the copy button keeps working, and the value
 * silently stops matching anything in PostHog. Nothing fails. Andy pastes it, finds no events,
 * and concludes analytics is broken rather than that the id is the wrong one.
 *
 * That is the same shape as `E10-06`'s invented permission codes and the `user.view` bug: a
 * change that is correct in itself, breaking something at a distance, in the direction nobody
 * investigates. So the coupling is written down where a change to it fails.
 *
 * This reads the migrations rather than a database, so it runs in CI with no stack up — the same
 * choice `check-migrations` makes and for the same reason.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'supabase/migrations');

const sql = (predicate) =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql') && predicate(f))
    .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
    .join('\n');

test('app_user.id IS the auth id — the value PostHog receives as distinct_id', () => {
  const initial = readFileSync(join(MIGRATIONS, '0001_initial_schema.sql'), 'utf8');
  const table = initial.slice(initial.indexOf('create table app_user'));
  const body = table.slice(0, table.indexOf(');'));

  assert.match(
    body,
    /id\s+uuid\s+primary key\s+references\s+auth\.users\(id\)/,
    'app_user.id must be a primary key referencing auth.users(id). If it has become its own ' +
      'uuid with an auth_user_id beside it, the id on /admin/people no longer joins to PostHog ' +
      'and nothing on that screen will say so — see E10-73.',
  );
});

test('no later migration gives app_user a separate identity column', () => {
  // The FK above can be left intact while a *new* column quietly becomes the real identity.
  const later = sql((f) => !f.startsWith('0001'));
  const suspicious = /alter table\s+app_user\s+add column\s+(auth_user_id|auth_id|user_uuid)\b/i;

  assert.ok(
    !suspicious.test(later),
    'A migration adds a second identity column to app_user. That is a reasonable change and it ' +
      'silently breaks the PostHog join on /admin/people: the screen would keep showing an id ' +
      'that matches nothing. Update the screen and this test together — E10-73.',
  );
});

test('the screen shows the id that identify() is called with, not some other one', () => {
  // The mobile app identifies with `session.userId`, which `auth.ts` fills from `auth.getUser()`.
  // Read as source rather than asserted at runtime: this is a coupling between two files, and the
  // failure it guards is that somebody changes one of them.
  const auth = readFileSync(join(ROOT, 'packages/shared/src/api/auth.ts'), 'utf8');
  assert.match(
    auth,
    /userId:\s*user\.id/,
    'auth.ts must derive userId from the auth user id. /admin/people shows app_user.id on the ' +
      'strength of those being the same value — E10-73.',
  );

  const session = readFileSync(join(ROOT, 'apps/mobile/src/session/SessionContext.tsx'), 'utf8');
  assert.match(
    session,
    /identifyParent\(session\.userId\)/,
    'PostHog must be identified with session.userId. If it is identified with anything else, the ' +
      'id on /admin/people is not the one to paste — E10-73.',
  );
});
