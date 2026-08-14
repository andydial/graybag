/**
 * The Orders screen, connected. `E06-40`.
 *
 * `OrdersScreen` was built with every state it needs — loading, ready, error, stale, signed out —
 * and **nothing ever passed it any of them**. Its own header said `api/` had no read yet. So a
 * parent with three settled orders, three invoices and a balanced ledger saw "no orders yet", and
 * the confirmation email told them their invoice was waiting in the app.
 *
 * This file is the wire. It holds no presentation: the screen already knows how to render every
 * outcome, and duplicating any of that here would give the app two answers to the same question.
 *
 * # The distinction this exists to preserve
 *
 * **An empty list and a failed read are different facts** (§5.21). `fetchOrders` throws rather
 * than returning `[]`, and this maps a throw to `state="error"` — so "no orders yet" can only be
 * rendered over a read that actually succeeded and actually found nothing.
 *
 * That was already unreachable rather than wrong: the screen's `error` branch existed and no
 * caller could produce it.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@graybag/shared';

import { accessOf, useAudience } from '../session/audience';
import { OrdersScreen, type OrderSummary } from './OrdersScreen';

export function OrdersTabScreen({
  onSelectOrder,
  onSignIn,
  onBrowseMenu,
}: {
  onSelectOrder?: (orderGroupId: string) => void;
  onSignIn?: () => void;
  onBrowseMenu?: () => void;
}) {
  const audience = useAudience();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const rows = await api.fetchOrders();
      setOrders(
        rows.map((row) => ({
          orderGroupId: row.orderGroupId,
          serviceDate: row.serviceDate,
          recipientName: row.recipientName,
          itemCount: row.itemCount,
          totalPaise: row.totalPaise,
          status: row.status,
        })),
      );
      setState('ready');
    } catch {
      // Deliberately not `setOrders([])`. A failed read must not be able to present as an empty
      // list, which is the whole of §5.21 — and the reason the screen takes a `state` at all.
      setState('error');
    }
  }, []);

  /**
   * Re-read whenever the audience changes, which covers the case that matters: a parent signs in
   * on the cart's gate, pays, and lands here. Signing out clears the list rather than leaving
   * another session's orders on screen.
   */
  useEffect(() => {
    if (audience.kind === 'unknown') return;
    if (audience.kind === 'visitor') {
      setOrders([]);
      setState('ready');
      return;
    }
    void load();
  }, [audience.kind, load]);

  return (
    <OrdersScreen
      orders={orders}
      state={state}
      access={accessOf(audience)}
      onRetry={() => void load()}
      {...(onSelectOrder ? { onSelectOrder } : {})}
      {...(onSignIn ? { onSignIn } : {})}
      {...(onBrowseMenu ? { onBrowseMenu } : {})}
    />
  );
}
