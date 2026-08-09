import { describe, expect, it, afterEach, vi } from 'vitest';

import { ApiError, createCheckout, setApiTransport } from './index.js';

/** A transport whose only job is to record the invoke and answer it. */
function stub(answer: { data?: unknown; error?: (Error & { context?: Response }) | null }) {
  const invoke = vi.fn().mockResolvedValue({ data: answer.data ?? null, error: answer.error ?? null });
  setApiTransport({ from: () => { throw new Error('a write must not read a table'); },
                    functions: { invoke } } as never);
  return invoke;
}

const OK = {
  order_group_id: 'g1',
  correlation_id: 'c1',
  payable_paise: 16800,
  replayed: false,
  orders: [{ order_id: 'o1', order_ref: 'GB-ABC123', service_date: '2026-08-13', total_paise: 16800 }],
};

/** PostgREST-style refusal: functions.invoke gives an Error whose context is the Response. */
const refusal = (status: number, body: unknown) => {
  const error = new Error('Edge Function returned a non-2xx status code') as Error & {
    context?: Response;
  };
  error.context = new Response(JSON.stringify(body), { status });
  return error;
};

afterEach(() => setApiTransport(null));

describe('createCheckout', () => {
  it('goes through the Edge Function, never a table', async () => {
    // A4 / non-negotiable #1. The stub throws if anything reaches for a table, so this is
    // asserted by construction rather than by inspection.
    const invoke = stub({ data: OK });
    await createCheckout({ idempotencyKey: 'k1', expectedTotalPaise: 16800, lines: [] });
    expect(invoke).toHaveBeenCalledWith('checkout', expect.objectContaining({ body: expect.anything() }));
  });

  it('sends the idempotency key and the expected total', async () => {
    const invoke = stub({ data: OK });
    await createCheckout({
      idempotencyKey: 'k1',
      expectedTotalPaise: 16800,
      lines: [{ recipientId: 'r1', serviceDate: '2026-08-13', menuItemId: 'm1', quantity: 2 }],
    });

    const body = invoke.mock.calls[0][1].body;
    expect(body.idempotency_key).toBe('k1');
    expect(body.expected_total_paise).toBe(16800);
    expect(body.lines).toEqual([
      { recipient_id: 'r1', service_date: '2026-08-13', menu_item_id: 'm1', quantity: 2, break_time_id: null },
    ]);
  });

  it('never sends a customer id — the server takes it from the JWT', async () => {
    // create_checkout runs as service_role and takes the customer id as a parameter, so a
    // body field the server trusted would let anyone order as anyone.
    const invoke = stub({ data: OK });
    await createCheckout({ idempotencyKey: 'k1', expectedTotalPaise: null, lines: [] });

    expect(JSON.stringify(invoke.mock.calls[0][1].body)).not.toMatch(/customer|user_id/i);
  });

  it('returns the orders in camelCase', async () => {
    stub({ data: OK });
    const result = await createCheckout({ idempotencyKey: 'k1', expectedTotalPaise: null, lines: [] });

    expect(result.orderGroupId).toBe('g1');
    expect(result.payablePaise).toBe(16800);
    expect(result.orders[0]?.orderRef).toBe('GB-ABC123');
  });

  it('reports a replay as a replay', async () => {
    // E05-12: the caller needs to tell "your order already exists" from "a new order was
    // created", because one of those is a success message and the other is a duplicate.
    stub({ data: { ...OK, replayed: true } });
    const result = await createCheckout({ idempotencyKey: 'k1', expectedTotalPaise: null, lines: [] });
    expect(result.replayed).toBe(true);
  });

  it('surfaces the refusal CODE, not a generic failure', async () => {
    // L7: price_changed must reach the screen as price_changed, because the app re-confirms
    // the new total rather than telling the customer to start again.
    stub({ error: refusal(409, { code: 'price_changed', message: 'The price changed.' }) });

    await expect(
      createCheckout({ idempotencyKey: 'k1', expectedTotalPaise: 100, lines: [] }),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'price_changed' });
  });

  it('surfaces cutoff_passed distinctly', async () => {
    stub({ error: refusal(409, { code: 'cutoff_passed', message: 'Ordering has closed.' }) });
    await expect(
      createCheckout({ idempotencyKey: 'k1', expectedTotalPaise: null, lines: [] }),
    ).rejects.toMatchObject({ code: 'cutoff_passed' });
  });

  it('does not invent a code when the server did not send one', async () => {
    stub({ error: refusal(500, { error: 'could not place the order' }) });
    const err = await createCheckout({ idempotencyKey: 'k1', expectedTotalPaise: null, lines: [] })
      .catch((e: ApiError) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBeUndefined();
  });

  it('survives a non-JSON error body rather than losing the failure', async () => {
    const error = new Error('network down') as Error & { context?: Response };
    error.context = new Response('<html>502</html>', { status: 502 });
    stub({ error });

    await expect(
      createCheckout({ idempotencyKey: 'k1', expectedTotalPaise: null, lines: [] }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
