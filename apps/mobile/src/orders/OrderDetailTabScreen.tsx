/**
 * Order detail, connected. `E06-34`.
 *
 * `OrderDetailScreen` was routed bare, so tapping an order showed a screen with no order on it —
 * and the invoice number, which this screen exists to surface, was reachable nowhere in the app
 * while the confirmation email said it was "available under Orders".
 *
 * Same standard as `OrdersTabScreen`: `fetchOrderDetail` **throws** on a failed read, so a blank
 * can only render over a read that succeeded (§5.21). "Not found" and "could not load" are
 * different facts and stay different — `null` is the first, a throw is the second.
 */
import { useCallback, useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { api, design, money } from '@graybag/shared';

import { Button, Sheet } from '../components';
import { OrderDetailScreen, type OrderDetail } from './OrderDetailScreen';

export function OrderDetailTabScreen({
  orderGroupId,
  onBackToMenu,
  onContactSupport,
  onResumePayment,
}: {
  orderGroupId: string;
  onBackToMenu?: () => void;
  onContactSupport?: () => void;
  /**
   * `E05-54`. Supplied by the navigator, which owns the checkout machinery — this screen knows
   * an order, not how to open a payment sheet.
   */
  onResumePayment?: (orderGroupId: string) => Promise<void>;
}) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [resuming, setResuming] = useState(false);
  /**
   * The server's refusal, in the server's words. **Not a generic "something went wrong"** —
   * `cancel-order` returns the same sentence the screen would have shown for that condition,
   * and the whole point of carrying it is that a parent who taps at the wrong second reads an
   * explanation rather than an error.
   */
  const [refusal, setRefusal] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const detail = await api.fetchOrderDetail(orderGroupId);
      setOrder(detail === null ? null : toScreen(detail));
      setState('ready');
    } catch {
      setState('error');
    }
  }, [orderGroupId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * `E06-45`. Confirm, then cancel, then **re-read**.
   *
   * The refetch is not a nicety. `cancel_order` also writes a refund row, and the screen shows
   * a refund notice keyed on it; reconstructing the new state on the client from the response
   * would be a second implementation of the status derivation that `0044` deliberately put in
   * one place. Re-reading costs one round trip on an action a parent takes once.
   */
  const cancel = useCallback(async () => {
    setCancelling(true);
    setRefusal(null);
    try {
      await api.cancelOrder(orderGroupId);
      setConfirming(false);
      await load();
    } catch (error) {
      setConfirming(false);
      // `ApiError.message` is the server's sentence for a 409. Anything else — an outage, a
      // 500 — has no sentence worth showing, so it falls back to one that does not blame the
      // parent or claim to know what happened.
      setRefusal(
        error instanceof Error && error.message
          ? error.message
          : 'We could not cancel this order. Please try again.',
      );
    } finally {
      setCancelling(false);
    }
  }, [orderGroupId, load]);

  return (
    <>
      <OrderDetailScreen
        order={order}
        state={state}
        cancelling={cancelling}
        resuming={resuming}
        /**
         * `E05-54`. Reopens the Razorpay sheet on the **same** provider order — the Edge
         * Function resumes the existing attempt rather than minting a second one, which is what
         * keeps a parent from being charged twice.
         *
         * Unlike cancelling, this takes no confirmation step: finishing a payment the parent
         * started is what they were already trying to do, and a confirmation in front of it
         * would be one more thing to dismiss.
         */
        onResumePayment={() => {
          setResuming(true);
          void (async () => {
            try {
              await onResumePayment?.(orderGroupId);
              await load();
            } finally {
              setResuming(false);
            }
          })();
        }}
        // The button opens the confirmation; it does not cancel. Cancelling is irreversible
        // for the parent — the kitchen's cutoff will have passed by the time they change
        // their mind — so it takes a deliberate second press (`M07`, and the same reasoning
        // as `AllergenConfirmation`).
        onCancel={() => setConfirming(true)}
        onRetry={() => void load()}
        {...(onBackToMenu ? { onBackToMenu } : {})}
        {...(onContactSupport ? { onContactSupport } : {})}
      />

      {refusal === null ? null : (
        <Text
          style={styles.refusal}
          accessibilityLiveRegion="polite"
          testID="order-detail-cancel-refusal"
        >
          {refusal}
        </Text>
      )}

      <CancelConfirmation
        visible={confirming}
        cancelling={cancelling}
        amountPaise={order?.totals.totalPaise ?? 0}
        onDismiss={() => setConfirming(false)}
        onConfirm={() => void cancel()}
      />
    </>
  );
}

/**
 * The second press. `E06-45`.
 *
 * **Dismissing is the safe outcome**, exactly as in `AllergenConfirmation`: the scrim, the back
 * gesture and "Keep my order" all do the same nothing, and cancelling needs a deliberate press
 * on a control that says what happens to the money.
 *
 * It states the refund **amount** and that it is a request, and it deliberately **does not state
 * a date**. The disbursement is manual in the Razorpay dashboard today, and `E06-33` is the open
 * task for a figure somebody has actually confirmed — the invented "5–7 working days" it exists
 * to replace is a sentence a parent plans around.
 */
export function CancelConfirmation({
  visible,
  cancelling,
  amountPaise,
  onDismiss,
  onConfirm,
  testID = 'order-detail-cancel-confirm',
}: {
  visible: boolean;
  cancelling: boolean;
  amountPaise: number;
  onDismiss: () => void;
  onConfirm: () => void;
  testID?: string;
}) {
  return (
    <Sheet visible={visible} onDismiss={onDismiss} title="Cancel this order?" testID={testID}>
      <Text style={styles.body} testID={`${testID}-body`}>
        {`We will cancel this order and start a refund of ${money.formatPaise(amountPaise)}. ` +
          'This cannot be undone — if you change your mind you will need to order again, and ' +
          'the kitchen may have closed for that day by then.'}
      </Text>
      <Text style={styles.note} testID={`${testID}-note`}>
        We will email you when the refund has been sent.
      </Text>
      <Button
        label="Cancel my order"
        onPress={onConfirm}
        loading={cancelling}
        testID={`${testID}-confirm`}
      />
      <Button
        label="Keep my order"
        variant="secondary"
        onPress={onDismiss}
        testID={`${testID}-dismiss`}
      />
    </Sheet>
  );
}

const { text, scale, space, layout } = design;

const styles = StyleSheet.create({
  body: {
    color: text.primary,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
    marginBottom: space[2],
  },
  note: {
    color: text.secondary,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
    marginBottom: space[3],
  },
  refusal: {
    color: text.secondary,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
    paddingHorizontal: layout.gutter,
    paddingBottom: space[3],
  },
});

/**
 * The server's shape into the screen's.
 *
 * **`totals` carries the server's own figures**, not a recomputation. This is a settled order and
 * its amounts are the amounts on the invoice; a client that re-derived them from the lines would
 * eventually disagree by a paise, which is a support ticket rather than a rounding curiosity.
 * The cart computes; the receipt reports.
 */
function toScreen(d: api.ApiOrderDetail): OrderDetail {
  const totals: money.GstBreakdown = {
    taxablePaise: d.subtotalPaise,
    cgstPaise: d.cgstPaise,
    sgstPaise: d.sgstPaise,
    totalPaise: d.totalPaise,
  };

  return {
    orderGroupId: d.orderGroupId,
    status: d.status,
    serviceDate: d.serviceDate,
    recipientName: d.recipientName,
    classLabel: d.classLabel,
    sectionLabel: d.sectionLabel,
    schoolName: d.schoolName,
    breakLabel: d.breakLabel,
    lines: d.lines,
    totals,
    pickupCode: d.pickupCode,
    placedAt: d.placedAt,
    paidAt: d.paidAt,
    preparingAt: d.preparingAt,
    deliveredAt: d.deliveredAt,
    /**
     * **The server's, passed through untouched.** `E06-42`.
     *
     * `cancellationClosesAt` is `cutoff_at − customer_cancellation_cutoff_minutes` resolved from
     * the order's own `config_snapshot` (`C9`) by a computed column in `0052`, so a kitchen
     * changing its cutoff tonight cannot move an order placed last week. `null` still means the
     * snapshot could not answer, and still renders as "we can't tell" rather than "you can".
     *
     * The `now` comparison in `cancelAvailability` is **advisory**, exactly as
     * `is_service_date_orderable` is: a device clock is not evidence, and the authoritative
     * check is `assert_cutoff_open` inside the cancellation transaction.
     */
    cancellationClosesAt: d.cancellationClosesAt,
    cancellationAllowed: d.cancellationAllowed,
    checkoutResumable: d.checkoutResumable,
    refund: 'none',
    invoiceNumber: d.invoiceNumber,
  };
}
