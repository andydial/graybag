/**
 * `E06-02`. The SDK boundary, tested by mocking the one native module — which is the whole reason
 * the boundary exists: nothing above this line is testable otherwise, because Jest cannot load a
 * native module.
 *
 * Two things are being asserted, and the second matters more than it looks:
 *
 * 1. every SDK outcome becomes a **value**, never a rejection;
 * 2. **nothing identifying a child leaves in the payload.** `E06-25` covers the server's outbound
 *    call. This is the other outbound path, and it is the one that looks like UI code.
 */
// `mock`-prefixed because `jest.mock`'s factory is hoisted above every other statement in the
// file, so it may only close over variables Jest can prove are initialised by then.
const mockOpen = jest.fn();

jest.mock('react-native-razorpay', () => ({
  __esModule: true,
  default: { open: (...args: unknown[]) => mockOpen(...args) },
}));

import { openRazorpayCheckout } from './razorpay';

const INPUT = {
  keyId: 'rzp_test_TNfDAVhpJ2a28K',
  providerOrderId: 'order_TPBr7ydDNITdB3',
  amountPaise: 21_000,
  currency: 'INR',
};

beforeEach(() => mockOpen.mockReset());

describe('what the sheet reports', () => {
  it('carries the payment id, order id and signature back for the server to verify', async () => {
    mockOpen.mockResolvedValue({
      razorpay_payment_id: 'pay_ABC',
      razorpay_order_id: 'order_TPBr7ydDNITdB3',
      razorpay_signature: 'sig',
    });

    const result = await openRazorpayCheckout(INPUT);
    expect(result).toEqual({
      outcome: 'reported_success',
      providerPaymentId: 'pay_ABC',
      providerOrderId: 'order_TPBr7ydDNITdB3',
      signature: 'sig',
    });
  });

  it('calls the outcome "reported_success" and not "paid"', async () => {
    // `R8`. The name is the guard: a screen destructuring `{ paid }` would write "paid" on the
    // strength of a handset's word, and the order is confirmed only when the webhook is verified
    // server-side (`E06-06`).
    mockOpen.mockResolvedValue({ razorpay_payment_id: 'pay_ABC' });
    const result = await openRazorpayCheckout(INPUT);
    expect(result.outcome).toBe('reported_success');
    expect(Object.keys(result)).not.toContain('paid');
  });

  it.each([
    ['top-level code', { code: 'payment_cancelled' }],
    ['nested code', { error: { code: 'payment_cancelled' } }],
    ['nested reason', { error: { reason: 'payment_cancelled' } }],
    ['only a description', { description: 'Payment Cancelled by user' }],
  ])('treats %s as a cancellation, not a failure', async (_label, thrown) => {
    // The SDK is inconsistent about where it puts the reason. Getting this wrong turns every
    // parent who backs out into a "payment failed" message — which tells them something untrue
    // about their money, at the moment they are most worried about it.
    mockOpen.mockRejectedValue(thrown);
    expect((await openRazorpayCheckout(INPUT)).outcome).toBe('cancelled');
  });

  it('treats a real decline as a failure and keeps the provider code', async () => {
    mockOpen.mockRejectedValue({ code: 'BAD_REQUEST_ERROR', description: 'card declined' });
    expect(await openRazorpayCheckout(INPUT)).toEqual({
      outcome: 'failed',
      providerCode: 'BAD_REQUEST_ERROR',
    });
  });

  it('never rejects, whatever the SDK throws', async () => {
    // A rejection at a call site that is mid-checkout is how an error boundary eats a payment and
    // leaves the parent on a blank screen with money possibly taken.
    for (const thrown of [new Error('boom'), null, undefined, 'a string', 42]) {
      mockOpen.mockRejectedValue(thrown);
      await expect(openRazorpayCheckout(INPUT)).resolves.toBeDefined();
    }
  });
});

describe('what leaves the handset', () => {
  const payloadFor = async (input: Parameters<typeof openRazorpayCheckout>[0]) => {
    mockOpen.mockResolvedValue({ razorpay_payment_id: 'pay_ABC' });
    await openRazorpayCheckout(input);
    // The LAST call, not the first. A test that calls this helper twice — the prefill one does,
    // to compare an address against its absence — would otherwise assert twice about the first
    // payload and pass while proving nothing about the second.
    return mockOpen.mock.calls.at(-1)?.[0] as Record<string, unknown>;
  };

  it('sends paise unchanged, with no conversion', async () => {
    // A `* 100` here charges a hundred times the price and the number looks plausible.
    expect((await payloadFor(INPUT)).amount).toBe(21_000);
  });

  it('describes the purchase generically, naming no child and no date', async () => {
    // "Lunch for Aarav, 15 Aug" is the obvious description, names a child to a payment
    // processor, and appears on a card statement.
    const description = String((await payloadFor(INPUT)).description);
    expect(description).toBe('School meal order');
    expect(description).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('prefills the account holder’s email only, and only when we hold one', async () => {
    const withEmail = await payloadFor({ ...INPUT, accountEmail: 'parent@example.com' });
    expect(withEmail.prefill).toEqual({ email: 'parent@example.com' });

    // `app_user.email` is nullable — Apple private-relay opt-out leaves it null (`0018`).
    expect((await payloadFor({ ...INPUT, accountEmail: null })).prefill).toEqual({});
  });

  it('sends no notes from the client at all', async () => {
    // The server already attached the only metadata permitted to travel (`E06-25`), where it is
    // checked before the send rather than trusted from a handset.
    expect((await payloadFor(INPUT)).notes).toBeUndefined();
  });

  it('the whole payload contains nothing that identifies a child — the sentinel', async () => {
    const payload = JSON.stringify(await payloadFor({ ...INPUT, accountEmail: 'parent@example.com' }));
    for (const forbidden of ['Aarav', 'Sharma', '5-B', 'peanut', 'Alpha Public School', '2026-08-15']) {
      expect(payload).not.toContain(forbidden);
    }
    // And positively: the only free text is the fixed description and our own business name.
    expect(payload).toContain('School meal order');
  });
});
