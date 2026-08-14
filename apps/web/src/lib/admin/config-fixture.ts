/**
 * A configuration the a11y audit and a designer can open without a session — `E10-06`.
 *
 * `/admin/config?state=demo` renders this instead of reaching the backend, the same switch
 * `/kitchen` uses and for the same reason: without it `check:a11y` audits the sign-in redirect
 * rather than the page, and the screen it is meant to be checking is never seen.
 *
 * **It is built through the real resolver.** `resolveAll` runs on the fixture rows below rather
 * than the resolutions being written out by hand, so the demo cannot drift from the logic — and
 * a bug in the chain shows up here as a wrong provenance label rather than being papered over by
 * hand-written expectations.
 *
 * The shape is deliberately the interesting one rather than the tidy one: one setting overridden
 * at the school, one at the kitchen, one overridden at BOTH — which is the case whose "remove
 * override" reverts to the kitchen rather than to the platform, and the one most likely to be got
 * wrong.
 */
import { api } from '@graybag/shared';

const platform: Record<string, unknown> = {
  id: 1,
  order_cutoff_time: '00:00:00',
  order_cutoff_days_before: 0,
  service_days: [1, 2, 3, 4, 5, 6, 7],
  max_advance_order_days: 14,
  min_advance_order_days: 0,
  revenue_share_bps: 1000,
  customer_cancellation_allowed: true,
  customer_cancellation_cutoff_minutes: 0,
  timezone: 'Asia/Kolkata',
};

/** The kitchen shortens the ordering horizon and turns cancellation off. */
const kitchen: Record<string, unknown> = {
  kitchen_id: 'demo-kitchen',
  max_advance_order_days: 7,
  customer_cancellation_allowed: false,
  timezone: null,
};

/**
 * The school moves its cutoff, closes at the weekend, and shortens the horizon **again** on top
 * of the kitchen's. That last one is the row that proves the point: removing it reverts to the
 * kitchen's 7, not to the platform's 14.
 */
const school: Record<string, unknown> = {
  school_id: 'demo-school',
  order_cutoff_time: '11:00:00',
  service_days: [1, 2, 3, 4, 5],
  max_advance_order_days: 3,
};

const rows: api.ConfigRows = { platform, kitchen, school };

export const CONFIG_FIXTURE = {
  schools: [
    { id: 'demo-school', name: 'Amity International, Mohali' },
    { id: 'demo-school-2', name: 'Gem Public School' },
  ],
  view: {
    schoolId: 'demo-school',
    kitchenId: 'demo-kitchen',
    settings: api.resolveAll(rows),
    rows,
  } satisfies api.SchoolConfigView,
  breaks: [
    { id: 'demo-break-1', label: 'Morning break', startsAt: '10:40:00', endsAt: '11:15:00' },
    { id: 'demo-break-2', label: 'Lunch break', startsAt: '12:30:00', endsAt: '13:05:00' },
  ] satisfies api.BreakTime[],
};
