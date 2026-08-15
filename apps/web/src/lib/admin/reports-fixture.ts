/**
 * A report the a11y audit and a designer can open without a session — `E10-10`.
 *
 * Built through the real `summarise`, so the demo cannot drift from the arithmetic. The orders
 * below deliberately include a cancellation and a partial refund, because those are the two rows
 * whose treatment somebody will question when they read a real report — and a demo that only
 * shows clean orders never answers the question.
 */
import { api } from '@graybag/shared';

const order = (o: Record<string, unknown>) => ({
  status: 'paid',
  subtotal_paise: 10000,
  tax_cgst_paise: 250,
  tax_sgst_paise: 250,
  discount_paise: 0,
  total_paise: 10500,
  refunded_total_paise: 0,
  ...o,
});

const AMITY = { school_id: 'demo-1', school_name_snapshot: 'Amity International, Mohali' };
const GEM = { school_id: 'demo-2', school_name_snapshot: 'Gem Public School' };

const ORDERS = [
  // August — two schools, one cancellation, one partial refund.
  ...Array.from({ length: 34 }, () => order({ service_date: '2026-08-12', ...AMITY })),
  ...Array.from({ length: 18 }, () => order({ service_date: '2026-08-13', ...AMITY })),
  order({ service_date: '2026-08-13', ...AMITY, status: 'cancelled' }),
  order({ service_date: '2026-08-14', ...AMITY, refunded_total_paise: 2000 }),
  ...Array.from({ length: 22 }, () => order({ service_date: '2026-08-12', ...GEM })),
  // July, so the screen has more than one month to compare.
  ...Array.from({ length: 41 }, () => order({ service_date: '2026-07-15', ...AMITY })),
  ...Array.from({ length: 12 }, () => order({ service_date: '2026-07-15', ...GEM })),
];

export const REPORTS_FIXTURE = {
  rows: api.summarise(ORDERS),
  from: '2026-07-01',
  to: '2026-08-31',
};
