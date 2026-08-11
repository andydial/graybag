import { describe, expect, it, afterEach } from 'vitest';

import {
  POLICY_VERSION_COLUMNS,
  PolicyPayloadError,
  compareVersions,
  fetchPendingPolicies,
  setApiTransport,
} from './index.js';
import { fakeTransport } from './test-support.js';

afterEach(() => setApiTransport(null));

const install = (rows: unknown, error: { message: string; code?: string } | null = null) => {
  const fake = fakeTransport(rows, error);
  setApiTransport(fake.transport);
  return fake;
};

const NOW = new Date('2026-08-11T00:00:00.000Z');

/** A published, ordering-blocking version nobody has accepted. */
const ROW = (over: Record<string, unknown> = {}) => ({
  id: 'v1',
  policy_code: 'privacy_policy',
  version: '2',
  effective_from: '2026-08-01T00:00:00.000Z',
  summary_of_changes: 'We now say what the kitchen keeps and for how long.',
  user_policy_acceptance: [],
  ...over,
});

describe('fetchPendingPolicies', () => {
  it('reads policy_version, not a function', () => {
    // The gate must be decidable under RLS. Moving it into an RPC would take the decision out
    // of the policies and put it in a function body, where `policy_version_read_published` is
    // no longer the thing that answers "may this caller see a draft".
    const fake = install([ROW()]);
    void fetchPendingPolicies(NOW);
    expect(fake.queries[0]?.table).toBe('policy_version');
  });

  it('never selects * , and never asks for the document or its evidence', async () => {
    // A policy filters rows, never columns. `policy_version` carries the full `content_md`
    // and `content_sha256`; `user_policy_acceptance` carries `ip_hash` and `user_agent_hash`.
    // None of it is needed to answer a yes/no question, and none of it should reach a handset.
    const fake = install([ROW()]);
    await fetchPendingPolicies(NOW);

    const columns = fake.queries[0]?.columns ?? '';
    expect(columns).toBe(POLICY_VERSION_COLUMNS);
    expect(columns).not.toContain('*');
    for (const forbidden of [
      'content_md',
      'content_url',
      'content_sha256',
      'created_by_user_id',
      'ip_hash',
      'user_agent_hash',
      'accepted_at',
    ]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it('asks only for published, ordering-blocking versions already in effect', async () => {
    const fake = install([ROW()]);
    await fetchPendingPolicies(NOW);
    const q = fake.queries[0];

    // A draft must never gate an order. `is(published_at, null)` is the *opposite* query, so
    // this is asserted as a negation with its operator rather than as a filter that happens
    // to mention the column.
    expect(q?.notFilters).toContainEqual({
      column: 'published_at',
      operator: 'is',
      value: null,
    });
    expect(q?.filters).toContainEqual({ column: 'blocks_ordering', value: true });
    expect(q?.lteFilters).toContainEqual({
      column: 'effective_from',
      value: NOW.toISOString(),
    });
  });

  it('sends no user id — RLS scopes the embed to the caller', async () => {
    // `user_policy_acceptance_read_self` is `user_id = auth.uid()`. If this ever filtered on a
    // client-supplied id, the client would be deciding whose acceptances it sees.
    const fake = install([ROW()]);
    await fetchPendingPolicies(NOW);
    const mentioned = JSON.stringify(fake.queries[0]?.filters ?? []);
    expect(mentioned).not.toContain('user_id');
  });

  it('returns a version with no acceptance rows', async () => {
    install([ROW()]);
    await expect(fetchPendingPolicies(NOW)).resolves.toEqual([
      {
        versionId: 'v1',
        policyCode: 'privacy_policy',
        version: '2',
        summaryOfChanges: 'We now say what the kitchen keeps and for how long.',
      },
    ]);
  });

  it('drops a version the caller has already accepted', async () => {
    install([ROW({ user_policy_acceptance: [{ policy_version_id: 'v1' }] })]);
    await expect(fetchPendingPolicies(NOW)).resolves.toEqual([]);
  });

  it('requires only the current version of a policy, not every past one', async () => {
    // Two published, ordering-blocking versions of one document. Asking a parent to accept
    // both is a bug that looks like diligence — version 2 supersedes version 1.
    install([
      ROW({ id: 'v2', version: '2', effective_from: '2026-08-01T00:00:00.000Z' }),
      ROW({ id: 'v1', version: '1', effective_from: '2026-01-01T00:00:00.000Z' }),
    ]);
    const pending = await fetchPendingPolicies(NOW);
    expect(pending.map((p) => p.versionId)).toEqual(['v2']);
  });

  it('gates on the current version even when an older one was accepted', async () => {
    // The whole point of a version gate: accepting v1 does not accept v2.
    install([
      ROW({ id: 'v2', version: '2', effective_from: '2026-08-01T00:00:00.000Z' }),
      ROW({
        id: 'v1',
        version: '1',
        effective_from: '2026-01-01T00:00:00.000Z',
        user_policy_acceptance: [{ policy_version_id: 'v1' }],
      }),
    ]);
    const pending = await fetchPendingPolicies(NOW);
    expect(pending.map((p) => p.versionId)).toEqual(['v2']);
  });

  it('breaks a same-day tie on version number, not string order', async () => {
    // `2.10` is above `2.9`. A string compare says otherwise, and would gate on stale wording.
    install([
      ROW({ id: 'low', version: '2.9', effective_from: '2026-08-01T00:00:00.000Z' }),
      ROW({ id: 'high', version: '2.10', effective_from: '2026-08-01T00:00:00.000Z' }),
    ]);
    const pending = await fetchPendingPolicies(NOW);
    expect(pending.map((p) => p.versionId)).toEqual(['high']);
  });

  it('keeps one pending version per policy', async () => {
    install([
      ROW({ id: 'p1', policy_code: 'privacy_policy' }),
      ROW({ id: 't1', policy_code: 'terms_of_service' }),
    ]);
    const pending = await fetchPendingPolicies(NOW);
    expect(pending.map((p) => p.policyCode).sort()).toEqual([
      'privacy_policy',
      'terms_of_service',
    ]);
  });

  it('treats a missing summary as null rather than an empty string', async () => {
    // The screen substitutes a fallback. An empty panel would ask a parent to accept a change
    // we decline to describe.
    install([ROW({ summary_of_changes: null })]);
    const [pending] = await fetchPendingPolicies(NOW);
    expect(pending?.summaryOfChanges).toBeNull();
  });

  it('treats a malformed embed as not accepted', async () => {
    // The safe direction: ask again, rather than let an order past a policy nobody saw.
    install([ROW({ user_policy_acceptance: undefined })]);
    const pending = await fetchPendingPolicies(NOW);
    expect(pending).toHaveLength(1);
  });

  it('refuses a row that is missing a required field', async () => {
    install([ROW({ version: undefined })]);
    await expect(fetchPendingPolicies(NOW)).rejects.toBeInstanceOf(PolicyPayloadError);
  });

  it('is empty when nothing is published — which is every environment today', async () => {
    // `policy_version` is deliberately unseeded until `E20-01` returns the approved wording.
    install([]);
    await expect(fetchPendingPolicies(NOW)).resolves.toEqual([]);
  });
});

describe('compareVersions', () => {
  it('orders numerically, part by part', () => {
    expect(compareVersions('2.10', '2.9')).toBeGreaterThan(0);
    expect(compareVersions('2', '2.1')).toBeLessThan(0);
    expect(compareVersions('3', '3.0')).toBe(0);
  });
});
