/**
 * Place order → pay. `E06-02`, the client half's controller.
 *
 * Three server round trips and one native sheet, in a fixed order, with the failure of each one
 * meaning something different to a parent:
 *
 *   1. `createCheckout`      — prices and places the orders. **Not retryable**: a second call
 *                              with a new key is a second set of lunches.
 *   2. `createPaymentOrder`  — asks for a Razorpay order. **Retryable**, and numbered by
 *                              `begin_payment`, because a declined card means tapping Pay again.
 *   3. `openRazorpayCheckout` — the sheet. Its "success" is a handset's word (`R8`).
 *
 * This lives in a hook rather than in `RootNavigator` because the navigator is already the
 * longest file in the app and because the sequence is the part worth testing: the ordering, the
 * idempotency key's lifetime, and which failure leaves the cart intact.
 */
import { useCallback, useRef, useState } from 'react';

import { api } from '@graybag/shared';

import { openRazorpayCheckout, type RazorpaySheetResult } from './razorpay';

/**
 * One line per step, so a tap on a handset tells us which of three calls failed and why.
 *
 * Written because the first real tap produced no sheet, no order, nothing at Razorpay and no
 * message — and the only way to tell "the server refused" from "the SDK never opened" was to
 * reproduce the call by hand from a laptop. That is three rounds of hypotheses; this is one tap.
 *
 * **`[checkout]` prefix, and NO personal data**: no recipient id, no dish, no name, no email
 * (non-negotiable #4). Ids of our own rows and the server's own error codes only — which is
 * exactly what is needed to find the failure, and nothing that would matter if a log were shared.
 */
const log = (step: string, detail: Record<string, unknown> = {}) => {
  // eslint-disable-next-line no-console
  console.log(`[checkout] ${step}`, JSON.stringify(detail));
};

/**
 * Where the flow is, for the screen to render.
 *
 * `sheet_reported_success` is deliberately not called `paid`. It is the last thing this hook
 * knows, and it is not a confirmation — `E06-16` polling is what turns it into one.
 */
export type CheckoutPhase =
  | { kind: 'idle' }
  | { kind: 'placing' }
  | { kind: 'opening'; orderGroupId: string }
  | { kind: 'sheet_reported_success'; orderGroupId: string }
  | { kind: 'dismissed'; orderGroupId: string }
  | { kind: 'failed'; orderGroupId: string | null; message: string; code?: string };

export interface CheckoutInput {
  lines: api.CheckoutLine[];
  expectedTotalPaise: number | null;
  accountEmail?: string | null;
}

/**
 * Refusals from `create_checkout` and `begin_payment`, in the words a parent reads.
 *
 * Anything unmapped becomes the generic sentence — a database hint or a provider description can
 * carry ids and column names, and this text goes on a phone.
 */
const MESSAGES: Record<string, string> = {
  price_changed: 'Prices changed while you were ordering. Please check your cart.',
  amount_mismatch: 'Prices changed while you were ordering. Please check your cart.',
  already_paid: 'This order has already been paid.',
  not_payable: 'This order can no longer be paid.',
  nothing_payable: 'There is nothing to pay on this order.',
  cutoff_passed: 'Ordering has closed for one of these days.',
  not_authorized: 'Please sign in again.',
};

const GENERIC = 'Something went wrong. Your card has not been charged.';

/**
 * What survives between taps of Pay.
 *
 * Held in a ref by the hook and passed by value to `runCheckout`, so the sequence can be tested
 * as a plain async function with no React in the way — which is the part worth testing.
 */
export interface CheckoutSession {
  /**
   * **Generated once per cart, not once per attempt** (`E05-12`).
   *
   * This is the whole idempotency mechanism. A key regenerated on retry turns a timed-out
   * request into a second order — the parent sees a failure, taps Pay again, and two sets of
   * lunches are cooked. So it is created on the first tap and kept until the orders are actually
   * placed, after which the next tap is genuinely a new cart.
   */
  idempotencyKey: string | null;
  /**
   * The group from a completed `createCheckout`, kept so a retry after a declined card does not
   * place the orders again. `begin_payment` numbers the second attempt; the orders stay put.
   */
  placedGroupId: string | null;
}

export function newSession(): CheckoutSession {
  return { idempotencyKey: null, placedGroupId: null };
}

/**
 * The sequence. Mutates `session` so a retry reuses what it must.
 *
 * `onPhase` reports progress; the return value is the outcome. Both exist because the screen
 * needs the intermediate states and the caller needs the verdict.
 */
export async function runCheckout(
  session: CheckoutSession,
  input: CheckoutInput,
  onPhase: (phase: CheckoutPhase) => void = () => {},
): Promise<CheckoutPhase> {
  const setPhase = (p: CheckoutPhase) => onPhase(p);
  {
    setPhase({ kind: 'placing' });
    log('start', {
      lines: input.lines.length,
      expectedTotalPaise: input.expectedTotalPaise,
      reusingGroup: session.placedGroupId !== null,
    });

    let orderGroupId = session.placedGroupId;

    // ------------------------------------------------------------------ 1. place the orders
    if (orderGroupId === null) {
      if (session.idempotencyKey === null) {
        session.idempotencyKey = newIdempotencyKey();
      }
      try {
        const result = await api.createCheckout({
          idempotencyKey: session.idempotencyKey,
          expectedTotalPaise: input.expectedTotalPaise,
          lines: input.lines,
        });
        orderGroupId = result.orderGroupId;
        session.placedGroupId = orderGroupId;
        log('createCheckout ok', { orderGroupId, payablePaise: result.payablePaise });
      } catch (error) {
        const next = failure(error, null);
        log('createCheckout FAILED', { code: next.code ?? null, message: next.message });
        setPhase(next);
        return next;
      }
    }

    // ------------------------------------------------- 2. ask for a Razorpay order to pay against
    let providerOrder;
    try {
      providerOrder = await api.createPaymentOrder(orderGroupId);
      log('createPaymentOrder ok', {
        providerOrderId: providerOrder.providerOrderId,
        amountPaise: providerOrder.amountPaise,
        attemptNo: providerOrder.attemptNo,
      });
    } catch (error) {
      const next = failure(error, orderGroupId);
      log('createPaymentOrder FAILED', { code: next.code ?? null, message: next.message });
      setPhase(next);
      return next;
    }

    // ------------------------------------------------------------------------- 3. the sheet
    setPhase({ kind: 'opening', orderGroupId });
    log('opening sheet', { providerOrderId: providerOrder.providerOrderId });

    const sheet: RazorpaySheetResult = await openRazorpayCheckout({
      keyId: providerOrder.keyId,
      providerOrderId: providerOrder.providerOrderId,
      amountPaise: providerOrder.amountPaise,
      currency: providerOrder.currency,
      ...(input.accountEmail === undefined ? {} : { accountEmail: input.accountEmail }),
    });

    log('sheet closed', { outcome: sheet.outcome });

    if (sheet.outcome === 'cancelled') {
      // §10.2. The order stays unpaid and the cart is intact — tapping Pay again is attempt 2
      // against the same group, which is why `placedGroupId` is NOT cleared here.
      const next: CheckoutPhase = { kind: 'dismissed', orderGroupId };
      setPhase(next);
      return next;
    }

    if (sheet.outcome === 'failed') {
      const next: CheckoutPhase = {
        kind: 'failed',
        orderGroupId,
        message: 'That payment did not go through. You can try again.',
        ...(sheet.providerCode === undefined ? {} : { code: sheet.providerCode }),
      };
      setPhase(next);
      return next;
    }

    // The sheet said yes. That is all it means (`R8`).
    const next: CheckoutPhase = { kind: 'sheet_reported_success', orderGroupId };
    setPhase(next);
    return next;
  }
}

/** The React wrapper. All the logic is in `runCheckout`; this owns the state. */
export function useCheckout() {
  const [phase, setPhase] = useState<CheckoutPhase>({ kind: 'idle' });
  const session = useRef<CheckoutSession>(newSession());

  const reset = useCallback(() => {
    session.current = newSession();
    setPhase({ kind: 'idle' });
  }, []);

  const start = useCallback(
    (input: CheckoutInput) => runCheckout(session.current, input, setPhase),
    [],
  );

  return { phase, start, reset };
}

/** The failed variant, so callers can read `message` and `code` without re-narrowing. */
type CheckoutFailure = Extract<CheckoutPhase, { kind: 'failed' }>;

/** `ApiError`'s code, mapped; anything else is the generic sentence. */
function failure(error: unknown, orderGroupId: string | null): CheckoutFailure {
  const code = error instanceof api.ApiError ? error.code : undefined;
  const message = (code && MESSAGES[code]) || GENERIC;
  return {
    kind: 'failed',
    orderGroupId,
    message,
    ...(code === undefined ? {} : { code }),
  };
}

/**
 * A key unique to this cart.
 *
 * `crypto.randomUUID` is not reliably present on React Native's Hermes runtime, and a missing
 * global here would throw at the exact moment a parent taps Pay — so it is used only when it
 * exists, with a fallback that is unique enough for a per-cart key. This value never leaves the
 * device except as an idempotency header, and the server treats it as opaque.
 */
function newIdempotencyKey(): string {
  const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof globalCrypto?.randomUUID === 'function') return globalCrypto.randomUUID();
  return `cart-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
