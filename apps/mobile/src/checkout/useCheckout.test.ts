/**
 * `E06-02`. The sequence, and which failure leaves what intact.
 *
 * The assertions that earn their keep are the retry ones. A parent whose card is declined taps
 * Pay again, and the two ways to get that wrong both cost real money: regenerating the
 * idempotency key places a **second set of lunches**, and calling `createCheckout` again places
 * them even with the same key held.
 */
// All `mock`-prefixed: `jest.mock`'s factory is hoisted above every other statement, so it may
// only close over names Jest can prove are initialised by then. The error class is defined
// *inside* the factory for the same reason, and re-exported so tests can throw a real one.
const mockCreateCheckout = jest.fn();
const mockCreatePaymentOrder = jest.fn();
const mockOpenSheet = jest.fn();

jest.mock('@graybag/shared', () => {
  class MockApiError extends Error {
    // `| undefined` explicitly, matching the real `ApiError`: under exactOptionalPropertyTypes
    // an optional property and one that may hold undefined are different types, and this is
    // assigned in the constructor.
    code?: string | undefined;
    constructor(message: string, code?: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    api: {
      ApiError: MockApiError,
      createCheckout: (...a: unknown[]) => mockCreateCheckout(...a),
      createPaymentOrder: (...a: unknown[]) => mockCreatePaymentOrder(...a),
    },
  };
});

jest.mock('./razorpay', () => ({ openRazorpayCheckout: (...a: unknown[]) => mockOpenSheet(...a) }));

import { api } from '@graybag/shared';

import { newSession, runCheckout, type CheckoutSession } from './useCheckout';

/**
 * The sequence is tested as a plain async function rather than through `renderHook`, because the
 * logic worth asserting — the ordering, the key's lifetime, which failure leaves what intact — is
 * not React's. The hook is a five-line wrapper over this.
 */
let session: CheckoutSession;

const LINES = [
  { recipientId: 'r1', serviceDate: '2026-08-20', menuItemId: 'm1', quantity: 1, breakTimeId: 'b1' },
];
const INPUT = { lines: LINES, expectedTotalPaise: 21_000 };

const ORDER = {
  keyId: 'rzp_test_x',
  providerOrderId: 'order_1',
  amountPaise: 21_000,
  currency: 'INR',
  orderGroupId: 'g1',
  correlationId: 'c1',
  attemptNo: 1,
};

beforeEach(() => {
  session = newSession();
  mockCreateCheckout.mockReset().mockResolvedValue({ orderGroupId: 'g1' });
  mockCreatePaymentOrder.mockReset().mockResolvedValue(ORDER);
  mockOpenSheet.mockReset().mockResolvedValue({
    outcome: 'reported_success',
    providerPaymentId: 'pay_1',
    providerOrderId: 'order_1',
    signature: 'sig',
  });
});

describe('the happy path', () => {
  it('places, asks for a provider order, then opens the sheet — in that order', async () => {
    const outcome = await runCheckout(session, INPUT);

    expect(mockCreateCheckout).toHaveBeenCalledTimes(1);
    expect(mockCreatePaymentOrder).toHaveBeenCalledWith('g1');
    expect(mockOpenSheet).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: 'sheet_reported_success', orderGroupId: 'g1' });
  });

  it('sends the shown total so the server can refuse, and paise unconverted', async () => {
    // `L7`. It is sent so the server CAN disagree, never so it can be believed.
    await runCheckout(session, INPUT);
    expect(mockCreateCheckout.mock.calls[0][0].expectedTotalPaise).toBe(21_000);
  });

  it('never reports the sheet as paid', async () => {
    // `R8` — the phase name is the guard. Confirmation is `E06-16`'s job.
    const outcome = await runCheckout(session, INPUT);
    expect(outcome.kind).toBe('sheet_reported_success');
    expect(JSON.stringify(outcome)).not.toContain('paid');
  });
});

describe('a retry after the parent is bounced back', () => {
  it('does NOT place the orders again — the same group is paid a second time', async () => {
    mockOpenSheet.mockResolvedValueOnce({ outcome: 'cancelled' });
    const first = await runCheckout(session, INPUT);
    expect(first.kind).toBe('dismissed');

    await runCheckout(session, INPUT);

    // The whole point: one checkout, two payment attempts.
    expect(mockCreateCheckout).toHaveBeenCalledTimes(1);
    expect(mockCreatePaymentOrder).toHaveBeenCalledTimes(2);
  });

  it('reuses the idempotency key while a cart is unplaced', async () => {
    // A key regenerated on retry turns a timed-out request into a second set of lunches.
    mockCreateCheckout.mockRejectedValueOnce(new api.ApiError('boom'));
    await runCheckout(session, INPUT);
    await runCheckout(session, INPUT);

    const first = mockCreateCheckout.mock.calls[0][0].idempotencyKey;
    const second = mockCreateCheckout.mock.calls[1][0].idempotencyKey;
    expect(first).toBe(second);
    expect(first).toBeTruthy();
  });

  it('takes a fresh key after reset, because that is genuinely a new cart', async () => {
    await runCheckout(session, INPUT);
    session = newSession();
    await runCheckout(session, INPUT);

    expect(mockCreateCheckout.mock.calls[0][0].idempotencyKey).not.toBe(
      mockCreateCheckout.mock.calls[1][0].idempotencyKey,
    );
  });
});

describe('failures say different things', () => {
  it('turns a price change into words a parent can act on', async () => {
    mockCreateCheckout.mockRejectedValueOnce(new api.ApiError('nope', 'price_changed'));
    const outcome = await runCheckout(session, INPUT);
    expect(outcome).toMatchObject({ kind: 'failed', code: 'price_changed' });
    expect((outcome as { message: string }).message).toMatch(/Prices changed/);
  });

  it('does not echo an unmapped server message to a phone', async () => {
    // A database hint carries ids and column names.
    mockCreateCheckout.mockRejectedValueOnce(new api.ApiError('column "x" of relation "y"', 'weird_code'));
    const outcome = await runCheckout(session, INPUT);
    expect((outcome as { message: string }).message).not.toMatch(/relation/);
    expect((outcome as { message: string }).message).toMatch(/has not been charged/);
  });

  it('never opens a sheet when the order could not be placed', async () => {
    mockCreateCheckout.mockRejectedValueOnce(new api.ApiError('nope', 'cutoff_passed'));
    await runCheckout(session, INPUT);
    expect(mockOpenSheet).not.toHaveBeenCalled();
  });

  it('distinguishes a dismissal from a decline', async () => {
    // Telling a parent their payment failed when they changed their mind is a lie about money.
    mockOpenSheet.mockResolvedValueOnce({ outcome: 'cancelled' });
    expect((await runCheckout(session, INPUT)).kind).toBe('dismissed');

    mockOpenSheet.mockResolvedValueOnce({ outcome: 'failed', providerCode: 'BAD_REQUEST_ERROR' });
    expect(await runCheckout(session, INPUT)).toMatchObject({
      kind: 'failed',
      code: 'BAD_REQUEST_ERROR',
    });
  });
});
