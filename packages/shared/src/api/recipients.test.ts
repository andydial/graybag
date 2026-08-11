import { describe, expect, it, afterEach, vi } from 'vitest';

import {
  ApiError,
  RECIPIENT_COLUMNS,
  RecipientPayloadError,
  changeRecipientSchool,
  updateRecipientDetails,
  removeRecipient,
  createRecipient,
  fetchRecipients,
  setApiTransport,
} from './index.js';
import { fakeTransport } from './test-support.js';

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

  it('says which kind of recipient this is on every call, never by omission', async () => {
    // `E05-38`. The flag decides which privacy notice the consent record points at
    // (`self_data_notice` against `child_data_notice`) and which purposes it names. The
    // server defaults it to false, so leaving it out would work today and would flip
    // silently the day that default changed.
    const forChild = stub({ data: CREATED });
    await createRecipient(MINIMAL);
    expect((forChild.mock.calls[0]?.[1].body as Record<string, unknown>).is_self).toBe(false);

    const forSelf = stub({ data: CREATED });
    await createRecipient({ ...MINIMAL, isSelf: true });
    expect((forSelf.mock.calls[0]?.[1].body as Record<string, unknown>).is_self).toBe(true);
  });

  it('sends no class or section for an adult ordering for themselves', async () => {
    // `0022`: "No class or section is required. A staff member has neither." Dropped in the
    // request as well as on the screen, so a field left behind in a form's state cannot put
    // "Class 5" against a member of staff.
    const invoke = stub({ data: CREATED });
    await createRecipient({ ...MINIMAL, isSelf: true, classLabel: '5', sectionLabel: 'A' });

    const body = invoke.mock.calls[0]?.[1].body as Record<string, unknown>;
    expect(body.class_label).toBeNull();
    expect(body.section_label).toBeNull();
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

/**
 * A read transport with a session on it.
 *
 * `fetchRecipients` takes the guardian id from the session rather than from a parameter, so
 * there is no call shape that asks for somebody else's children. That means the fake needs an
 * `auth` surface as well as a table — `fakeTransport` provides the second, this adds the
 * first.
 */
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

/** One `guardian_link` row with its embedded child, as PostgREST returns it. */
const LINK = (over: Record<string, unknown> = {}, child: Record<string, unknown> = {}) => ({
  can_order: true,
  can_manage: true,
  recipient: {
    id: 'r1',
    first_name: 'Ishaan',
    last_name: 'Mehta',
    class_label: '5',
    section_label: 'A',
    is_active: true,
    school: { id: 's1', name: 'Alpha Public School' },
    ...child,
  },
  ...over,
});

describe('fetchRecipients', () => {
  it('reads guardian_link, never recipient.created_by_user_id', async () => {
    // `D10`. The legacy model had two parallel parent-to-child links and therefore two
    // answers to "may this user see this child". `guardian_link` is the only path, and
    // `created_by_user_id` is audit-only — its own column comment says it must never appear
    // in a policy, and it must not appear in a query either.
    const fake = readStub([LINK()]);
    await fetchRecipients();

    expect(fake.queries[0]?.table).toBe('guardian_link');
    expect(fake.queries[0]?.columns).not.toContain('created_by_user_id');
    expect(fake.queries[0]?.filters).toContainEqual({ column: 'user_id', value: 'u1' });
  });

  it('never selects * and never asks for allergy_note', async () => {
    // The column list is the redaction, exactly as in `fetchSchools`. `allergy_note` is tier
    // S — health data about a minor — and a screen drawing a name and a class has no reason
    // to hold it. A policy filters rows, never columns, so nothing else stops this.
    const fake = readStub([LINK()]);
    await fetchRecipients();

    const columns = fake.queries[0]?.columns ?? '';
    expect(columns).toBe(RECIPIENT_COLUMNS);
    expect(columns).not.toContain('*');
    for (const forbidden of ['allergy_note', 'created_by_user_id', 'is_minor', 'legacy_bubble_id']) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it('excludes revoked links in the query, not afterwards', async () => {
    // Links are revoked, never deleted — the audit trail matters — so a parent whose access
    // was removed still owns the row. Filtering it in JavaScript would mean the revoked
    // child's details were sent to the device before being dropped.
    const fake = readStub([LINK()]);
    await fetchRecipients();
    expect(fake.queries[0]?.isFilters).toContainEqual({ column: 'revoked_at', value: null });
  });

  it('flattens the child and its school', async () => {
    readStub([LINK()]);
    await expect(fetchRecipients()).resolves.toEqual([
      {
        id: 'r1',
        firstName: 'Ishaan',
        lastName: 'Mehta',
        classLabel: '5',
        sectionLabel: 'A',
        schoolId: 's1',
        schoolName: 'Alpha Public School',
        canOrder: true,
        canManage: true,
        isSelf: false,
      },
    ]);
  });

  it('reads is_self, because the screens cannot infer it', async () => {
    // `E05-38`. Without this column every row is a child as far as the app is concerned: the
    // adult's own row draws their name back at them, gets a class line, and the list goes on
    // offering "Order for myself" to someone who already does.
    const fake = readStub([LINK({}, { is_self: true })]);
    const rows = await fetchRecipients();
    expect(fake.queries[0]?.columns).toContain('is_self');
    expect(rows[0]?.isSelf).toBe(true);
  });

  it('treats a missing is_self as a child, not as unknown', async () => {
    // Absent means no, the same rule `can_manage` follows. The dangerous direction is the
    // other one: a row that became "myself" by omission would suppress the class of a real
    // child and claim a consent nobody gave under the self notice.
    readStub([LINK({}, { is_self: undefined })]);
    await expect(fetchRecipients()).resolves.toMatchObject([{ isSelf: false }]);
  });

  it('puts the adult’s own row first, ahead of the alphabet', async () => {
    // It renders as "You". Sorted by the first name nobody sees, it would land in a position
    // with no visible explanation — a row labelled You between two children reads as a bug.
    readStub([
      LINK({}, { id: 'r2', first_name: 'Aarav' }),
      LINK({}, { id: 'r3', first_name: 'Zoya', is_self: true }),
      LINK(),
    ]);
    const rows = await fetchRecipients();
    expect(rows.map((r) => r.id)).toEqual(['r3', 'r2', 'r1']);
  });

  it('skips a link whose child came back unreadable', async () => {
    // A revoked link that slipped through, or a soft-deleted child: the recipient policy
    // answers `null` rather than failing, and an authorization outcome is not a bad payload.
    readStub([{ can_order: true, can_manage: true, recipient: null }, LINK()]);
    await expect(fetchRecipients()).resolves.toHaveLength(1);
  });

  it('leaves a deactivated child off the list', async () => {
    readStub([LINK({}, { is_active: false })]);
    await expect(fetchRecipients()).resolves.toEqual([]);
  });

  it('keeps a child whose school is unreadable rather than hiding them', async () => {
    readStub([LINK({}, { school: null })]);
    await expect(fetchRecipients()).resolves.toMatchObject([{ id: 'r1', schoolName: '' }]);
  });

  it('treats a missing can_manage as no', async () => {
    // A co-guardian who may see but not edit must not get the change-school row. Absent
    // means no, because the alternative is a permission granted by a missing field.
    readStub([LINK({ can_manage: undefined, can_order: undefined })]);
    await expect(fetchRecipients()).resolves.toMatchObject([
      { canManage: false, canOrder: false },
    ]);
  });

  it('orders by first name', async () => {
    readStub([LINK({}, { id: 'r2', first_name: 'Zoya' }), LINK()]);
    const children = await fetchRecipients();
    expect(children.map((c) => c.firstName)).toEqual(['Ishaan', 'Zoya']);
  });

  it('is an empty list, not an error, for a signed-out parent', async () => {
    // `AR7`: nothing in this app is a wall. A signed-out parent sees the empty state that
    // invites them to add a child, not a failure.
    const fake = readStub([LINK()], { userId: null });
    await expect(fetchRecipients()).resolves.toEqual([]);
    expect(fake.queries).toHaveLength(0);
  });

  it('has no children yet, which is not an error either', async () => {
    readStub([]);
    await expect(fetchRecipients()).resolves.toEqual([]);
  });

  it('refuses a child with no id rather than drawing a nameless row', async () => {
    readStub([LINK({}, { id: undefined })]);
    await expect(fetchRecipients()).rejects.toBeInstanceOf(RecipientPayloadError);
  });

  it('puts no child in the payload error', async () => {
    // Non-negotiable #4 / §13.3. This message reaches a log and possibly Sentry; a child's
    // name in it is exactly the leak the rule exists to prevent.
    readStub([LINK({}, { first_name: undefined })]);
    const thrown = await fetchRecipients().catch((e: unknown) => e);
    expect(String(thrown)).not.toContain('Mehta');
    expect(String(thrown)).not.toContain('Alpha Public School');
  });

  it('surfaces a backend error rather than an empty list', async () => {
    // An RLS denial and "no children yet" both look like nothing. Only the error branch can
    // tell them apart, and losing it means a parent is told they have no children.
    readStub(null, { error: { message: 'permission denied', code: '42501' } });
    await expect(fetchRecipients()).rejects.toMatchObject({ name: 'ApiError', code: '42501' });
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

describe('updateRecipientDetails', () => {
  /**
   * The distinction the whole function exists for. A correction must NOT carry a school, because
   * `school_id`'s presence is what makes the server treat the request as a move — and a move has
   * a future-order guard and resets the class. A mistyped section should not need to pretend to
   * be a school transfer to get fixed.
   */
  it('sends no school_id, so the server reads it as a correction', async () => {
    const invoke = stub({ data: { recipient_id: 'r1' } });
    await updateRecipientDetails({ recipientId: 'r1', sectionLabel: 'B' });

    const body = invoke.mock.calls[0]?.[1].body as Record<string, unknown>;
    expect(body).not.toHaveProperty('school_id');
    expect(body.section_label).toBe('B');
    expect(invoke.mock.calls[0]?.[0]).toBe('recipients/r1');
    expect(invoke.mock.calls[0]?.[1].method).toBe('PATCH');
  });

  /**
   * `null` already means "leave alone", so it cannot also mean "remove". A parent who added a
   * section by mistake has to be able to take it off, and that is a different intent from not
   * mentioning it.
   */
  it('separates clearing a field from leaving it alone', async () => {
    const invoke = stub({ data: { recipient_id: 'r1' } });
    await updateRecipientDetails({ recipientId: 'r1', clearSection: true });

    const body = invoke.mock.calls[0]?.[1].body as Record<string, unknown>;
    expect(body.clear_section).toBe(true);
    expect(body.section_label).toBeNull();
  });

  it('defaults the clear flags to false rather than undefined', async () => {
    // `undefined` would drop out of the JSON body entirely and the server would read it as
    // absent — which is the same as false here, but only by accident. Sent explicitly.
    const invoke = stub({ data: { recipient_id: 'r1' } });
    await updateRecipientDetails({ recipientId: 'r1', firstName: 'Aarav' });

    const body = invoke.mock.calls[0]?.[1].body as Record<string, unknown>;
    expect(body.clear_section).toBe(false);
    expect(body.clear_last_name).toBe(false);
  });
});

describe('removeRecipient', () => {
  it('is a DELETE with the id in the path and no body', async () => {
    const invoke = stub({ data: { recipient_id: 'r1' } });
    await removeRecipient('r1');

    expect(invoke.mock.calls[0]?.[0]).toBe('recipients/r1');
    expect(invoke.mock.calls[0]?.[1].method).toBe('DELETE');
    expect(invoke.mock.calls[0]?.[1].body).toBeUndefined();
  });

  it('surfaces the undelivered-order refusal rather than swallowing it', async () => {
    // The parent has paid for food the kitchen is going to make. Removing the child it belongs
    // to would leave a meal with nobody's name on the packing list.
    stub({ error: Object.assign(new Error('future_orders_exist'), { context: new Response('', { status: 409 }) }) });
    await expect(removeRecipient('r1')).rejects.toMatchObject({ name: 'ApiError' });
  });
});
