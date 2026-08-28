/**
 * The client half of the derived platform owner — `E02-39`.
 *
 * Every test here is about the same property: **this code ships before the migration that makes
 * it mean anything, and must behave identically either side of it.** That is `E02-36`'s lesson
 * applied in advance — a client and a migration that have to land together will land in the wrong
 * order eventually, and the half that arrives first should keep working rather than break a screen.
 *
 * So "there is no such function" and "there is no such table" are answers, not failures, and
 * everything else still throws.
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { ApiTransport, ProviderError } from './client.js';
import { ApiError, setApiTransport } from './client.js';
import { capabilities, fetchIsOwner, fetchMyAccess, fetchMyCapabilities } from './kitchen.js';
import { fetchPlatformOwner } from './admin-grants.js';

afterEach(() => setApiTransport(null));

/**
 * A transport with a per-table answer and an RPC, which `fakeTransport` deliberately does not
 * have — its one canned answer is right for a function with one round trip, and these have two.
 */
function stub(options: {
  tables?: Record<string, unknown[] | ProviderError>;
  rpc?: unknown | ProviderError;
  rpcMissing?: boolean;
}): { transport: ApiTransport; asked: string[] } {
  const asked: string[] = [];
  const isError = (v: unknown): v is ProviderError =>
    typeof v === 'object' && v !== null && 'message' in v && !Array.isArray(v);

  const transport = {
    from(table: string) {
      asked.push(table);
      const answer = options.tables?.[table] ?? [];
      const builder: Record<string, unknown> = {
        then: (ok: (r: unknown) => unknown) =>
          Promise.resolve(
            isError(answer) ? { data: null, error: answer } : { data: answer, error: null },
          ).then(ok),
      };
      for (const method of ['eq', 'is', 'in', 'order', 'limit', 'select']) {
        builder[method] = () => builder;
      }
      return { select: () => builder };
    },
  } as unknown as ApiTransport;

  if (!options.rpcMissing) {
    (transport as { rpc?: unknown }).rpc = (fn: string) => {
      asked.push(`rpc:${fn}`);
      const answer = options.rpc;
      return Promise.resolve(
        isError(answer) ? { data: null, error: answer } : { data: answer ?? null, error: null },
      );
    };
  }

  return { transport, asked };
}

describe('fetchIsOwner — before the migration exists', () => {
  /*
   * The whole reason this file exists. `auth_is_owner()` is in a migration that has not reached
   * production, and until it does every back-office page calls a function that is not there.
   */
  it('reads a missing function as "not the owner", not as an error', async () => {
    for (const code of ['PGRST202', 'PGRST203', '42883']) {
      setApiTransport(stub({ rpc: { message: 'no such function', code } }).transport);
      await expect(fetchIsOwner()).resolves.toBe(false);
    }
  });

  it('does not swallow anything else — a failed read is not a false answer', async () => {
    setApiTransport(stub({ rpc: { message: 'connection refused', code: '08006' } }).transport);
    await expect(fetchIsOwner()).rejects.toBeInstanceOf(ApiError);
  });

  it('is true only for a literal true, never for a truthy shape', async () => {
    setApiTransport(stub({ rpc: true }).transport);
    await expect(fetchIsOwner()).resolves.toBe(true);

    setApiTransport(stub({ rpc: null }).transport);
    await expect(fetchIsOwner()).resolves.toBe(false);

    // A row rather than a boolean would be a function that does not do what this thinks it does,
    // and `{}` is truthy. Answering "yes, owner" to that is the one wrong direction to fail in.
    setApiTransport(stub({ rpc: {} }).transport);
    await expect(fetchIsOwner()).resolves.toBe(false);
  });
});

describe('fetchMyAccess', () => {
  it('returns the grants and the owner flag together', async () => {
    const { transport, asked } = stub({
      tables: { permission_grant: [{ permission_code: 'orders.view', scope_type: 'kitchen' }] },
      rpc: false,
    });
    setApiTransport(transport);

    const access = await fetchMyAccess();
    expect(access.grants).toEqual([{ permissionCode: 'orders.view', scopeType: 'kitchen' }]);
    expect(access.isOwner).toBe(false);
    expect(asked).toContain('rpc:auth_is_owner');
  });

  /*
   * The consequence the whole design has to answer for: the owner's grant list is genuinely empty,
   * so any client that reads only the grants renders an empty back office for the account that can
   * do everything.
   */
  it('reports the owner even though they hold no grant rows', async () => {
    setApiTransport(stub({ tables: { permission_grant: [] }, rpc: true }).transport);
    const access = await fetchMyAccess();
    expect(access.grants).toEqual([]);
    expect(access.isOwner).toBe(true);
  });
});

describe('capabilities', () => {
  it('answers yes to everything for the owner, while reporting the codes honestly', () => {
    const caps = capabilities([], true);
    expect(caps.has('orders.refund')).toBe(true);
    expect(caps.has('a.permission.that.does.not.exist')).toBe(true);
    // `codes` is what they hold, and they hold nothing. `/admin/people` renders this list, and a
    // list of invented rows would be a screen claiming grants nobody made.
    expect(caps.codes).toEqual([]);
    expect(caps.isOwner).toBe(true);
  });

  it('is an ordinary set membership test for everyone else', () => {
    const caps = capabilities(['orders.view', 'menu.view', 'orders.view']);
    expect(caps.has('orders.view')).toBe(true);
    expect(caps.has('orders.refund')).toBe(false);
    expect(caps.codes).toEqual(['menu.view', 'orders.view']);
    expect(caps.isOwner).toBe(false);
  });
});

describe('fetchMyCapabilities', () => {
  it('opens every control for the owner and none of them for an account with nothing', async () => {
    setApiTransport(stub({ tables: { permission_grant: [] }, rpc: true }).transport);
    expect((await fetchMyCapabilities()).has('orders.refund')).toBe(true);

    setApiTransport(stub({ tables: { permission_grant: [] }, rpc: false }).transport);
    expect((await fetchMyCapabilities()).has('orders.refund')).toBe(false);
  });
});

describe('fetchPlatformOwner', () => {
  it('reads a missing table as "no owner yet", which is exactly true until the migration lands', async () => {
    for (const code of ['PGRST205', 'PGRST200', '42P01']) {
      setApiTransport(stub({ tables: { platform_owner: { message: 'no such table', code } } }).transport);
      await expect(fetchPlatformOwner()).resolves.toBeNull();
    }
  });

  it('does not swallow a real failure', async () => {
    setApiTransport(
      stub({ tables: { platform_owner: { message: 'permission denied', code: '42501' } } }).transport,
    );
    await expect(fetchPlatformOwner()).rejects.toBeInstanceOf(ApiError);
  });

  it('names the account, and carries the reason ownership was given', async () => {
    setApiTransport(
      stub({
        tables: {
          platform_owner: [
            { user_id: 'u-1', reason: 'Founder and sole operator.', set_at: '2026-08-28T00:00:00Z' },
          ],
          app_user: [
            { id: 'u-1', email: 'andy@graybag.com', first_name: 'Andy', last_name: '', is_disabled: false },
          ],
        },
      }).transport,
    );

    const owner = await fetchPlatformOwner();
    expect(owner).toEqual({
      userId: 'u-1',
      email: 'andy@graybag.com',
      displayName: 'Andy',
      isDisabled: false,
      reason: 'Founder and sole operator.',
      setAt: '2026-08-28T00:00:00Z',
    });
  });

  it('is null when the table is empty — an unowned platform is a legitimate state', async () => {
    setApiTransport(stub({ tables: { platform_owner: [] } }).transport);
    await expect(fetchPlatformOwner()).resolves.toBeNull();
  });

  /*
   * `is_disabled` is read and returned rather than filtered here, because the screen has to be
   * able to say so. The *authorisation* consequence is the database's: `auth_is_owner()` joins
   * `app_user` and requires `is_disabled = false`, so a disabled owner can do nothing — and a
   * screen that silently hid the row would leave nobody able to explain why.
   */
  it('still returns a disabled owner, so the screen can say the account is switched off', async () => {
    setApiTransport(
      stub({
        tables: {
          platform_owner: [{ user_id: 'u-1', reason: 'r', set_at: 's' }],
          app_user: [{ id: 'u-1', email: 'a@b.com', first_name: '', last_name: '', is_disabled: true }],
        },
      }).transport,
    );
    expect((await fetchPlatformOwner())?.isDisabled).toBe(true);
  });
});
