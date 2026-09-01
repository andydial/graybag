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
  nextOrderableDate,
  offerableDays,
  orderCalendarResponse,
  parseCalendarRequest,
} from './calendar-endpoint.js';

export type {
  CalendarRequest,
  CalendarResponse,
  CalendarRow,
  OrderableDayView,
} from './calendar-endpoint.js';

// Break / drop time selection (E05-06). The class-group rule is the schema's, not this
// module's: no `break_time_class` rows means the break applies to every class.
export { defaultBreakTime, selectableBreakTimes } from './break-times.js';
export type { BreakTime } from './break-times.js';
