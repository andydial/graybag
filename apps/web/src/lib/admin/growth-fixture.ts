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
  schools: [
    { id: 'demo-s1', name: 'Amity International, Mohali' },
    { id: 'demo-s2', name: 'Gem Public School' },
    { id: 'demo-s3', name: 'Paragon Senior Secondary' },
  ],
  users: [
    { id: 'demo-u1', createdAt: '2026-08-04T09:12:00Z' },
    { id: 'demo-u2', createdAt: '2026-08-04T14:40:00Z' },
    { id: 'demo-u3', createdAt: '2026-08-05T06:05:00Z' },
    // A four-day gap. The line must go flat here, not skip it.
    { id: 'demo-u4', createdAt: '2026-08-10T11:30:00Z' },
    { id: 'demo-u5', createdAt: '2026-08-12T04:20:00Z' },
    { id: 'demo-u6', createdAt: '2026-08-12T05:00:00Z' },
    { id: 'demo-u7', createdAt: '2026-08-12T16:45:00Z' },
    { id: 'demo-u8', createdAt: '2026-08-17T08:00:00Z' },
    { id: 'demo-u9', createdAt: '2026-08-18T09:30:00Z' },
    { id: 'demo-u10', createdAt: '2026-08-18T18:10:00Z' },
    { id: 'demo-u11', createdAt: '2026-08-19T07:15:00Z' },
    { id: 'demo-u12', createdAt: '2026-08-20T05:40:00Z' },
  ],
  children: [
    { id: 'demo-c1', schoolId: 'demo-s1', createdAt: '2026-08-04T09:20:00Z' },
    // Sibling of demo-c1: one family, two children.
    { id: 'demo-c2', schoolId: 'demo-s1', createdAt: '2026-08-04T09:22:00Z' },
    { id: 'demo-c3', schoolId: 'demo-s1', createdAt: '2026-08-05T06:10:00Z' },
    { id: 'demo-c4', schoolId: 'demo-s1', createdAt: '2026-08-12T04:30:00Z' },
    { id: 'demo-c5', schoolId: 'demo-s2', createdAt: '2026-08-10T11:40:00Z' },
    { id: 'demo-c6', schoolId: 'demo-s2', createdAt: '2026-08-18T09:40:00Z' },
    { id: 'demo-c7', schoolId: 'demo-s2', createdAt: '2026-08-19T07:20:00Z' },
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
