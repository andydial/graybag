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

/*
 * The ids are **real-shaped uuids**, not `u-1` — `E10-73`.
 *
 * `app_user.id` is now rendered on this screen, and a 36-character uuid is a different layout
 * problem from a three-character stub: it wraps, it competes with the email, and a fixture that
 * hides that is a fixture the screen gets designed against. Same rule this file already follows
 * about demonstrating states production can actually produce. The a11y gate and the parity shot
 * both walk this data.
 */
export const PEOPLE_FIXTURE: {
  accounts: api.AccessAccount[];
  permissions: api.PermissionInfo[];
  /*
   * The owner — `E02-39`. Deliberately an account that is **not** in `accounts`, because that is
   * the production shape: the owner holds no grant rows, so nothing that reads
   * `permission_grant` can see them. A fixture whose owner also held grants would demo a state
   * the design cannot produce, and the a11y gate walks this page.
   */
  owner: api.PlatformOwner;
} = {
  accounts: [
    {
      userId: 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d', email: 'andy@example.com', displayName: 'Andy', isDisabled: false,
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
      userId: 'b2c3d4e5-6f7a-4b8c-9d0e-1f2a3b4c5d6e', email: 'cook@example.com', displayName: 'Priya', isDisabled: false,
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
    { userId: 'c3d4e5f6-7a8b-4c9d-8e1f-2a3b4c5d6e7f', email: 'newcook@example.com', displayName: '', isDisabled: false, held: [] },
    // Disabled and still holding access. Easy to miss, and the thing an audit is looking for.
    {
      userId: 'd4e5f6a7-8b9c-4d0e-9f2a-3b4c5d6e7f8a', email: 'former@example.com', displayName: 'Ravi', isDisabled: true,
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

  owner: {
    userId: 'e5f6a7b8-9c0d-4e1f-8a3b-4c5d6e7f8a9b',
    email: 'owner@graybag.com',
    displayName: 'The owner',
    isDisabled: false,
    reason: 'Founder and sole operator.',
    setAt: '2026-08-28T00:00:00.000Z',
  },
};
