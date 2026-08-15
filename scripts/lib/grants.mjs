// Deciding what a grant change would do — `E02-34`.
//
// Pure functions over plain objects, for the same reason `launch-checks.mjs` is:
// `scripts/grant-operator.mjs` fetches and writes, this file decides. Authorization is the one
// area where "I ran it and it looked right" is not evidence, because the failure mode is someone
// holding something nobody meant them to hold, and nothing on any screen says so.

/**
 * Accounts this tooling refuses to grant to, whatever is asked.
 *
 * `anuragdial+parent@gmail.com` is the customer persona. It exists to prove parent RLS actually
 * restricts, and `authorization.test.sql` asserts it holds zero grants. Give it a back-office
 * permission and it answers "can a parent see this?" with a yes that means nothing — while the
 * suite that would have caught the regression starts passing for the wrong reason at the same
 * moment. Two safety nets, one edit, both gone.
 *
 * Matched on the `+parent` tag rather than the full address so the rail survives the account being
 * recreated on a different inbox, which `docs/environments.md` explicitly tells people to do.
 */
export const PROTECTED_ACCOUNT = /\+parent@/i;

export const isProtectedAccount = (email) => PROTECTED_ACCOUNT.test(String(email ?? ''));

/**
 * What `--grant` / `--revoke` would actually change.
 *
 * @param {{code: string, scopes: string[], sensitive: boolean}[]} permissions  what was asked for
 * @param {Set<string>} held  permission codes already held at platform scope, live
 * @param {'grant'|'revoke'} mode
 * @returns {{changes: object[], noop: object[], skipped: object[]}}
 *
 * `skipped` is permissions that cannot be held at platform scope at all. They are reported rather
 * than quietly granted at some narrower scope: choosing a scope on someone's behalf is how an
 * account ends up with reach nobody decided to give it, and the log would read as success.
 */
export function planGrants(permissions, held, mode) {
  const skipped = permissions.filter((p) => !p.scopes.includes('platform'));
  const actionable = permissions.filter((p) => p.scopes.includes('platform'));
  const wants = (p) => (mode === 'revoke' ? held.has(p.code) : !held.has(p.code));
  return {
    changes: actionable.filter(wants),
    noop: actionable.filter((p) => !wants(p)),
    skipped,
  };
}
