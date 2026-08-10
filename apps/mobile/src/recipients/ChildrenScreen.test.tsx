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

function stubTransport() {
  selected = [];
  const builder = {
    eq: () => builder,
    is: () => builder,
    order: () => builder,
    then: (onfulfilled: (r: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data: queryError ? null : rows, error: queryError }).then(onfulfilled),
  };

  api.setApiTransport({
    from: () => ({
      select: (columns: string) => {
        selected.push(columns);
        return builder;
      },
    }),
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
