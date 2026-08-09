/**
 * Ordering (`E05`) — the rules that sit between a cart and an order.
 *
 * Pure, like `menu/` and `cart/`: no fetching and no Supabase, so the app, the endpoints and
 * the checkout transaction can all hold the same implementation of rules that must not
 * diverge between them.
 */

export {
  CALENDAR_MAX_AGE_SECONDS,
  CALENDAR_MAX_RANGE_DAYS,
  orderCalendarResponse,
  parseCalendarRequest,
} from './calendar-endpoint.js';

export type { CalendarRequest, CalendarResponse, CalendarRow } from './calendar-endpoint.js';
