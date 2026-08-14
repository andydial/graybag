import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The session the write attributes itself to. Mocked rather than stubbed through the transport,
// because `currentUser` goes through the auth client and not through a query.
let mockUser: { userId: string; email: string | null } | null = { userId: 'user-1', email: null };
vi.mock('./auth.js', () => ({ currentUser: async () => mockUser }));

import { ApiError, setApiTransport } from './client.js';
import { cancelOrder } from './orders.js';

/**
 * `E06-45`. The parent cancels.
 *
 * The property this file exists to hold is **that the refusal survives the round trip as words**.
 * `cancel-order` returns a 409 whose `message` is the same sentence `cancelAvailability` would
 * have rendered for that condition, and a client that collapsed it into "something went wrong"
 * would make a parent who tapped one second late read an error instead of an explanation.
 */
function stub(answer: { data?: unknown; error?: (Error & { context?: Response }) | null }) {
  const invoke = vi
    .fn()
    .mockResolvedValue({ data: answer.data ?? null, error: answer.error ?? null });
  setApiTransport({
    // A write must not touch a table — `A4`, non-negotiable #1. Asserted by construction:
    // anything reaching for one throws rather than quietly working.
    from: () => {
      throw new Error('a write must not read a table');
    },
    functions: { invoke },
  } as never);
  return invoke;
}

const OK = {
  order_group_id: 'g1',
  status: 'cancelled',
  orders_cancelled: 1,
  refund_id: 'r1',
  refund_amount_paise: 20_000,
  refund_status: 'pending',
};

const refusal = (status: number, body: unknown) => {
  const error = new Error('Edge Function returned a non-2xx status code') as Error & {
    context?: Response;
  };
  error.context = new Response(JSON.stringify(body), { status });
  return error;
};

beforeEach(() => {
  mockUser = { userId: 'user-1', email: null };
});
afterEach(() => setApiTransport(null));

describe('cancelOrder', () => {
  it('goes through the Edge Function, never a table', async () => {
    const invoke = stub({ data: OK });
    await cancelOrder('g1');
    expect(invoke).toHaveBeenCalledWith(
      'cancel-order',
      expect.objectContaining({ body: { order_group_id: 'g1' } }),
    );
  });

  it('does not send a customer id, because the server takes it from the JWT', async () => {
    // Sending one would imply it is trusted. `cancel_order` runs as `service_role` and could
    // cancel as anybody, so the identity is proved from the verified token in the Edge
    // Function and a body field named for it is ignored — this asserts we never write one.
    const invoke = stub({ data: OK });
    await cancelOrder('g1');
    const body = invoke.mock.calls[0]?.[1]?.body as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['order_group_id']);
  });

  it('reports the recorded refund as PENDING, never as refunded', async () => {
    // The money is issued by hand in the Razorpay dashboard today. A screen that read this as
    // "refunded" would tell a parent their money is back before anybody had sent it.
    const result = await stubbed();
    expect(result.refundStatus).toBe('pending');
    expect(result.refundAmountPaise).toBe(20_000);
    expect(result.refundId).toBe('r1');
  });

  it('keeps the server’s sentence on a refusal, and its code', async () => {
    stub({
      error: refusal(409, {
        code: 'cancellation_closed',
        message: 'Cancelling has closed for this order.',
      }),
    });
    await expect(cancelOrder('g1')).rejects.toThrow(/Cancelling has closed/);

    stub({
      error: refusal(409, {
        code: 'cancellation_closed',
        message: 'Cancelling has closed for this order.',
      }),
    });
    // The code, so a caller can branch without parsing prose.
    await expect(cancelOrder('g1')).rejects.toMatchObject({ code: 'cancellation_closed' });
  });

  it('refuses without a round trip when nobody is signed in', async () => {
    mockUser = null;
    const invoke = stub({ data: OK });
    await expect(cancelOrder('g1')).rejects.toThrow(/signed in/i);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('surfaces an unexpected failure rather than reporting a cancellation', async () => {
    // The worst outcome is a resolved promise over a failed cancel: the screen would refetch,
    // see the order still paid, and show nothing at all.
    stub({ error: refusal(500, { error: 'could not cancel the order' }) });
    await expect(cancelOrder('g1')).rejects.toBeInstanceOf(ApiError);
  });
});

async function stubbed() {
  stub({ data: OK });
  return cancelOrder('g1');
}
