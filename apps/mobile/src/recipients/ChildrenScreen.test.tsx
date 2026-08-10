import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '@graybag/shared';

import { ChildrenScreen } from './ChildrenScreen';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/**
 * Stubbed at the transport, like `AddChildScreen.test.tsx`.
 *
 * `api` is a namespace of ESM re-exports, so `jest.spyOn(api, 'fetchRecipients')` fails with
 * "Cannot redefine property". Going through `setApiTransport` also means the read this screen
 * makes is the real one — the `guardian_link` query, the `revoked_at` filter and the payload
 * validation all run, rather than being mocked away.
 */
let rows: unknown;
let queryError: { message: string; code?: string } | null;
let userId: string | null;
let selected: string[];
/** Holds the read open, so the first frame — the skeleton — can be asserted. */
let blocked: boolean;
/** The one write this screen makes: `changeRecipientSchool`. */
let invoke: jest.Mock;

/** The two schools the picker offers, as PostgREST returns them. */
const SCHOOLS = [
  { id: 's1', name: 'Alpha Public School', city: { name: 'SAS Nagar (Mohali)' } },
  { id: 's2', name: 'Beta International', city: { name: 'SAS Nagar (Mohali)' } },
];

function stubTransport() {
  selected = [];
  invoke = jest.fn().mockResolvedValue({
    data: { recipient_id: 'r1', school_id: 's2', changed_school: true, from_school_id: 's1' },
    error: null,
  });

  const schoolBuilder = {
    eq: () => schoolBuilder,
    is: () => schoolBuilder,
    order: () => schoolBuilder,
    then: (onfulfilled: (r: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data: SCHOOLS, error: null }).then(onfulfilled),
  };
  const builder = {
    eq: () => builder,
    is: () => builder,
    order: () => builder,
    then: (onfulfilled: (r: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data: queryError ? null : rows, error: queryError }).then(onfulfilled),
  };

  api.setApiTransport({
    from: (table: string) => ({
      select: (columns: string) => {
        // The school picker reads `school`; everything else on this screen reads
        // `guardian_link`. One builder answers both, so the rows are keyed by table.
        selected.push(columns);
        return table === 'school' ? schoolBuilder : builder;
      },
    }),
    functions: { invoke },
    auth: {
      getSession: () =>
        blocked
          ? new Promise(() => {})
          : Promise.resolve({
              data: { session: userId === null ? null : { user: { id: userId } } },
            }),
    },
  } as never);
}

/** One `guardian_link` row with its embedded child, as PostgREST returns it. */
const LINK = (child: Record<string, unknown> = {}) => ({
  can_order: true,
  can_manage: true,
  recipient: {
    id: 'r1',
    first_name: 'Ishaan',
    last_name: 'Mehta',
    class_label: '5',
    section_label: 'A',
    is_active: true,
    school: { id: 's1', name: 'Alpha Public School' },
    ...child,
  },
});

async function setup(overrides: Partial<Parameters<typeof ChildrenScreen>[0]> = {}) {
  const onAddChild = jest.fn();
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ChildrenScreen onAddChild={onAddChild} {...overrides} />
    </SafeAreaProvider>,
  );
  return { onAddChild };
}

beforeEach(() => {
  rows = [LINK()];
  queryError = null;
  userId = 'u1';
  blocked = false;
  stubTransport();
});

afterEach(() => api.setApiTransport(null));

describe('ChildrenScreen', () => {
  it('lists a child with their class and school', async () => {
    await setup();
    expect(await screen.findByTestId('screen-children-r1')).toBeOnTheScreen();
    expect(screen.getByText('Ishaan Mehta')).toBeOnTheScreen();
    expect(screen.getByText('Class 5A · Alpha Public School')).toBeOnTheScreen();
  });

  it('reads through guardian_link and never asks for allergy details', async () => {
    // `D10` — the link is the only path from a parent to a child — and §13.3: `allergy_note`
    // is health data about a minor, and a screen drawing a name and a class has no business
    // holding it. Asserted here as well as in the api module because this screen is what
    // would grow a reason to ask for it.
    await setup();
    await screen.findByTestId('screen-children-r1');
    expect(selected[0]).not.toContain('allergy_note');
    expect(selected[0]).not.toContain('*');
  });

  it('shows a skeleton first, not a spinner', async () => {
    // `S5`: on an unreliable connection a skeleton shows the shape of what is coming, which
    // reads as progress. A spinner reads as a stall.
    blocked = true;
    await setup();
    expect(screen.getByTestId('screen-children-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('screen-children-empty')).toBeNull();
  });

  it('invites a parent with no children to add one', async () => {
    rows = [];
    const { onAddChild } = await setup();

    const empty = await screen.findByTestId('screen-children-empty');
    expect(empty).toBeOnTheScreen();

    const user = userEvent.setup();
    await user.press(screen.getByText('Add a child'));
    expect(onAddChild).toHaveBeenCalled();
  });

  it('is empty rather than a wall for a signed-out parent', async () => {
    // `AR7`. Nothing in this app demands a session on arrival; the gate is at checkout.
    userId = null;
    await setup();
    expect(await screen.findByTestId('screen-children-empty')).toBeOnTheScreen();
  });

  it('offers a retry when the read fails', async () => {
    queryError = { message: 'permission denied', code: '42501' };
    await setup();
    expect(await screen.findByTestId('screen-children-error')).toBeOnTheScreen();

    // An error is not an empty list. Collapsing the two would tell a parent whose read was
    // refused that they have no children.
    expect(screen.queryByTestId('screen-children-empty')).toBeNull();

    queryError = null;
    const user = userEvent.setup();
    await user.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('screen-children-r1')).toBeOnTheScreen();
  });

  it('puts no child in the failure message', async () => {
    // Non-negotiable #4. A backend refusal can quote the row it refused, so the message shown
    // here is fixed rather than the error's own.
    queryError = { message: 'permission denied for recipient Ishaan Mehta', code: '42501' };
    await setup();
    await screen.findByTestId('screen-children-error');
    expect(screen.queryByText(/Ishaan/)).toBeNull();
  });

  it('draws a child with no class rather than hiding them', async () => {
    // The class is optional at creation and free text (`[DM-08]`). A missing part drops out
    // of the sentence; it does not drop the child.
    rows = [LINK({ class_label: null, section_label: null })];
    await setup();
    expect(await screen.findByText('Alpha Public School')).toBeOnTheScreen();
  });

  it('opens the school picker from a child’s row', async () => {
    await setup();
    const user = userEvent.setup();
    await user.press(await screen.findByTestId('screen-children-r1'));

    expect(await screen.findByTestId('screen-children-school-picker-s2')).toBeOnTheScreen();
  });

  it('moves the child to the school that was picked', async () => {
    await setup();
    const user = userEvent.setup();
    await user.press(await screen.findByTestId('screen-children-r1'));
    await user.press(await screen.findByTestId('screen-children-school-picker-s2'));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    // The id is in the path, never the body — one id per request (`E05-02`).
    expect(invoke.mock.calls[0]?.[0]).toBe('recipients/r1');
    expect(invoke.mock.calls[0]?.[1].method).toBe('PATCH');
    expect(invoke.mock.calls[0]?.[1].body).toMatchObject({ school_id: 's2' });
  });

  it('re-reads the list after a move rather than patching the row', async () => {
    // The server may clear the class as part of the move — a class at the old school does
    // not mean anything at the new one — so the rows this screen holds are stale.
    await setup();
    const user = userEvent.setup();
    await user.press(await screen.findByTestId('screen-children-r1'));

    rows = [LINK({ class_label: null, section_label: null, school: SCHOOLS[1] })];
    await user.press(await screen.findByTestId('screen-children-school-picker-s2'));

    expect(await screen.findByText('Beta International')).toBeOnTheScreen();
  });

  it('says the child has undelivered orders instead of "something went wrong"', async () => {
    // `D19`. Those lunches were bought against the old school's kitchen and menu, and
    // nothing this screen can do will move them — the parent has to cancel those days
    // first. A generic failure would leave them tapping the same school again.
    const error = new Error('Edge Function returned a non-2xx status code') as Error & {
      context?: Response;
    };
    error.context = new Response(
      JSON.stringify({
        code: 'future_orders_exist',
        message:
          'There are orders for this child that have not been delivered yet. Cancel those days first, then change the school.',
      }),
      { status: 409 },
    );
    invoke.mockResolvedValue({ data: null, error });

    await setup();
    const user = userEvent.setup();
    await user.press(await screen.findByTestId('screen-children-r1'));
    await user.press(await screen.findByTestId('screen-children-school-picker-s2'));

    expect(await screen.findByText(/Cancel those days first/)).toBeOnTheScreen();
  });

  it('offers no retry against a refusal retrying cannot fix', async () => {
    // `ErrorState` requires a "Try again"; this uses `EmptyState` for exactly that reason.
    const error = new Error('non-2xx') as Error & { context?: Response };
    error.context = new Response(
      JSON.stringify({ code: 'future_orders_exist', message: 'Cancel those days first.' }),
      { status: 409 },
    );
    invoke.mockResolvedValue({ data: null, error });

    await setup();
    const user = userEvent.setup();
    await user.press(await screen.findByTestId('screen-children-r1'));
    await user.press(await screen.findByTestId('screen-children-school-picker-s2'));

    await screen.findByTestId('screen-children-move-error');
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('falls back to a plain sentence when the failure carried no code', async () => {
    // An unmapped failure becomes a generic 500 whose body may quote whatever the database
    // was refusing — and that row is a child (§13.3). A `code` is the marker of a string
    // that was written to be read.
    const error = new Error('recipient 0d1f… first_name Ishaan violates something') as Error & {
      context?: Response;
    };
    invoke.mockResolvedValue({ data: null, error });

    await setup();
    const user = userEvent.setup();
    await user.press(await screen.findByTestId('screen-children-r1'));
    await user.press(await screen.findByTestId('screen-children-school-picker-s2'));

    expect(await screen.findByTestId('screen-children-move-error')).toBeOnTheScreen();
    expect(screen.queryByText(/violates something/)).toBeNull();
  });

  it('gives a co-guardian who may not manage no way to move the child', async () => {
    // [AZ-05] / `D10`: the answer lives on the `guardian_link`, and a row that fails at the
    // server is worse than a row that does nothing.
    rows = [{ ...LINK(), can_manage: false }];
    await setup();
    const user = userEvent.setup();
    await user.press(await screen.findByTestId('screen-children-r1'));

    expect(screen.queryByTestId('screen-children-school-picker-s2')).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refetches when the reload token changes', async () => {
    // The loop that makes adding a child visible: the form is pushed over this screen, which
    // stays mounted, so returning from it has to ask again.
    const { rerender } = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ChildrenScreen onAddChild={jest.fn()} reloadToken={0} />
      </SafeAreaProvider>,
    );
    await screen.findByTestId('screen-children-r1');

    rows = [LINK(), LINK({ id: 'r2', first_name: 'Zoya', last_name: null })];
    await rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ChildrenScreen onAddChild={jest.fn()} reloadToken={1} />
      </SafeAreaProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('screen-children-r2')).toBeOnTheScreen());
  });
});
