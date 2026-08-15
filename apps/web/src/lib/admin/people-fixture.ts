/**
 * An access list the a11y audit and a designer can open without a session — `E10-27`.
 *
 * The shapes that matter, not the tidy one: an operator holding a lot including something
 * sensitive, a cook holding the two permissions a kitchen actually needs, an account with
 * **nothing** (which is how somebody gets onboarded — they sign in once and appear here), and a
 * disabled account that still holds grants, because that combination is easy to miss and is
 * exactly what somebody auditing access is looking for.
 */
import type { api } from '@graybag/shared';

export const PEOPLE_FIXTURE: {
  accounts: api.AccessAccount[];
  permissions: api.PermissionInfo[];
} = {
  accounts: [
    {
      userId: 'u-1', email: 'andy@example.com', displayName: 'Andy', isDisabled: false,
      held: [
        {
          grantId: 'g-1', permissionCode: 'config.platform_edit', displayName: 'Edit platform config',
          category: 'platform', isSensitive: true, scopeType: 'platform', scopeId: null,
          grantedAt: '2026-08-15T00:00:00Z', grantedByEmail: 'andy@example.com',
        },
        {
          grantId: 'g-2', permissionCode: 'orders.view', displayName: 'View orders',
          category: 'orders', isSensitive: false, scopeType: 'platform', scopeId: null,
          grantedAt: '2026-08-15T00:00:00Z', grantedByEmail: 'andy@example.com',
        },
      ],
    },
    {
      userId: 'u-2', email: 'cook@example.com', displayName: 'Priya', isDisabled: false,
      held: [
        {
          grantId: 'g-3', permissionCode: 'orders.mark_delivered', displayName: 'Mark delivered',
          category: 'orders', isSensitive: false, scopeType: 'kitchen',
          scopeId: '00000000-0000-0000-0000-0000000000k1',
          grantedAt: '2026-08-15T00:00:00Z', grantedByEmail: 'andy@example.com',
        },
        {
          grantId: 'g-4', permissionCode: 'orders.view_pii', displayName: 'View order names',
          category: 'orders', isSensitive: true, scopeType: 'kitchen',
          scopeId: '00000000-0000-0000-0000-0000000000k1',
          grantedAt: '2026-08-15T00:00:00Z', grantedByEmail: 'andy@example.com',
        },
      ],
    },
    // Signed in, holds nothing. The state everybody starts in, and the reason this list is not
    // filtered to privileged accounts — there would be no way to reach the person being onboarded.
    { userId: 'u-3', email: 'newcook@example.com', displayName: '', isDisabled: false, held: [] },
    // Disabled and still holding access. Easy to miss, and the thing an audit is looking for.
    {
      userId: 'u-4', email: 'former@example.com', displayName: 'Ravi', isDisabled: true,
      held: [
        {
          grantId: 'g-5', permissionCode: 'orders.refund', displayName: 'Refund orders',
          category: 'orders', isSensitive: true, scopeType: 'platform', scopeId: null,
          grantedAt: '2026-06-01T00:00:00Z', grantedByEmail: 'andy@example.com',
        },
      ],
    },
  ],
  permissions: [
    {
      code: 'orders.view', category: 'orders', displayName: 'View orders',
      description: 'See orders within the granted scope, without customer or recipient names.',
      isSensitive: false, validScopeTypes: ['platform', 'city', 'kitchen', 'school'],
    },
    {
      code: 'orders.view_pii', category: 'orders', displayName: 'View order names',
      description: 'See recipient names, class and section on orders.',
      isSensitive: true, validScopeTypes: ['platform', 'kitchen', 'school'],
    },
    {
      code: 'orders.mark_delivered', category: 'orders', displayName: 'Mark delivered',
      description: 'Mark an order handed over.',
      isSensitive: false, validScopeTypes: ['platform', 'city', 'kitchen', 'school'],
    },
    {
      code: 'grants.manage', category: 'platform', displayName: 'Manage access',
      description: 'Grant and revoke back-office permissions.',
      isSensitive: true, validScopeTypes: ['platform'],
    },
  ],
};
