import { describe, expect, it, afterEach, vi } from 'vitest';

import {
  PROFILE_COLUMNS,
  ProfilePayloadError,
  clearUserName,
  fetchProfile,
  setUserName,
  shouldAskForName,
  skipNamePrompt,
  setApiTransport,
} from './index.js';
import { fakeTransport } from './test-support.js';

/** A read transport with a session on it — `fetchProfile` takes the id from the session. */
function readStub(
  rows: unknown,
  options: { userId?: string | null; error?: { message: string; code?: string } | null } = {},
) {
  const fake = fakeTransport(rows, options.error ?? null);
  const userId = options.userId === undefined ? 'u1' : options.userId;
  setApiTransport({
    ...fake.transport,
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: userId === null ? null : { user: { id: userId } } } }),
    },
  } as never);
  return fake;
}

/** A transport whose only job is to record the invoke and answer it. */
function writeStub(answer: { data?: unknown; error?: Error | null } = {}) {
  const invoke = vi
    .fn()
    .mockResolvedValue({ data: answer.data ?? null, error: answer.error ?? null });
  setApiTransport({
    from: () => {
      throw new Error('a write must not read a table');
    },
    functions: { invoke },
  } as never);
  return invoke;
}

const ROW = (over: Record<string, unknown> = {}) => ({
  first_name: 'Priya',
  last_name: 'Sharma',
  name_prompted_at: '2026-08-11T10:00:00+00:00',
  ...over,
});

afterEach(() => setApiTransport(null));

describe('fetchProfile', () => {
  it('asks for three columns and never for the rest of the row', async () => {
    // The column list is the redaction. `app_user` carries `phone_e164`, `is_disabled`,
    // `disabled_reason` and `deleted_at`; a screen that wants a first name must not be handed
    // whether the account has been suspended and why. RLS filters rows, never columns.
    const fake = readStub([ROW()]);
    await fetchProfile();

    expect(fake.queries[0]?.table).toBe('app_user');
    expect(fake.queries[0]?.columns).toBe(PROFILE_COLUMNS);
    for (const forbidden of ['*', 'phone_e164', 'is_disabled', 'disabled_reason', 'deleted_at']) {
      expect(fake.queries[0]?.columns).not.toContain(forbidden);
    }
  });

  it('filters to the caller’s own row even though a policy exists', async () => {
    // `app_user_read_admin` (`0002`) also admits other people's rows to a platform admin, so
    // without the filter an admin reading their own profile would get every user in the system
    // and this would return whichever came back first.
    const fake = readStub([ROW()]);
    await fetchProfile();
    expect(fake.queries[0]?.filters).toContainEqual({ column: 'id', value: 'u1' });
  });

  it('reads the name and the prompt stamp', async () => {
    readStub([ROW()]);
    await expect(fetchProfile()).resolves.toEqual({
      firstName: 'Priya',
      lastName: 'Sharma',
      namePromptedAt: '2026-08-11T10:00:00+00:00',
    });
  });

  it('treats no name as the ordinary case, not a gap', async () => {
    // Every user in the system is in this state today: nothing has ever written
    // `app_user.first_name` (`0018` does not, and neither did anything else).
    readStub([ROW({ first_name: null, last_name: null, name_prompted_at: null })]);
    await expect(fetchProfile()).resolves.toEqual({
      firstName: null,
      lastName: null,
      namePromptedAt: null,
    });
  });

  it('reads whitespace as no name', async () => {
    // A row holding "   " is non-null and renders as nothing — every "do we have a name" test
    // says yes and every surface prints a blank. `set_user_name` refuses to write one; this is
    // the other half, for rows that predate it or arrive from the Bubble import.
    readStub([ROW({ first_name: '   ' })]);
    await expect(fetchProfile()).resolves.toMatchObject({ firstName: null });
  });

  it('is null signed out, and asks nothing', async () => {
    const fake = readStub([ROW()], { userId: null });
    await expect(fetchProfile()).resolves.toBeNull();
    expect(fake.queries).toHaveLength(0);
  });

  it('is null when the account row has gone, rather than an error', async () => {
    // A session that outlived a deleted account is a real state, and it is not this module's
    // to report as corruption. It reads as "no name", which every caller already handles.
    readStub([]);
    await expect(fetchProfile()).resolves.toBeNull();
  });

  it('surfaces a backend error rather than a nameless profile', async () => {
    // An RLS denial and "no name" both look like nothing here. Collapsing them would mean a
    // parent whose read failed gets asked for a name we may already hold.
    readStub(null, { error: { message: 'permission denied', code: '42501' } });
    await expect(fetchProfile()).rejects.toMatchObject({ name: 'ApiError', code: '42501' });
  });

  it('refuses a payload that is not a row', async () => {
    readStub(['not a row']);
    await expect(fetchProfile()).rejects.toBeInstanceOf(ProfilePayloadError);
  });
});

describe('shouldAskForName', () => {
  it('asks when there is no name and no record of asking', async () => {
    expect(shouldAskForName({ firstName: null, lastName: null, namePromptedAt: null })).toBe(true);
  });

  it('does not ask again after a skip', async () => {
    // `P18`: one optional field with a clear skip, and **never asked twice**. A skip that is
    // not recorded is a question that comes back on the next order.
    expect(
      shouldAskForName({ firstName: null, lastName: null, namePromptedAt: '2026-08-11T10:00:00Z' }),
    ).toBe(false);
  });

  it('does not ask somebody whose name we already print', async () => {
    expect(shouldAskForName({ firstName: 'Priya', lastName: null, namePromptedAt: null })).toBe(
      false,
    );
  });

  it('asks nobody when there is nobody to ask', async () => {
    expect(shouldAskForName(null)).toBe(false);
  });
});

describe('setUserName', () => {
  it('goes through the Edge Function, never a table', async () => {
    // `A4` / non-negotiable #1 — and this one is the interesting case: RLS has permitted a
    // user to update their own `app_user` row since `0002`, so the direct write would have
    // worked. The stub throws if anything reaches for a table.
    const invoke = writeStub({ data: { first_name: 'Priya', last_name: null } });
    await setUserName({ firstName: 'Priya' });

    expect(invoke).toHaveBeenCalledWith(
      'account',
      expect.objectContaining({ body: expect.anything(), method: 'PATCH' }),
    );
  });

  it('never sends a user id — the server takes it from the JWT', async () => {
    // `set_user_name` is security definer and takes the id as a parameter, so whoever calls it
    // can act on any account. A body field the server trusted would let anyone rename anyone.
    const invoke = writeStub({ data: { first_name: 'Priya' } });
    await setUserName({ firstName: 'Priya' });

    const body = invoke.mock.calls[0]?.[1].body as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toMatch(/user_id/);
  });

  it('sends the last name as null rather than omitting it', async () => {
    const invoke = writeStub({ data: { first_name: 'Priya' } });
    await setUserName({ firstName: 'Priya' });

    const body = invoke.mock.calls[0]?.[1].body as Record<string, unknown>;
    expect(body).toEqual({ first_name: 'Priya', last_name: null });
  });
});

describe('skipNamePrompt', () => {
  it('is its own call, not an empty name', async () => {
    // A skip and an empty field are different intentions. One call meaning both would
    // eventually be sent by a form somebody tabbed past.
    const invoke = writeStub({ data: { prompted: true } });
    await skipNamePrompt();

    const body = invoke.mock.calls[0]?.[1].body as Record<string, unknown>;
    expect(body).toEqual({ skip_name_prompt: true });
    expect(body).not.toHaveProperty('first_name');
  });
});

describe('clearUserName', () => {
  it('is a flag, not an empty name', async () => {
    // The server refuses a blank first name on purpose, so `setUserName('')` would be refused
    // rather than clearing anything — and a form somebody tabbed past must not be
    // indistinguishable from a deliberate removal.
    const invoke = writeStub({ data: { first_name: null } });
    await clearUserName();

    const body = invoke.mock.calls[0]?.[1].body as Record<string, unknown>;
    expect(body).toEqual({ clear_name: true });
  });
});
