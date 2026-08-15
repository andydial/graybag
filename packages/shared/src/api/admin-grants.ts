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
import { invokeFunction, runQuery } from './client.js';

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
export async function fetchAccess(): Promise<AccessAccount[]> {
  const [users, grants] = await Promise.all([
    runQuery<unknown>((t) => t.from('app_user').select(ACCESS_USER_COLUMNS).order('email')),
    runQuery<unknown>((t) =>
      t.from('permission_grant').select(ACCESS_GRANT_COLUMNS).is('revoked_at', null),
    ),
  ]);

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
