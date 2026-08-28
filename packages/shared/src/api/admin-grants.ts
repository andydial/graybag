/**
 * Who holds what back-office access — `E10-27`.
 *
 * Registration is identical for everyone; back-office reach is a `permission_grant` row and
 * nothing else (`D3`, `E02-07`). There is no role column anywhere, which is right, and it left
 * one gap: no screen could answer "who can do what?", so the answer lived in the database.
 *
 * Reads go through PostgREST under RLS — `grants.manage` for the grants and the catalogue,
 * `users.view` for the accounts. Writes go through the `admin-grants` Edge Function, because
 * `permission_grant` has **no write policy at all** and must not have one: a table that grants
 * access cannot be writable by the thing whose access it grants.
 */
import { ApiError, invokeFunction, runQuery } from './client.js';

export interface AccessAccount {
  userId: string;
  email: string;
  displayName: string;
  isDisabled: boolean;
  held: HeldGrant[];
}

export interface HeldGrant {
  grantId: string;
  permissionCode: string;
  displayName: string;
  category: string;
  isSensitive: boolean;
  scopeType: string;
  scopeId: string | null;
  grantedAt: string;
  grantedByEmail: string | null;
}

export interface PermissionInfo {
  code: string;
  category: string;
  displayName: string;
  description: string;
  isSensitive: boolean;
  validScopeTypes: string[];
}

export class AdminAccessError extends Error {
  constructor(detail: string) {
    super(`Access could not be read: ${detail}`);
    this.name = 'AdminAccessError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export const ACCESS_GRANT_COLUMNS =
  'id,user_id,permission_code,scope_type,scope_id,granted_at,' +
  'permission:permission_code(display_name,category,is_sensitive),' +
  'granted_by:granted_by_user_id(email)';

export const ACCESS_USER_COLUMNS = 'id,email,first_name,last_name,is_disabled,deleted_at';

export const PERMISSION_COLUMNS =
  'code,category,display_name,description,is_sensitive,valid_scope_types';

/** Every permission that can be granted, for the picker. */
export async function fetchPermissions(): Promise<PermissionInfo[]> {
  const rows = await runQuery<unknown>((t) =>
    t.from('permission').select(PERMISSION_COLUMNS).eq('is_active', true).order('category'),
  );
  return rows.filter(isRecord).map((r) => ({
    code: str(r.code) ?? '',
    category: str(r.category) ?? '',
    displayName: str(r.display_name) ?? '',
    description: str(r.description) ?? '',
    isSensitive: r.is_sensitive === true,
    validScopeTypes: Array.isArray(r.valid_scope_types) ? r.valid_scope_types.map(String) : [],
  }));
}

/**
 * Every account, with what it holds.
 *
 * **Accounts with no grants are included.** They are how somebody gets granted anything — a new
 * cook signs in once, which creates the row (`0018`), and then appears here to be given access. A
 * list of only privileged accounts would have no way to reach the person you are onboarding.
 */
/**
 * Find an account by email or name — `E10-46`.
 *
 * The onboarding path. A new cook signs in once, holds nothing, and has to be found so they can be
 * given a job; before this the screen listed **every** account so they would be in it somewhere,
 * which stops working the day parents outnumber staff a hundred to one.
 *
 * **Searched in the database, not the browser.** Fetching every account to filter it client-side
 * is the same unbounded read wearing a search box.
 *
 * `LIMIT` is deliberate and low: this answers "give me that person", not "browse the user table".
 * If a search returns twenty rows the query was too vague, and the answer is a better search term
 * rather than a longer list.
 */
export const ACCOUNT_SEARCH_LIMIT = 20;

export async function searchAccounts(query: string): Promise<AccessAccount[]> {
  const term = query.trim();
  // Two characters is the floor. One letter matches most of the table and is never what somebody
  // means; an empty box must return nothing rather than everybody.
  if (term.length < 2) return [];

  // `%` and `_` are wildcards in `ilike`. A parent whose email contains one would otherwise widen
  // the search rather than narrow it, and `\` is escaped first or it would escape our escapes.
  const safe = term.replace(/\\/g, '\\\\').replace(/[%_]/g, (c) => `\\${c}`);
  const pattern = `%${safe}%`;

  const rows = await runQuery<unknown>((t) =>
    t
      .from('app_user')
      .select(ACCESS_USER_COLUMNS)
      .or(`email.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern}`)
      .is('deleted_at', null)
      .order('email')
      .limit(ACCOUNT_SEARCH_LIMIT),
  );

  return rows.filter(isRecord).map((u) => {
    const first = str(u.first_name) ?? '';
    const last = str(u.last_name) ?? '';
    return {
      userId: str(u.id) ?? '',
      email: str(u.email) ?? '',
      displayName: `${first} ${last}`.trim(),
      isDisabled: u.is_disabled === true,
      // A search result carries no grants: this is the "who is this person" lookup, and the
      // screen re-reads their access from `fetchAccess` once they have some.
      held: [],
    };
  });
}

/**
 * Everyone who holds back-office access — `E10-46`.
 *
 * **Grants first, then the accounts they name.** This used to select every `app_user` row,
 * unbounded, so the screen could render a card each. That was fine at four accounts and wrong the
 * moment parents register: at 400 it fetches 400 rows to show three staff. Andy: *"how will this
 * list look like in 1 week where 400 people have registered?"*
 *
 * Now it returns exactly as many rows as there are people with access, whatever the size of the
 * user table. Reaching somebody who holds **nothing** — the onboarding case the old version was
 * right to care about — is `searchAccounts`, because searching is how you find one person among
 * hundreds, and listing everybody is not.
 */
export async function fetchAccess(): Promise<AccessAccount[]> {
  const grants = await runQuery<unknown>((t) =>
    t.from('permission_grant').select(ACCESS_GRANT_COLUMNS).is('revoked_at', null),
  );

  const byUser = new Map<string, HeldGrant[]>();
  for (const g of grants.filter(isRecord)) {
    const userId = str(g.user_id);
    if (!userId) continue;
    const permission = isRecord(g.permission) ? g.permission : {};
    const grantedBy = isRecord(g.granted_by) ? g.granted_by : {};
    if (!byUser.has(userId)) byUser.set(userId, []);
    byUser.get(userId)!.push({
      grantId: str(g.id) ?? '',
      permissionCode: str(g.permission_code) ?? '',
      displayName: str(permission.display_name) ?? str(g.permission_code) ?? '',
      category: str(permission.category) ?? '',
      isSensitive: permission.is_sensitive === true,
      scopeType: str(g.scope_type) ?? '',
      scopeId: str(g.scope_id),
      grantedAt: str(g.granted_at) ?? '',
      grantedByEmail: str(grantedBy.email),
    });
  }

  const holderIds = [...byUser.keys()];
  const users = holderIds.length === 0
    ? []
    : await runQuery<unknown>((t) =>
        t.from('app_user').select(ACCESS_USER_COLUMNS).in('id', holderIds).order('email'),
      );

  return users
    .filter(isRecord)
    .filter((u) => u.deleted_at === null || u.deleted_at === undefined)
    .map((u) => {
      const userId = str(u.id) ?? '';
      const first = str(u.first_name) ?? '';
      const last = str(u.last_name) ?? '';
      return {
        userId,
        email: str(u.email) ?? '',
        displayName: `${first} ${last}`.trim(),
        isDisabled: u.is_disabled === true,
        held: (byUser.get(userId) ?? []).sort((a, b) =>
          a.category.localeCompare(b.category) || a.permissionCode.localeCompare(b.permissionCode),
        ),
      };
    });
}

/**
 * The platform owner, if there is one — `E02-39`.
 *
 * ## Why the access screen has to read this
 *
 * `fetchAccess` lists accounts **that hold a grant**, which is the correct definition of the
 * access list right up until one account is defined by holding none. The owner would be absent
 * from the one screen whose whole job is answering "who can do what?" — the most powerful account
 * on the platform, invisible on the access audit. That is worse than `E10-64`'s wrong label: a
 * wrong name is at least a row somebody can query.
 *
 * ## Why a missing table is `null` rather than a failure
 *
 * The same reason `fetchIsOwner` treats a missing function as `false`: this ships before the
 * migration that creates the table, deliberately, and the screen must work either side of it. An
 * absent table means there is no owner yet, which is exactly true.
 *
 * Nothing else is swallowed — a network failure still throws, because "the access list could not
 * load" and "there is no owner" are different facts and a screen that cannot tell them apart will
 * eventually render one as the other.
 */
export interface PlatformOwner {
  userId: string;
  email: string;
  displayName: string;
  isDisabled: boolean;
  /** Why this account is the owner. The table requires one — ownership cannot move unexplained. */
  reason: string;
  setAt: string;
}

/** PostgREST's ways of saying the table is not there. */
const NO_SUCH_TABLE = new Set(['PGRST205', 'PGRST200', '42P01']);

export async function fetchPlatformOwner(): Promise<PlatformOwner | null> {
  let rows: unknown[];
  try {
    rows = await runQuery<unknown>((t) =>
      t.from('platform_owner').select('user_id,reason,set_at'),
    );
  } catch (cause) {
    if (cause instanceof ApiError && cause.code !== undefined && NO_SUCH_TABLE.has(cause.code)) {
      return null;
    }
    throw cause;
  }

  const row = rows.filter(isRecord)[0];
  const userId = row ? str(row.user_id) : null;
  if (!row || !userId) return null;

  // A second read rather than an embedded join: `platform_owner` has two foreign keys to
  // `app_user` — `user_id` and `set_by` — so PostgREST cannot resolve an embed without a
  // constraint-name hint, and a hint is a string that breaks silently if the constraint is ever
  // renamed. `fetchAccess` reads the same table the same way, two lines up.
  const users = await runQuery<unknown>((t) =>
    t.from('app_user').select(ACCESS_USER_COLUMNS).in('id', [userId]),
  );
  const user = users.filter(isRecord)[0];
  if (!user) return null;

  const first = str(user.first_name) ?? '';
  const last = str(user.last_name) ?? '';
  return {
    userId,
    email: str(user.email) ?? '',
    displayName: `${first} ${last}`.trim(),
    isDisabled: user.is_disabled === true,
    reason: str(row.reason) ?? '',
    setAt: str(row.set_at) ?? '',
  };
}

export interface GrantRequest {
  userId: string;
  permissionCode: string;
  scopeType: string;
  /** Required for every scope except `platform`, and forbidden for `platform`. */
  scopeId?: string | null;
}

export async function grantPermission(grant: GrantRequest): Promise<{ granted: { grantId: string } }> {
  return invokeFunction('admin-grants', { grant }, 'POST');
}

export async function revokePermission(
  grantId: string,
  reason?: string,
): Promise<{ revoked: { grantId: string } }> {
  return invokeFunction('admin-grants', { revoke: { grantId, reason } }, 'POST');
}
