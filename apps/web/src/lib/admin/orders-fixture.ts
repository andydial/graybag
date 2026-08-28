/**
 * An orders board somebody can open without a session — `E10-63`.
 *
 * ## Why this exists at all
 *
 * `/orders` reached production rendering as raw HTML, and the tool built to catch exactly that
 * could not see it: with no `?state=demo` fixture the route redirected to `/signin`, so
 * `parity-shot` photographed a sign-in page and measured a sign-in page. It then reported the
 * route as fine, because "not a shell page" was a pass.
 *
 * That branch now fails loudly, which turned the silent hole into a named one — and a named hole
 * is still a hole. This is the fix: the one route the whole episode was about becomes the one
 * route the tool cannot verify, otherwise.
 *
 * ## Shaped so the states worth seeing are all on screen
 *
 * A day where everything is `paid` demonstrates none of the arithmetic:
 *
 *   - a **cancelled** order, which is excluded from gross and counted separately (`totalsFor`)
 *   - a **partially refunded** order, so refunds are not only ever zero or whole
 *   - **two schools and two breaks**, which is what the grouping exists for
 *   - an order with **no break label**, which is a real row and must not render as an empty group
 *
 * Names are invented and obviously so. Real children's names are Tier P and never appear in a
 * fixture, a screenshot, or anything committed (non-negotiable #4).
 */
import type { api } from '@graybag/shared';

const order = (
  o: Partial<api.AdminOrder> & Pick<api.AdminOrder, 'id' | 'orderRef' | 'recipientName'>,
): api.AdminOrder => ({
  serviceDate: '2026-08-28',
  status: 'paid',
  schoolId: 'demo-s1',
  schoolName: 'Amity International, Mohali',
  kitchenId: 'demo-k1',
  breakLabel: 'First break',
  classLabel: '4',
  sectionLabel: 'B',
  subtotalPaise: 18_000,
  taxPaise: 900,
  discountPaise: 0,
  totalPaise: 18_900,
  refundedPaise: 0,
  ...o,
});

export const ORDERS_FIXTURE: api.AdminOrder[] = [
  order({ id: 'o-1', orderRef: 'GB-24001', recipientName: 'Demo Child One' }),
  order({
    id: 'o-2', orderRef: 'GB-24002', recipientName: 'Demo Child Two',
    status: 'delivered', classLabel: '6', sectionLabel: 'A',
    subtotalPaise: 24_000, taxPaise: 1_200, totalPaise: 25_200,
  }),
  order({
    id: 'o-3', orderRef: 'GB-24003', recipientName: 'Demo Child Three',
    breakLabel: 'Second break', classLabel: '2', sectionLabel: 'C',
    // Part of the order was refunded — one dish of three. Not a whole-order refund, because a
    // fixture where every refund is total never exercises the "gross, less refunds" line.
    refundedPaise: 6_000,
  }),
  order({
    id: 'o-4', orderRef: 'GB-24004', recipientName: 'Demo Child Four',
    status: 'cancelled', schoolId: 'demo-s2', schoolName: 'Gem Public School',
    breakLabel: 'First break', classLabel: '3', sectionLabel: 'A',
    subtotalPaise: 12_000, taxPaise: 600, totalPaise: 12_600,
  }),
  order({
    id: 'o-5', orderRef: 'GB-24005', recipientName: 'Demo Child Five',
    schoolId: 'demo-s2', schoolName: 'Gem Public School',
    // No break on the row. Legitimate — a school with a single service has nothing to label —
    // and it must not render as a heading with nothing under it.
    breakLabel: null, classLabel: '5', sectionLabel: 'B',
    subtotalPaise: 21_000, taxPaise: 1_050, totalPaise: 22_050,
  }),
];
