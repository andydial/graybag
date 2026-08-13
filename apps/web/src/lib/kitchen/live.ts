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
      const [orders, grants] = await Promise.all([
        api.fetchKitchenOrders(filters.serviceDate),
        api.fetchMyGrants(),
      ]);

      /**
       * The filter options come from the orders, not from a second round trip.
       *
       * Two reasons. A kitchen only ever wants to filter to something that is *in front of it* —
       * offering a school with no orders today is offering a guaranteed empty result. And the
       * snapshot columns are already on the row, so the alternative would be fetching `school`
       * and `break_time` to learn names the order already carries.
       */
      const schools = new Map<string, string>();
      const breaks = new Map<string, string>();
      for (const order of orders) {
        if (order.schoolId) schools.set(order.schoolId, order.schoolName);
        if (order.breakId) breaks.set(order.breakId, order.breakLabel ?? order.breakId);
      }

      return {
        serviceDate: filters.serviceDate,
        permissions: toPermissions(grants),
        orders,
        schools: [...schools].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
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
