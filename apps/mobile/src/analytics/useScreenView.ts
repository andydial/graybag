import { useEffect } from 'react';

import { track } from './analytics';

/**
 * Emit `screen_viewed` once, on mount. `E15-21`.
 *
 * ## Why some screens need this and most do not
 *
 * `RootNavigator` listens to navigation state and emits for every route, which covers the
 * fourteen screens a parent reaches by navigating. **Five screens are not routes.** They are
 * rendered conditionally — payment waiting and order placed are states of the checkout flow,
 * update-required and can't-connect are gates rendered above the whole app, and the school
 * picker replaces the menu's body until a school is chosen. Nothing in the navigator will ever
 * report them, so they report themselves.
 *
 * Those five matter disproportionately. `payment_waiting` is the screen a parent is looking at
 * when their money is in flight and they are deciding whether to give up, and `cant_connect` is
 * the one that ends a session for reasons that have nothing to do with wanting lunch. A path
 * that skipped them would show a parent reaching checkout and simply stopping, with the reason
 * missing from exactly the rows that explain it.
 *
 * ## Empty dependency array on purpose
 *
 * One event per mount, not one per render. The waiting screen re-renders on every poll of
 * `checkout-status` — a dependency on the screen name would be harmless, but leaving the array
 * empty says plainly that remounting is the thing being counted.
 */
export function useScreenView(screen: string): void {
  useEffect(() => {
    track('screen_viewed', { screen });
  }, []); // eslint-disable-line -- one event per mount; see above
}
