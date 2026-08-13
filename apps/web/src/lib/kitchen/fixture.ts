import type {
  KitchenAction,
  KitchenDay,
  KitchenFilters,
  KitchenOrder,
  KitchenPermissions,
  KitchenStatus,
  KitchenTransport,
} from './types.js';

/**
 * A fixture transport: the same day `tools/seed-kitchen-day` writes, generated in code.
 *
 * **Generated rather than captured from a database**, so the dashboard and its tests need no
 * stack of any kind. That is not only convenience — the local Supabase stack is shared between
 * worktrees, and a screen whose tests depend on rows somebody else can delete is a screen whose
 * tests fail for reasons that have nothing to do with it.
 *
 * The shape mirrors the seed deliberately: 24 children, three classes, two breaks, and the same
 * status mix, so what is reviewed here is what appears against staging.
 */

const CHILDREN: [string, string][] = [
  ['Aarav', 'Sharma'], ['Diya', 'Verma'], ['Vivaan', 'Gupta'], ['Anaya', 'Singh'],
  ['Advik', 'Kapoor'], ['Myra', 'Bansal'], ['Reyansh', 'Mehta'], ['Aadhya', 'Chopra'],
  ['Kabir', 'Malhotra'], ['Saanvi', 'Joshi'], ['Ishaan', 'Nair'], ['Kiara', 'Reddy'],
  ['Arjun', 'Iyer'], ['Navya', 'Rao'], ['Rudra', 'Bhatia'], ['Prisha', 'Sethi'],
  ['Atharv', 'Khanna'], ['Ira', 'Bedi'], ['Shaurya', 'Grewal'], ['Amaira', 'Sodhi'],
  ['Dhruv', 'Ahluwalia'], ['Riya', 'Dhillon'], ['Veer', 'Sandhu'], ['Tara', 'Bajwa'],
];

const CLASSES = [
  { label: '5', section: 'A' },
  { label: '5', section: 'B' },
  { label: '6', section: 'A' },
];

const BREAKS = [
  { id: 'b7000000-0000-0000-0000-000000000001', label: 'Morning break' },
  { id: 'b7000000-0000-0000-0000-000000000002', label: 'Lunch break' },
];

const DISHES = [
  { id: 'd1', name: 'Veg Sandwich' },
  { id: 'd2', name: 'Paneer Wrap' },
  { id: 'd3', name: 'Rajma Chawal' },
  { id: 'd4', name: 'Cold Coffee' },
];

/** Same mix as the seed: enough delivered orders that one class is partly done. */
const STATUS_MIX: KitchenStatus[] = [
  ...Array<KitchenStatus>(14).fill('paid'),
  ...Array<KitchenStatus>(5).fill('preparing'),
  ...Array<KitchenStatus>(4).fill('delivered'),
  'cancelled',
];

/**
 * Two schools, not one.
 *
 * A single-school fixture cannot show the school filter at all, so the control that matters most
 * once three schools are live was the one nobody could look at. The split is uneven on purpose —
 * a real kitchen serves a big school and a small one, and an even split hides bugs where a group
 * happens to be the same size as its neighbour.
 */
const SCHOOLS = [
  { id: '50000000-0000-0000-0000-000000000001', name: 'Alpha Public School' },
  { id: '50000000-0000-0000-0000-000000000002', name: 'Bravo International School' },
];

/** A kitchen operator's usual grants: sees orders, hands food over, may cancel. */
export const FULL_PERMISSIONS: KitchenPermissions = {
  viewOrders: true,
  markDelivered: true,
  cancelOrders: true,
};

/** Realistic parent requests. Deliberately none of them allergy language — see §5.6.1. */
const NOTES = ['Less spicy', 'No coriander', 'Cut into halves', 'No onion, please'];

export function fixtureDay(
  serviceDate: string,
  loadedAt = '2026-08-13T01:42:00.000Z',
  permissions: KitchenPermissions = FULL_PERMISSIONS,
): KitchenDay {
  const orders: KitchenOrder[] = CHILDREN.map(([first, last], index) => {
    // Every fourth child is at the second school, so it is a minority rather than half the board.
    const school = index % 4 === 3 ? SCHOOLS[1]! : SCHOOLS[0]!;
    const klass = CLASSES[index % CLASSES.length]!;
    const brk = BREAKS[index % BREAKS.length]!;
    const lines = [{ ...DISHES[index % DISHES.length]!, quantity: index % 7 === 0 ? 2 : 1 }];
    if (index % 3 === 0) lines.push({ ...DISHES[(index + 2) % DISHES.length]!, quantity: 1 });

    return {
      id: `71000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
      orderRef: `SEED-${serviceDate.replace(/-/g, '')}-${String(index + 1).padStart(3, '0')}`,
      schoolId: school.id,
      schoolName: school.name,
      breakId: brk.id,
      breakLabel: brk.label,
      recipientName: `${first} ${last}`,
      classLabel: klass.label,
      sectionLabel: klass.section,
      status: STATUS_MIX[index % STATUS_MIX.length]!,
      pickupCode: null,
      lines: lines.map((l, lineIndex) => ({
        dishId: l.id,
        dishName: l.name,
        quantity: l.quantity,
        // Roughly one line in four, so the note is a thing you notice rather than a thing you
        // stop seeing. Requests only — never allergy language, which the app routes out of this
        // field and into the child's profile (ux-spec §5.6.1).
        note: (index + lineIndex) % 4 === 0 ? NOTES[(index + lineIndex) % NOTES.length]! : null,
      })),
    };
  });

  return {
    serviceDate,
    permissions,
    orders,
    // Derived from the orders, exactly as `liveTransport` does — a school with nothing to cook
    // today is a filter that guarantees an empty result.
    schools: SCHOOLS.filter((s2) => orders.some((o) => o.schoolId === s2.id)),
    breaks: BREAKS,
    loadedAt,
  };
}

/**
 * The transport the screen runs against until the Edge Function exists.
 *
 * `updateStatus` mutates the in-memory day and returns, so the optimistic path and its
 * confirmation are both exercised. `failNext` makes the *failure* path reachable on demand —
 * which matters more than the success path here, because a write that silently does nothing is
 * the worst thing this screen can do and it is the state nobody builds a way to see.
 */
export function fixtureTransport(
  serviceDate: string,
  permissions: KitchenPermissions = FULL_PERMISSIONS,
): KitchenTransport & { failNext(): void } {
  let day = fixtureDay(serviceDate, undefined, permissions);
  let shouldFail = false;

  return {
    failNext() {
      shouldFail = true;
    },

    async load(filters: KitchenFilters) {
      if (filters.serviceDate !== day.serviceDate) day = fixtureDay(filters.serviceDate, undefined, permissions);
      return { ...day, orders: day.orders.map((o) => ({ ...o })) };
    },

    async updateStatus({ orderIds, to }: { orderIds: string[]; to: KitchenAction }) {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('The kitchen server did not accept that change.');
      }
      day = {
        ...day,
        orders: day.orders.map((o) => (orderIds.includes(o.id) ? { ...o, status: to } : o)),
      };
      return { updated: orderIds };
    },
  };
}
