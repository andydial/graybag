/**
 * The demo state for `/admin/growth` — `E11-08`.
 *
 * Shaped to make the screen show every case it has to handle, because `check:a11y` walks this and
 * a fixture that renders a happy path audits a page nobody sees:
 *
 * - **quiet days between busy ones**, so the gap-filling is visible rather than assumed;
 * - a **school with nobody at it**, which is the most actionable row the table can carry;
 * - **two siblings at one school**, so the family count and the child count disagree on purpose;
 * - **a second guardian** on one child, so the family count is not just the account count;
 * - **accounts with no child**, which is the conversion gap `AR7` cares about.
 *
 * Every id is obviously synthetic. No name here belongs to anybody, and no child appears at all —
 * children are ids and a school, which is all the report ever reads.
 */
export const GROWTH_FIXTURE = {
  today: '2026-08-20',
  /*
   * **School ids match `REPORTS_FIXTURE`** — `E11-22`.
   *
   * They did not, and the cost showed up the moment both screens read these orders: Growth's
   * "ordered at least once" column joined `demo-1` orders against `demo-s1` schools, found
   * nothing, and rendered a dash in every row. A dash is indistinguishable from "no school has
   * had an order", which is a real state and would have been believed.
   *
   * Two fixtures describing one product must agree on its identifiers, or the demo teaches
   * people something false about a screen that is working.
   */
  schools: [
    { id: 'demo-1', name: 'Amity International, Mohali' },
    { id: 'demo-2', name: 'Gem Public School' },
    { id: 'demo-3', name: 'Paragon Senior Secondary' },
  ],
  users: [
    { id: 'demo-u1', email: 'parent1@example.invalid', createdAt: '2026-08-04T09:12:00Z' },
    { id: 'demo-u2', email: 'parent2@example.invalid', createdAt: '2026-08-04T14:40:00Z' },
    { id: 'demo-u3', email: 'parent3@example.invalid', createdAt: '2026-08-05T06:05:00Z' },
    // A four-day gap. The line must go flat here, not skip it.
    { id: 'demo-u4', email: 'parent4@example.invalid', createdAt: '2026-08-10T11:30:00Z' },
    { id: 'demo-u5', email: 'parent5@example.invalid', createdAt: '2026-08-12T04:20:00Z' },
    { id: 'demo-u6', email: 'parent6@example.invalid', createdAt: '2026-08-12T05:00:00Z' },
    { id: 'demo-u7', email: 'parent7@example.invalid', createdAt: '2026-08-12T16:45:00Z' },
    { id: 'demo-u8', email: 'parent8@example.invalid', createdAt: '2026-08-17T08:00:00Z' },
    { id: 'demo-u9', email: 'parent9@example.invalid', createdAt: '2026-08-18T09:30:00Z' },
    { id: 'demo-u10', email: 'parent10@example.invalid', createdAt: '2026-08-18T18:10:00Z' },
    { id: 'demo-u11', email: 'parent11@example.invalid', createdAt: '2026-08-19T07:15:00Z' },
    { id: 'demo-u12', email: 'parent12@example.invalid', createdAt: '2026-08-20T05:40:00Z' },
  ],
  children: [
    { id: 'demo-c1', schoolId: 'demo-1', createdAt: '2026-08-04T09:20:00Z' },
    // Sibling of demo-c1: one family, two children.
    { id: 'demo-c2', schoolId: 'demo-1', createdAt: '2026-08-04T09:22:00Z' },
    { id: 'demo-c3', schoolId: 'demo-1', createdAt: '2026-08-05T06:10:00Z' },
    { id: 'demo-c4', schoolId: 'demo-1', createdAt: '2026-08-12T04:30:00Z' },
    { id: 'demo-c5', schoolId: 'demo-2', createdAt: '2026-08-10T11:40:00Z' },
    { id: 'demo-c6', schoolId: 'demo-2', createdAt: '2026-08-18T09:40:00Z' },
    { id: 'demo-c7', schoolId: 'demo-2', createdAt: '2026-08-19T07:20:00Z' },
  ],
  /**
   * Paid orders, for the funnel — `E11-15`.
   *
   * Shaped so every step of the funnel loses somebody, because a demo where nobody drops out
   * shows none of the arithmetic the screen exists for: 8 registered with a child, 4 of those
   * ordered, 2 of those ordered twice, and one of the repeat orders is recent enough to count as
   * active.
   */
  /*
   * `serviceDate` and `schoolId` are on every row from `E11-17`, because Reports now draws its
   * usage block from these orders and buckets on the service date. The school ids are the ones
   * `REPORTS_FIXTURE` uses — a demo whose two halves name different schools shows a per-school
   * table with an empty column, which is exactly the bug the real screen must not have.
   */
  orders: [
    { customerUserId: 'demo-u1', placedAt: '2026-08-06T09:00:00Z', serviceDate: '2026-08-12', schoolId: 'demo-1', status: 'delivered', totalPaise: 12600 },
    { customerUserId: 'demo-u1', placedAt: '2026-08-19T09:00:00Z', serviceDate: '2026-08-15', schoolId: 'demo-1', status: 'paid', totalPaise: 12600 },
    { customerUserId: 'demo-u2', placedAt: '2026-08-12T09:00:00Z', serviceDate: '2026-08-13', schoolId: 'demo-1', status: 'delivered', totalPaise: 10500 },
    { customerUserId: 'demo-u3', placedAt: '2026-08-13T09:00:00Z', serviceDate: '2026-08-13', schoolId: 'demo-2', status: 'delivered', totalPaise: 14000 },
    { customerUserId: 'demo-u3', placedAt: '2026-08-18T09:00:00Z', serviceDate: '2026-08-18', schoolId: 'demo-2', status: 'paid', totalPaise: 14000 },
    { customerUserId: 'demo-u5', placedAt: '2026-08-20T09:00:00Z', serviceDate: '2026-08-17', schoolId: 'demo-1', status: 'paid', totalPaise: 9800 },
    // Unpaid — reached checkout and never bought. Must NOT count as a conversion, and must not
    // appear in usage either: an unpaid order is not a parent using us.
    { customerUserId: 'demo-u9', placedAt: '2026-08-19T09:00:00Z', serviceDate: '2026-08-17', schoolId: 'demo-1', status: 'pending_payment', totalPaise: 11000 },
  ],
  links: [
    { userId: 'demo-u1', recipientId: 'demo-c1' },
    { userId: 'demo-u1', recipientId: 'demo-c2' },
    // A second guardian on the first child — the family count must not be the account count.
    { userId: 'demo-u2', recipientId: 'demo-c1' },
    { userId: 'demo-u3', recipientId: 'demo-c3' },
    { userId: 'demo-u5', recipientId: 'demo-c4' },
    { userId: 'demo-u4', recipientId: 'demo-c5' },
    { userId: 'demo-u9', recipientId: 'demo-c6' },
    { userId: 'demo-u11', recipientId: 'demo-c7' },
    // demo-u6, u7, u8, u10, u12 have no child: signed up and stopped.
  ],
} as const;
