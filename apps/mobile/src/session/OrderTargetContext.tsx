import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { menu as menuDomain } from '@graybag/shared';

/**
 * Who a lunch is being ordered for, and for which day.
 *
 * **Separate from `SessionContext` and from `SelectedSchoolContext`, for the same reason
 * they are separate from each other** (`AR7`): browsing must work before any of this is
 * known. A dish detail screen renders identically with a target and without one — the target
 * only decides whether a line can be *added*, because a cart line is identified by who and
 * when as well as what (`lineKey`).
 *
 * **`null` is the ordinary state today**, not a bug. Nothing in the app can name a child yet
 * — `E05-16` is the task, and `E05-01`/`E05-03` are what fill this in. The default context
 * value is `null` so a screen written against this seam behaves correctly before that lands
 * rather than after it, and so a provider is not required in order to render.
 *
 * ## The allergen ids are regulated data
 *
 * `allergenIds` is health data about a minor under the DPDP Act (non-negotiable #4). It is
 * held here so the add-to-cart warning (`D7`, `E05-05`) can be computed on the device
 * without a request. It must never be logged, never sent to Sentry or analytics, and never
 * appear in an error message — which is why nothing in this module or its consumers prints
 * it, including in the sheet, which names the *dish's* allergens rather than the child's.
 */
export interface OrderTarget {
  recipientId: string;
  /** The recipient's declared allergen ids. Regulated: see above. */
  allergenIds: readonly string[];
  serviceDate: menuDomain.ServiceDate;
}

interface OrderTargetValue {
  target: OrderTarget | null;
  setTarget: (next: OrderTarget | null) => void;
}

const OrderTargetContext = createContext<OrderTargetValue>({
  target: null,
  setTarget: () => {},
});

export function OrderTargetProvider({
  children,
  initial = null,
}: {
  children: ReactNode;
  initial?: OrderTarget | null;
}) {
  const [target, setTarget] = useState<OrderTarget | null>(initial);
  const value = useMemo(() => ({ target, setTarget }), [target]);
  return <OrderTargetContext.Provider value={value}>{children}</OrderTargetContext.Provider>;
}

export function useOrderTarget(): OrderTargetValue {
  return useContext(OrderTargetContext);
}
