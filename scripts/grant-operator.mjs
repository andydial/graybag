#!/usr/bin/env node
/**
 * Grant and revoke back-office permissions from the command line — `E02-34`.
 *
 *     node scripts/grant-operator.mjs --list
 *     node scripts/grant-operator.mjs --email andy@example.com --all
 *     node scripts/grant-operator.mjs --email andy@example.com --all --apply
 *     node scripts/grant-operator.mjs --email cook@example.com --grant orders.view,orders.mark_delivered --apply
 *     node scripts/grant-operator.mjs --email cook@example.com --revoke orders.refund --reason 'left the team' --apply
 *
 * ## Why a script and not a migration
 *
 * Grants are **data about people**, not schema. Production and staging have different `auth.users`
 * rows, so a migration hard-coding a uuid would either fail or — far worse — succeed against a
 * different human on the other environment. `D3` already says the grant *is* the truth; that truth
 * is per-environment, so it is applied per-environment, deliberately and visibly.
 *
 * ## Dry run first, always
 *
 * Same shape as `tools/bulk-import`: the default prints the plan and changes nothing, and `--apply`
 * is a separate word you have to type. Authorization is the one area of this system where a typo
 * is not self-correcting.
 *
 * ## The customer persona is protected
 *
 * `docs/environments.md` and `authorization.test.sql` both depend on `anuragdial+parent@gmail.com`
 * holding **zero** grants: it is the account that proves parent RLS actually restricts, and the
 * moment it holds a back-office permission it starts returning rows for the wrong reason and the
 * test suite starts passing for the wrong reason too. This script refuses to grant to it. The
 * refusal is not overridable by a flag, because the only reason anyone would reach for the flag is
 * the misunderstanding the rail exists to catch.
 */
import { spawnSync } from 'node:child_process';

import { isProtectedAccount, planGrants } from './lib/grants.mjs';

// ---------------------------------------------------------------------------------------- args

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : (argv[i + 1] ?? null);
};

const OPTS = {
  email: value('--email'),
  all: flag('--all'),
  grant: value('--grant'),
  revoke: value('--revoke'),
  reason: value('--reason'),
  list: flag('--list'),
  apply: flag('--apply'),
};

// ------------------------------------------------------------------------------------ database

/**
 * `DB_URL` wins. Otherwise build the pooler URI from the same `prod.env` variables everything
 * else in this repo reads, so there is one place credentials live.
 */
function dbUrl() {
  if (process.env.DB_URL) return process.env.DB_URL;
  const ref = process.env.SUPABASE_PROD_REF;
  const pass = process.env.SUPABASE_PROD_DB_PASSWORD;
  if (!ref || !pass) {
    die(
      'No database connection.\n' +
        '  set -a; . ~/.graybag-secrets/prod.env; set +a\n' +
        'or set DB_URL to a full postgresql:// URI (staging, or a local database).',
    );
  }
  const region = process.env.SUPABASE_DB_REGION ?? 'ap-south-1';
  return `postgresql://postgres.${ref}:${encodeURIComponent(pass)}@aws-0-${region}.pooler.supabase.com:5432/postgres`;
}

function die(message) {
  console.error(message);
  process.exit(1);
}

/** Run one statement and return rows as arrays of column strings. */
function sql(query) {
  const out = spawnSync('psql', [dbUrl(), '-X', '-q', '-A', '-t', '-F', '', '-c', query], {
    encoding: 'utf8',
  });
  if (out.error) die(`Could not run psql: ${out.error.message}`);
  if (out.status !== 0) die(`psql failed:\n${out.stderr || out.stdout}`);
  return out.stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => line.split(''));
}

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ----------------------------------------------------------------------------------- reporting

/** Every account that holds anything, and what it holds. This is `--list`. */
function list() {
  const rows = sql(`
    select u.email,
           g.permission_code,
           g.scope_type::text,
           coalesce(g.scope_id::text, ''),
           to_char(g.granted_at, 'YYYY-MM-DD'),
           coalesce(b.email, '?')
      from permission_grant g
      join app_user u on u.id = g.user_id
      left join app_user b on b.id = g.granted_by_user_id
     where g.revoked_at is null
       and (g.expires_at is null or g.expires_at > now())
     order by u.email, g.permission_code`);

  if (rows.length === 0) {
    console.log('No live grants on this database. Nobody can reach the back office.');
    return;
  }

  const byUser = new Map();
  for (const [email, code, scopeType, scopeId, granted, by] of rows) {
    if (!byUser.has(email)) byUser.set(email, []);
    byUser.get(email).push({ code, scopeType, scopeId, granted, by });
  }

  for (const [email, held] of byUser) {
    console.log(`\n${email} — ${held.length} permission${held.length === 1 ? '' : 's'}`);
    for (const h of held) {
      const scope = h.scopeId ? `${h.scopeType}:${h.scopeId}` : h.scopeType;
      console.log(`  ${h.code.padEnd(28)} ${scope.padEnd(10)} granted ${h.granted} by ${h.by}`);
    }
  }
  console.log('');
}

// -------------------------------------------------------------------------------------- grants

function resolveUser(email) {
  const rows = sql(`select id from app_user where lower(email) = lower(${quote(email)}) and deleted_at is null`);
  if (rows.length === 0) {
    die(
      `No app_user with email ${email} on this database.\n` +
        'They have to sign in once before they can be granted anything — the row is created on ' +
        'first sign-in (`0018`). Ask them to sign in, then run this again.',
    );
  }
  return rows[0][0];
}

/**
 * Which permissions to act on, and at what scope.
 *
 * Platform scope where the permission allows it, which on the current catalogue is all of them.
 * A permission that did not allow platform would be reported and skipped rather than silently
 * granted at some other scope — picking a scope on someone's behalf is how people end up holding
 * more than anyone intended.
 */
function wanted() {
  const all = sql(
    `select code, valid_scope_types::text, is_sensitive::text from permission where is_active order by code`,
  ).map(([code, scopes, sensitive]) => ({
    code,
    scopes: scopes.replace(/[{}]/g, '').split(',').filter(Boolean),
    sensitive: sensitive === 't',
  }));

  if (OPTS.all) return all;

  const asked = (OPTS.grant ?? OPTS.revoke ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (asked.length === 0) die('Nothing to do. Pass --all, or --grant a,b, or --revoke a,b.');

  const known = new Map(all.map((p) => [p.code, p]));
  const unknown = asked.filter((c) => !known.has(c));
  if (unknown.length > 0) {
    die(
      `Not a permission on this database: ${unknown.join(', ')}\n` +
        `Run --list-permissions to see the ${all.length} that exist.`,
    );
  }
  return asked.map((c) => known.get(c));
}

function main() {
  if (OPTS.list) return list();

  if (flag('--list-permissions')) {
    const rows = sql(
      `select code, category, valid_scope_types::text, is_sensitive::text from permission where is_active order by category, code`,
    );
    for (const [code, category, scopes, sensitive] of rows) {
      console.log(`${code.padEnd(28)} ${category.padEnd(14)} ${scopes.replace(/[{}]/g, '')}${sensitive === 't' ? '  (sensitive)' : ''}`);
    }
    console.log(`\n${rows.length} active permissions.`);
    return;
  }

  if (!OPTS.email) die('Which account? Pass --email someone@example.com (or --list to see who holds what).');

  if (isProtectedAccount(OPTS.email)) {
    die(
      `Refusing to touch ${OPTS.email}.\n\n` +
        'That address is the customer persona. It exists to prove that parent RLS actually\n' +
        'restricts, and `authorization.test.sql` fails if it acquires a grant. An account that\n' +
        'holds a back-office permission answers "can a parent see this?" with a yes that means\n' +
        'nothing — and the suite would start passing for the wrong reason at the same moment.\n\n' +
        'If you want a privileged account, use a different address.',
    );
  }

  const userId = resolveUser(OPTS.email);
  const permissions = wanted();
  const revoking = Boolean(OPTS.revoke);

  // What is already held, so the plan reports "already" rather than pretending to act.
  const held = new Set(
    sql(
      `select permission_code from permission_grant
        where user_id = ${quote(userId)}::uuid and scope_type = 'platform'
          and revoked_at is null and (expires_at is null or expires_at > now())`,
    ).map((r) => r[0]),
  );

  const { changes, noop, skipped } = planGrants(permissions, held, revoking ? 'revoke' : 'grant');
  const actionable = permissions.filter((p) => p.scopes.includes('platform'));

  console.log(`${OPTS.email} — ${userId}`);
  console.log(`${held.size} platform permission${held.size === 1 ? '' : 's'} held right now.\n`);

  if (skipped.length > 0) {
    console.log(`Cannot be held at platform scope, so left alone: ${skipped.map((p) => p.code).join(', ')}\n`);
  }

  if (changes.length === 0) {
    console.log(`Nothing to change — all ${actionable.length} already in the state you asked for.`);
    return;
  }

  console.log(`${revoking ? 'REVOKE' : 'GRANT'} ${changes.length} at platform scope:`);
  for (const p of changes) console.log(`  ${p.code}${p.sensitive ? '  (sensitive)' : ''}`);
  if (noop.length > 0) console.log(`\nAlready ${revoking ? 'absent' : 'held'}, untouched: ${noop.length}`);

  if (!OPTS.apply) {
    console.log('\nDry run. Nothing was written. Add --apply to do it.');
    return;
  }

  const codes = changes.map((p) => quote(p.code)).join(',');
  if (revoking) {
    sql(`
      update permission_grant
         set revoked_at = now(),
             revoked_by_user_id = ${quote(userId)}::uuid,
             revoke_reason = ${quote(OPTS.reason ?? 'revoked via scripts/grant-operator.mjs')},
             updated_at = now()
       where user_id = ${quote(userId)}::uuid
         and scope_type = 'platform'
         and permission_code in (${codes})
         and revoked_at is null`);
  } else {
    // `granted_by_user_id` is the same account when the platform owner bootstraps themselves.
    // That is the honest record — there was nobody else to authorise it — and it is visible in
    // `--list` rather than disguised as having come from somewhere.
    sql(`
      insert into permission_grant (user_id, permission_code, scope_type, scope_id, granted_by_user_id)
      select ${quote(userId)}::uuid, code, 'platform', null, ${quote(userId)}::uuid
        from permission
       where code in (${codes})
      on conflict do nothing`);
  }

  const now = sql(
    `select count(*) from permission_grant
      where user_id = ${quote(userId)}::uuid and revoked_at is null
        and (expires_at is null or expires_at > now())`,
  )[0][0];
  console.log(`\nDone. ${OPTS.email} now holds ${now} live grant${now === '1' ? '' : 's'}.`);
}

main();
