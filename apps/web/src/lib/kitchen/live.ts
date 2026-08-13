import { api } from '@graybag/shared';

import { configureBackofficeApi } from '../backoffice/session.js';
import type { KitchenDay, KitchenFilters, KitchenPermissions, KitchenTransport } from './types.js';

/**
 * The kitchen dashboard against real data (`E09-17`).
 *
 * Everything here delegates to `packages/shared/src/api/kitchen.ts`, so this file holds no query
 * and no `fetch` — it maps between the `api/` module's shape and the screen's, and nothing else.
 * That is the point of `A4`: the one place that knows the backend exists stays one place.
 */

/** Grant codes → the three booleans the screen draws from. */
function toPermissions(grants: string[]): KitchenPermissions {
  const held = new Set(grants);
  return {
    viewOrders: held.has('orders.view'),
    markDelivered: held.has('orders.mark_delivered'),
    cancelOrders: held.has('orders.cancel'),
  };
}

export function liveTransport(): KitchenTransport {
  return {
    async load(filters: KitchenFilters): Promise<KitchenDay> {
      configureBackofficeApi();

      // Both reads together: the grants decide which controls exist, and a screen that renders
      // the list before it knows would flash buttons the operator may not use.
      const [orders, grants, schools] = await Promise.all([
        api.fetchKitchenOrders(filters.serviceDate),
        api.fetchMyGrants(),
        api.fetchKitchenSchools(),
      ]);

      /**
       * Schools come from the `school` table; breaks still come from the orders.
       *
       * **Schools were derived from the orders too, and that was wrong** (Andy, 2026-08-13). The
       * filter then appeared and disappeared with the day's data — a school that ordered nothing
       * vanished from the control, and a day with a single school showed no filter at all, so an
       * operator could not tell whether they were seeing every school or one of several. Which
       * schools a kitchen serves is a property of the kitchen, not of a Tuesday. Selecting one
       * with no orders is a legitimate and useful answer: "they ordered nothing today."
       *
       * Breaks stay derived. A break is genuinely a property of the day's orders — the label is
       * already snapshotted on the row, so reading `break_time` would be a round trip to learn a
       * name we are holding.
       */
      const breaks = new Map<string, string>();
      for (const order of orders) {
        if (order.breakId) breaks.set(order.breakId, order.breakLabel ?? order.breakId);
      }

      return {
        serviceDate: filters.serviceDate,
        permissions: toPermissions(grants),
        orders,
        schools,
        breaks: [...breaks].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
        // The moment the data was read, not the moment it is rendered. The offline banner quotes
        // this verbatim and must never be able to say "just now" about a list from 07:12.
        loadedAt: new Date().toISOString(),
      };
    },

    async updateStatus(input) {
      configureBackofficeApi();
      const result = await api.updateKitchenOrderStatus(input);
      // `skipped` is orders already in the target state — a success, not a failure. Folding it
      // into `updated` keeps the screen's optimistic state and the server's agreeing, which is
      // the whole point of the endpoint being idempotent.
      return { updated: [...result.updated, ...result.skipped] };
    },
  };
}
