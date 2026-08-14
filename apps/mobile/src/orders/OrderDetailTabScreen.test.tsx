import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '@graybag/shared';

import { OrderDetailTabScreen } from './OrderDetailTabScreen';

/**
 * `E06-45`. Cancelling, connected.
 *
 * What is asserted here is the **wiring between the button and the money**, because everything
 * either side of it is covered elsewhere: `OrderDetailScreen.test.tsx` proves the affordance and
 * its three states, `cancel-order.test.ts` proves the call, and `cancel_order.test.sql` proves
 * the guards. What nothing else can prove is that pressing "Cancel this order" does not cancel
 * anything until a second, deliberate press — and that a refusal reaches the parent as the
 * server's own sentence.
 *
 * **Stubbed at the transport, not by mocking `@graybag/shared`.** The first version of this file
 * did the latter and every test failed with "`render` function has not been called", which is
 * what `@testing-library` reports when the render itself threw — the real cause was the module
 * mock, and it was invisible. Stubbing the transport also exercises `fetchOrderDetail` and
 * `cancelOrder` for real, including the column list and the "no customer id in the body" rule,
 * rather than replacing them with functions that cannot be wrong.
 */

/** `Sheet` reads `useSafeAreaInsets`; without a provider it throws inside render. */
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const ROW = {
  id: 'o-1',
  order_group_id: 'og-1',
  order_ref: 'GB-ABC123',
  service_date: '2099-08-12',
  recipient_name_snapshot: 'Aarav Dial',
  status: 'paid',
  total_paise: 16_276,
  subtotal_paise: 15_500,
  tax_cgst_paise: 388,
  tax_sgst_paise: 388,
  school_name_snapshot: 'Alpha Public School',
  class_label_snapshot: '5',
  section_label_snapshot: 'A',
  break_label_snapshot: 'Morning break',
  pickup_code: '4821',
  placed_at: '2026-08-10T09:00:00.000Z',
  confirmed_at: '2026-08-10T09:00:12.000Z',
  preparing_at: null,
  delivered_at: null,
  // Far in the future, so the affordance is offered regardless of the hour the suite runs
  // (`E05-49` — a test against the ambient clock passes 77% of the time and reads as flake).
  cancellation_closes_at: '2099-08-11T18:30:00.000Z',
  cancellation_allowed: true,
  order_line: [{ id: 1, dish_name_snapshot: 'Paneer Wrap', quantity: 1, unit_price_paise: 9_500 }],
  order_group: { invoice: [{ invoice_number: 'GB/26-27/000001' }] },
};

const CANCELLED = {
  order_group_id: 'og-1',
  status: 'cancelled',
  orders_cancelled: 1,
  refund_id: 'r1',
  refund_amount_paise: 16_276,
  refund_status: 'pending',
};

let reads = 0;
let invoke: jest.Mock;

/** A PostgREST-style refusal: `functions.invoke` returns an Error whose context is a Response. */
const refusal = (status: number, body: unknown) => {
  const error = new Error('Edge Function returned a non-2xx status code') as Error & {
    context?: Response;
  };
  error.context = new Response(JSON.stringify(body), { status });
  return { data: null, error };
};

const install = (cancelAnswer: unknown = { data: CANCELLED, error: null }) => {
  reads = 0;
  invoke = jest.fn().mockResolvedValue(cancelAnswer);

  const builder: Record<string, unknown> = {};
  for (const method of ['eq', 'is', 'lte', 'not', 'limit', 'order']) {
    builder[method] = () => builder;
  }
  builder.then = (onfulfilled: (r: unknown) => unknown) => {
    reads += 1;
    return Promise.resolve({ data: [ROW], error: null }).then(onfulfilled);
  };

  api.setApiTransport({
    from: () => ({ select: () => builder }),
    functions: { invoke },
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { user: { id: 'u1', email: null } } } }),
    },
  } as never);
};

afterEach(() => api.setApiTransport(null));

const setup = async (cancelAnswer?: unknown) => {
  install(cancelAnswer);
  const user = userEvent.setup();
  // **`await`.** `render` is async on RNTL v14 (`docs/learnings.md`, 2026-08-09), and without
  // it `screen` is unpopulated — which surfaces as "`render` function has not been called",
  // pointing at the assertion rather than at the missing await.
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <OrderDetailTabScreen orderGroupId="og-1" />
    </SafeAreaProvider>,
  );
  await screen.findByTestId('screen-order-detail-cancel');
  return user;
};

describe('cancelling, connected', () => {
  it('does NOT cancel on the first press — it asks', async () => {
    // The assertion that matters. Cancelling is irreversible for the parent: by the time they
    // change their mind the kitchen's cutoff will have passed. A single press that went
    // straight through would be the whole bug.
    const user = await setup();
    await user.press(screen.getByTestId('screen-order-detail-cancel'));

    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByTestId('order-detail-cancel-confirm-confirm')).toBeOnTheScreen();
  });

  it('cancels on the second, deliberate press', async () => {
    const user = await setup();
    await user.press(screen.getByTestId('screen-order-detail-cancel'));
    await user.press(screen.getByTestId('order-detail-cancel-confirm-confirm'));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'cancel-order',
        expect.objectContaining({ body: { order_group_id: 'og-1' } }),
      ),
    );
  });

  it('re-reads the order rather than reconstructing it', async () => {
    // `cancel_order` writes a refund row too, and the screen's refund notice is keyed on it.
    // Rebuilding the new state on the client would be a second implementation of the status
    // derivation `0044` deliberately put in one place.
    const user = await setup();
    expect(reads).toBe(1);

    await user.press(screen.getByTestId('screen-order-detail-cancel'));
    await user.press(screen.getByTestId('order-detail-cancel-confirm-confirm'));

    await waitFor(() => expect(reads).toBe(2));
  });

  it('dismissing keeps the order — the accident-shaped exit is the safe one', async () => {
    const user = await setup();
    await user.press(screen.getByTestId('screen-order-detail-cancel'));
    await user.press(screen.getByTestId('order-detail-cancel-confirm-dismiss'));

    expect(invoke).not.toHaveBeenCalled();
  });

  it('shows the server’s own sentence when it refuses', async () => {
    // A parent who taps one second past the boundary must read the explanation the screen
    // would have shown a moment later, not "something went wrong".
    const user = await setup(
      refusal(409, {
        code: 'cancellation_closed',
        message: 'Cancelling has closed for this order.',
      }),
    );
    await user.press(screen.getByTestId('screen-order-detail-cancel'));
    await user.press(screen.getByTestId('order-detail-cancel-confirm-confirm'));

    const shown = await screen.findByTestId('order-detail-cancel-refusal');
    expect(shown).toHaveTextContent('Cancelling has closed for this order.');
  });

  it('names the amount, and promises no date', async () => {
    // `E06-33`: the invented "5–7 working days" is a sentence a parent plans around, and the
    // disbursement is manual today. This asserts we do not reintroduce one here.
    const user = await setup();
    await user.press(screen.getByTestId('screen-order-detail-cancel'));

    const body = screen.getByTestId('order-detail-cancel-confirm-body');
    // A regex, not a string: `toHaveTextContent` compares a bare string against the WHOLE
    // content rather than as a substring.
    expect(body).toHaveTextContent(/₹162\.76/);
    expect(body).not.toHaveTextContent(/working days|business days/);
  });
});
