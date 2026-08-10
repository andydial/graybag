import { describe, expect, it, afterEach, vi } from 'vitest';

import {
  ApiError,
  changeRecipientSchool,
  createRecipient,
  setApiTransport,
} from './index.js';

/** A transport whose only job is to record the invoke and answer it. */
function stub(answer: { data?: unknown; error?: (Error & { context?: Response }) | null }) {
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

const CREATED = {
  recipient_id: 'r1',
  first_name: 'Ishaan',
  school_id: 's1',
  notice_version_id: 'pv1',
};

const MOVED = {
  recipient_id: 'r1',
  school_id: 's2',
  changed_school: true,
  from_school_id: 's1',
};

/** PostgREST-style refusal: functions.invoke gives an Error whose context is the Response. */
const refusal = (status: number, body: unknown) => {
  const error = new Error('Edge Function returned a non-2xx status code') as Error & {
    context?: Response;
  };
  error.context = new Response(JSON.stringify(body), { status });
  return error;
};

const MINIMAL = { firstName: 'Ishaan', schoolId: 's1', consentGranted: true };

afterEach(() => setApiTransport(null));

describe('createRecipient', () => {
  it('goes through the Edge Function, never a table', async () => {
    // `A4` / non-negotiable #1. The stub throws if anything reaches for a table, so this is
    // asserted by construction rather than by inspection.
    const invoke = stub({ data: CREATED });
    await createRecipient(MINIMAL);
    expect(invoke).toHaveBeenCalledWith(
      'recipients',
      expect.objectContaining({ body: expect.anything() }),
    );
  });

  it('never sends a guardian id — the server takes it from the JWT', async () => {
    // `create_recipient` runs as service_role and takes the guardian id as a parameter, so a
    // body field the server trusted would let anyone add a child to anyone's account.
    const invoke = stub({ data: CREATED });
    await createRecipient(MINIMAL);

    const body = invoke.mock.calls[0]?.[1].body as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain('guardian_user_id');
    expect(JSON.stringify(body)).not.toMatch(/user_id/);
  });

  it('carries the required consent as a field on the same call', async () => {
    // There is deliberately no "add the child now, record consent later" shape. The server
    // writes both or neither; a client that could separate them eventually would, and a
    // network failure between two requests leaves a child nobody agreed to.
    const invoke = stub({ data: CREATED });
    await createRecipient(MINIMAL);

    const body = invoke.mock.calls[0]?.[1].body as Record<string, unknown>;
    expect(body.consent_granted).toBe(true);
  });

  it('withholds allergy details when the separate consent was not given', async () => {
    // `C12`: allergies are health data about a minor and are consented to separately. The
    // server refuses the inconsistent combination and must keep doing so — this is about the
    // client not putting the details in the request in the first place.
    const invoke = stub({ data: CREATED });
    await createRecipient({
      ...MINIMAL,
      allergenConsent: false,
      allergenIds: ['a1'],
      allergyNote: 'Peanut allergy',
    });

    const body = invoke.mock.calls[0]?.[1].body as Record<string, unknown>;
    expect(body.allergen_consent).toBe(false);
    expect(body.allergen_ids).toEqual([]);
    expect(body.allergy_note).toBeNull();
  });

  it('sends allergy details when that consent was given', async () => {
    const invoke = stub({ data: CREATED });
    await createRecipient({
      ...MINIMAL,
      allergenConsent: true,
      allergenIds: ['a1'],
      allergyNote: 'Peanut allergy',
    });

    const body = invoke.mock.calls[0]?.[1].body as Record<string, unknown>;
    expect(body.allergen_ids).toEqual(['a1']);
    expect(body.allergy_note).toBe('Peanut allergy');
  });

  it('treats a non-boolean consent as not given', async () => {
    // `"false"` is a truthy string. A parent who declined must not have that read as
    // agreement because a form sent the wrong type.
    const invoke = stub({ data: CREATED });
    await createRecipient({ ...MINIMAL, consentGranted: 'false' as unknown as boolean });

    const body = invoke.mock.calls[0]?.[1].body as Record<string, unknown>;
    expect(body.consent_granted).toBe(false);
  });

  it('puts no child in the consent context', async () => {
    // §11.5 / non-negotiable #4. The consent row is evidence that somebody agreed, not a
    // second copy of the child's details.
    const invoke = stub({ data: CREATED });
    await createRecipient({ ...MINIMAL, firstName: 'Ishaan', screen: 'add-child', appVersion: '2.0.0' });

    const body = invoke.mock.calls[0]?.[1].body as Record<string, unknown>;
    expect(body.screen).toBe('add-child');
    expect(body.app_version).toBe('2.0.0');
  });

  it('returns the notice version that was consented to', async () => {
    // What makes a later change of wording a new version rather than a rewrite of history.
    stub({ data: CREATED });
    await expect(createRecipient(MINIMAL)).resolves.toMatchObject({
      recipientId: 'r1',
      noticeVersionId: 'pv1',
    });
  });

  it('surfaces the server refusal code rather than a generic failure', async () => {
    stub({
      error: refusal(409, {
        code: 'allergen_consent_required',
        message: 'To store allergy details we need your permission on the allergies question.',
      }),
    });

    await expect(createRecipient(MINIMAL)).rejects.toMatchObject({
      name: 'ApiError',
      code: 'allergen_consent_required',
    });
  });
});

describe('changeRecipientSchool', () => {
  it('puts the child id in the path, not the body', async () => {
    // One id per request. A body id alongside a path id leaves it ambiguous which the
    // server used, and the answer would be invisible from the client.
    const invoke = stub({ data: MOVED });
    await changeRecipientSchool({ recipientId: 'r1', schoolId: 's2' });

    expect(invoke.mock.calls[0]?.[0]).toBe('recipients/r1');
    const body = invoke.mock.calls[0]?.[1].body as Record<string, unknown>;
    expect(body).not.toHaveProperty('recipient_id');
  });

  it('is a PATCH', async () => {
    const invoke = stub({ data: MOVED });
    await changeRecipientSchool({ recipientId: 'r1', schoolId: 's2' });
    expect(invoke.mock.calls[0]?.[1].method).toBe('PATCH');
  });

  it('reports a no-op as a no-op', async () => {
    // Choosing the school the child is already at is not an error — it is also how a class
    // correction arrives — so the screen needs to know not to announce a move.
    stub({ data: { ...MOVED, changed_school: false, school_id: 's1' } });
    await expect(
      changeRecipientSchool({ recipientId: 'r1', schoolId: 's1' }),
    ).resolves.toMatchObject({ changedSchool: false });
  });

  it('surfaces the undelivered-orders refusal by its code', async () => {
    // `D19`. The screen has to say which days to cancel, so this cannot collapse into
    // "something went wrong".
    stub({
      error: refusal(409, {
        code: 'future_orders_exist',
        message: 'There are orders for this child that have not been delivered yet.',
      }),
    });

    // One call, both assertions. `invokeFunction` reads the refusal out of the `Response`
    // body, and a body can only be read once — asserting twice against the *same* stubbed
    // Response would see `code: undefined` the second time and look like a lost code.
    const thrown = await changeRecipientSchool({ recipientId: 'r1', schoolId: 's2' }).catch(
      (e: unknown) => e,
    );
    expect(thrown).toBeInstanceOf(ApiError);
    expect(thrown).toMatchObject({ code: 'future_orders_exist' });
  });
});
