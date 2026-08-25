/**
 * The demo state for `/admin/sales` — `E11-12`.
 *
 * Built through the real `summarise`, so the demo cannot drift from the arithmetic.
 *
 * Shaped to show the cases the screen exists for, because `check:a11y` walks it:
 *
 * - **evening orders**, placed after 18:30 UTC, so the IST bucketing is visible rather than
 *   assumed — this is the fixture's main job;
 * - **one spike**, so "a large order day" is a thing you can see;
 * - **quiet days**, so growth is not a straight line;
 * - unpaid and cancelled orders, so the money columns disagree with the order count on purpose;
 * - a previous window that is smaller, so every headline shows a real percentage rather than
 *   "nothing before".
 */
import { api } from '@graybag/shared';

const AMITY = { school_id: 'demo-1', school_name_snapshot: 'Amity International, Mohali' };
const GEM = { school_id: 'demo-2', school_name_snapshot: 'Gem Public School' };

const order = (placedAt: string, o: Record<string, unknown> = {}) => ({
  status: 'paid',
  service_date: '2026-08-26',
  placed_at: placedAt,
  subtotal_paise: 12000, tax_cgst_paise: 300, tax_sgst_paise: 300,
  discount_paise: 0, total_paise: 12600, refunded_total_paise: 0,
  ...AMITY, ...o,
});

/** `n` orders placed at 21:00 IST — 15:30 UTC — on the given IST day. */
const evening = (istDay: string, n: number, o: Record<string, unknown> = {}) =>
  Array.from({ length: n }, () => order(`${istDay}T15:30:00Z`, o));

/** Placed at 11:30pm IST, which is the previous day in UTC. The case that must not be mis-bucketed. */
const lateNight = (istDay: string, n: number, o: Record<string, unknown> = {}) => {
  const prev = new Date(Date.parse(`${istDay}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return Array.from({ length: n }, () => order(`${prev}T18:00:00Z`, o));
};

const CURRENT = [
  ...evening('2026-08-17', 4), ...lateNight('2026-08-17', 2, GEM),
  ...evening('2026-08-18', 6), ...lateNight('2026-08-18', 3),
  ...evening('2026-08-19', 3, GEM),
  // The spike — the day worth noticing.
  ...evening('2026-08-20', 19), ...lateNight('2026-08-20', 7, GEM),
  ...evening('2026-08-21', 5, { status: 'pending_payment' }),
  ...evening('2026-08-22', 8), ...evening('2026-08-22', 1, { status: 'cancelled' }),
  // A quiet weekend, so the line is not a straight climb.
  ...evening('2026-08-24', 2),
];

const PREVIOUS = [
  ...evening('2026-08-10', 3), ...evening('2026-08-11', 4, GEM),
  ...evening('2026-08-13', 5), ...evening('2026-08-15', 2),
];

/** Codes for the axis labels, as `/admin/sales` reads them from `school.code` in production. */
const SCHOOL_CODES: [string, string][] = [['demo-1', 'amity'], ['demo-2', 'gem']];

export const SALES_FIXTURE = {
  schoolCodes: SCHOOL_CODES,
  rows: api.summarise(CURRENT),
  previous: api.summarise(PREVIOUS),
  from: '2026-08-17',
  to: '2026-08-24',
};
