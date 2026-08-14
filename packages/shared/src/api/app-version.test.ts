import { afterEach, describe, expect, it, vi } from 'vitest';

import { setApiTransport } from './client.js';
import { fetchVersionSupport } from './app-version.js';

/**
 * `E17-46`. The force-update gate, client half.
 *
 * Every assertion here is about **the direction the gate fails in**. The server decides whether a
 * build is too old; what this module decides is what happens when the answer is missing, garbled,
 * or never arrives — and every one of those must resolve to "carry on".
 *
 * The reasoning is worth restating because it inverts the rule the rest of this module follows.
 * §5.21 forbids collapsing a failure into a plausible answer, and `fetchOrders` throws rather
 * than returning `[]` for exactly that reason. Here the plausible answer *is* the correct one:
 * "this build is too old" is a claim that needs evidence, and a parent wrongly locked out has no
 * route back — the screen says update, the store says they are already current.
 */
const stub = (answer: { data?: unknown; error?: { message: string; code?: string } | null }) => {
  const rpc = vi.fn().mockResolvedValue({ data: answer.data ?? null, error: answer.error ?? null });
  setApiTransport({
    from: () => {
      throw new Error('the version check must not read a table');
    },
    rpc,
  } as never);
  return rpc;
};

afterEach(() => setApiTransport(null));

describe('fetchVersionSupport', () => {
  it('asks the server rather than comparing on the device', async () => {
    // The whole reason this is an RPC. Two comparators that must agree is `E20-50`'s bug — where
    // `'9' > '10'` as text recorded consent against superseded wording, invisibly — waiting for a
    // second home. The stub throws if anything reaches for a table, so this holds by construction.
    const rpc = stub({ data: { supported: true, minimum_version: '4.0.0' } });
    await fetchVersionSupport('4.0.0');
    expect(rpc).toHaveBeenCalledWith('app_version_support', { p_version: '4.0.0' });
  });

  it('blocks only on an explicit refusal', async () => {
    stub({ data: { supported: false, minimum_version: '4.0.0', message: 'Please update.' } });
    const result = await fetchVersionSupport('3.7.0');
    expect(result.supported).toBe(false);
    expect(result.message).toBe('Please update.');
    expect(result.minimumVersion).toBe('4.0.0');
  });

  it('carries the server’s sentence, so the wording changes without a deploy', async () => {
    stub({ data: { supported: false, minimum_version: '4.0.0', message: 'Update by Friday.' } });
    expect((await fetchVersionSupport('3.7.0')).message).toBe('Update by Friday.');
  });

  it('admits the build when the check fails outright', async () => {
    // A gate that closed on an outage would lock every parent out of the app using the mechanism
    // whose job is to tell them how to keep ordering.
    stub({ error: { message: 'network is down', code: 'PGRST000' } });
    const result = await fetchVersionSupport('3.7.0');
    expect(result.supported).toBe(true);
    expect(result.reason).toBe('check_failed');
  });

  it('admits the build when the transport cannot call RPCs at all', async () => {
    // An older test double, or a build whose transport predates `rpc`. It must not be a lockout.
    setApiTransport({ from: () => ({ select: () => ({}) }) } as never);
    expect((await fetchVersionSupport('3.7.0')).supported).toBe(true);
  });

  it('admits the build on a malformed answer', async () => {
    // `supported` absent, or not a boolean. Unknown is admitted — only an explicit `false` blocks.
    stub({ data: { minimum_version: '4.0.0' } });
    expect((await fetchVersionSupport('3.7.0')).supported).toBe(true);

    stub({ data: 'not an object' });
    expect((await fetchVersionSupport('3.7.0')).supported).toBe(true);

    stub({ data: null });
    expect((await fetchVersionSupport('3.7.0')).supported).toBe(true);
  });

  it('passes a null version through rather than inventing one', async () => {
    // A build that cannot read its own version is the server's call to make, and the server
    // admits it with `version_not_stated`. Substituting '0.0.0' here would invert that into a
    // guaranteed lockout the moment any floor is set.
    const rpc = stub({ data: { supported: true, reason: 'version_not_stated' } });
    const result = await fetchVersionSupport(null);
    expect(rpc).toHaveBeenCalledWith('app_version_support', { p_version: null });
    expect(result.reason).toBe('version_not_stated');
  });

  it('never throws, whatever the transport does', async () => {
    setApiTransport({
      from: () => {
        throw new Error('nope');
      },
      rpc: () => {
        throw new Error('exploded synchronously');
      },
    } as never);
    await expect(fetchVersionSupport('3.7.0')).resolves.toMatchObject({ supported: true });
  });
});
