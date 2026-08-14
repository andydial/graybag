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
import { api, money } from '@graybag/shared';

import { OrderDetailScreen, type OrderDetail } from './OrderDetailScreen';

export function OrderDetailTabScreen({
  orderGroupId,
  onBackToMenu,
  onContactSupport,
}: {
  orderGroupId: string;
  onBackToMenu?: () => void;
  onContactSupport?: () => void;
}) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

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

  return (
    <OrderDetailScreen
      order={order}
      state={state}
      onRetry={() => void load()}
      {...(onBackToMenu ? { onBackToMenu } : {})}
      {...(onContactSupport ? { onContactSupport } : {})}
    />
  );
}

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
    refund: 'none',
    invoiceNumber: d.invoiceNumber,
  };
}
