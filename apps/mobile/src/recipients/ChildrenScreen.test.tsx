import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '@graybag/shared';

import {
  ChildrenScreen,
  RecipientListRow,
  allergyLine,
  classifyReadFailure,
  headline,
  type RecipientRow,
} from './ChildrenScreen';
import { OrderTargetProvider } from '../session/OrderTargetContext';
// The tick names a child, so it renders only with a session behind it — see
// `session/no-recipient-without-session.test.tsx`.
import { SessionProvider } from '../session/SessionContext';

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

/** A row as the screen holds it, for the parts `fetchRecipients` does not return yet. */
const ROW = (over: Partial<RecipientRow> = {}): RecipientRow => ({
  id: 'r1',
  firstName: 'Ishaan',
  lastName: 'Mehta',
  classLabel: '5',
  sectionLabel: 'A',
  schoolId: 's1',
  schoolName: 'Alpha Public School',
  canOrder: true,
  canManage: true,
  // Required since `E05-38` — `fetchRecipients` returns it on every row now. A child by
  // default, which is what an unqualified fixture ought to be.
  isSelf: false,
  ...over,
});

async function setup(overrides: Partial<Parameters<typeof ChildrenScreen>[0]> = {}) {
  const onAddChild = jest.fn();
  // A session is now a precondition for this screen reading anything: `useRecipients` refuses
  // without one, which is the fix for the disclosure Andy found on his phone. These tests are
  // about the list a signed-in parent sees, so they say so.
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SessionProvider initial={{ status: 'signedIn', userId: 'u1', email: null }}>
        <ChildrenScreen onAddChild={onAddChild} {...overrides} />
      </SessionProvider>
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
  it('lists a recipient with their class, their school and an Edit affordance', async () => {
    await setup();
    expect(await screen.findByTestId('screen-children-r1')).toBeOnTheScreen();
    // Name and class on the first line, school beneath — ux-spec §5.16 and the prototype.
    expect(screen.getByText('Ishaan Mehta · Class 5-A')).toBeOnTheScreen();
    expect(screen.getByText('Alpha Public School')).toBeOnTheScreen();
    expect(screen.getByTestId('screen-children-r1-edit')).toBeOnTheScreen();
  });

  it('offers a second way in below the list', async () => {
    const { onAddChild } = await setup();
    const user = userEvent.setup();
    await user.press(await screen.findByTestId('screen-children-add'));
    expect(onAddChild).toHaveBeenCalled();
  });

  it('offers "Order for myself" while the account has no self recipient', async () => {
    // `E05-38`. First-class, not a line inside the add form: a member of staff ordering their
    // own lunch is not "someone else". It carries the answer to the form's first question, so
    // the person who tapped it is not asked again.
    const onOrderForSelf = jest.fn();
    await setup({ onOrderForSelf });
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('screen-children-add-self'));
    expect(onOrderForSelf).toHaveBeenCalled();
  });

  it('withdraws it once they are on their own list', async () => {
    // `create_recipient` refuses a second self recipient (`self_recipient_exists`, `0022`), so
    // leaving the entry point would be a button whose only possible outcome is a refusal —
    // which teaches that the button is broken rather than that the thing is already done.
    rows = [LINK({ id: 'r9', first_name: 'Priya', is_self: true })];
    await setup({ onOrderForSelf: jest.fn() });

    await screen.findByTestId('screen-children-r9');
    expect(screen.queryByTestId('screen-children-add-self')).toBeNull();
    // And the add path itself is untouched — this hides one entry point, not the list's.
    expect(screen.getByTestId('screen-children-add')).toBeOnTheScreen();
  });

  it('shows the adult’s own row as "You", above the children', async () => {
    // `fetchRecipients` sorts the self row first (`E05-38`): it renders as "You", so sorting
    // it by the first name nobody sees would put it in a position with no visible reason.
    rows = [LINK(), LINK({ id: 'r9', first_name: 'Priya', is_self: true, class_label: null })];
    await setup();

    await screen.findByTestId('screen-children-r9');
    expect(screen.getByText('You')).toBeOnTheScreen();
    // No class line for an adult — they have neither, and "Class undefined" is worse than
    // nothing (`0022`).
    expect(screen.queryByText(/You · Class/)).toBeNull();
  });

  it('offers it from an empty account too', async () => {
    // The empty account is where "am I supposed to add myself as a child?" actually happens.
    // An account with nobody on it has no self recipient by definition.
    rows = [];
    const onOrderForSelf = jest.fn();
    await setup({ onOrderForSelf });
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('screen-children-empty-self'));
    expect(onOrderForSelf).toHaveBeenCalled();
  });

  it('falls back to the add form when nothing wired the self entry', async () => {
    // The form asks who it is for as its first question, so an unwired route costs one extra
    // tap rather than producing a button that does nothing.
    const { onAddChild } = await setup();
    const user = userEvent.setup();

    await user.press(await screen.findByTestId('screen-children-add-self'));
    expect(onAddChild).toHaveBeenCalled();
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

  it('says so when it holds no allergy details, rather than saying nothing', async () => {
    // §5.21 / `F5`: silence where a warning would go is a safety claim we never verified.
    // `fetchRecipients` does not read allergy data at all, so today every row says this.
    await setup();
    expect(await screen.findByTestId('screen-children-r1-allergies')).toHaveTextContent(
      /Allergy details aren’t loaded here yet/,
    );
  });

  it('shows a skeleton first, not a spinner', async () => {
    // `S5`: on an unreliable connection a skeleton shows the shape of what is coming, which
    // reads as progress. A spinner reads as a stall.
    blocked = true;
    await setup();
    expect(screen.getByTestId('screen-children-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('screen-children-empty')).toBeNull();
  });

  it('invites a parent with nobody added to add someone', async () => {
    rows = [];
    const { onAddChild } = await setup();

    const empty = await screen.findByTestId('screen-children-empty');
    expect(empty).toBeOnTheScreen();

    const user = userEvent.setup();
    await user.press(screen.getByText('Add someone'));
    expect(onAddChild).toHaveBeenCalled();
  });

  /**
   * CHANGED, deliberately, and it is the fix rather than a concession to it.
   *
   * This used to assert `screen-children-empty` for a signed-out parent — the same screen a
   * signed-in parent with no children sees. That conflation is how a *list of real children*
   * and a *list of nobody* became indistinguishable, and it is why nothing noticed when the
   * signed-out case began rendering names: there was no state that meant "we cannot see this
   * account", so no test could assert its contents.
   *
   * `AR7` still holds and is untouched — browsing needs no session and this is not a wall. But
   * this screen describes an *account*, and without one there is nothing to describe.
   */
  it('says it cannot see the account, rather than that the account is empty', async () => {
    userId = null;
    await setup();
    expect(await screen.findByTestId('screen-children-signedout')).toBeOnTheScreen();
    // Never N1: claiming "Nobody added yet" about an account we cannot read is a lie that
    // happens to be true most of the time.
    expect(screen.queryByTestId('screen-children-empty')).toBeNull();
  });

  it('offers a retry when the read fails', async () => {
    queryError = { message: 'permission denied', code: '42501' };
    await setup();
    expect(await screen.findByTestId('screen-children-error')).toBeOnTheScreen();

    // An error is not an empty list. Collapsing the two would tell a parent whose read was
    // refused that they have nobody.
    expect(screen.queryByTestId('screen-children-empty')).toBeNull();

    queryError = null;
    const user = userEvent.setup();
    await user.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('screen-children-r1')).toBeOnTheScreen();
  });

  it('renders a read it could not make as unreachable, never as "you have nobody"', async () => {
    // §5.21's whole point (N2 against N1). A transport failure arrives with no provider code,
    // and telling a parent their list is empty because we could not read it is a lie that
    // reads as data loss.
    queryError = { message: 'TypeError: Network request failed' };
    await setup();

    expect(await screen.findByTestId('screen-children-unreachable')).toBeOnTheScreen();
    expect(screen.queryByTestId('screen-children-empty')).toBeNull();
    expect(screen.queryByTestId('screen-children-error')).toBeNull();
    expect(screen.getByText('Try again')).toBeOnTheScreen();
  });

  it('renders an unconfigured client as unreachable', async () => {
    // The 5.20 case: `configureApiFromEnvironment()` lets the app open without a client so a
    // parent never sees a stack trace, and every screen then has to say so in its own words.
    api.setApiTransport(null);
    await setup();
    expect(await screen.findByTestId('screen-children-unreachable')).toBeOnTheScreen();
    expect(screen.queryByTestId('screen-children-empty')).toBeNull();
  });

  it('puts no name in the failure message', async () => {
    // Non-negotiable #4. A backend refusal can quote the row it refused, so the message shown
    // here is fixed rather than the error's own.
    queryError = { message: 'permission denied for recipient Ishaan Mehta', code: '42501' };
    await setup();
    await screen.findByTestId('screen-children-error');
    expect(screen.queryByText(/Ishaan/)).toBeNull();
  });

  it('draws a recipient with no class rather than hiding them', async () => {
    // The class is optional at creation and free text (`[DM-08]`). A missing part drops out
    // of the sentence; it does not drop the row.
    rows = [LINK({ class_label: null, section_label: null })];
    await setup();
    expect(await screen.findByText('Ishaan Mehta')).toBeOnTheScreen();
    expect(screen.getByText('Alpha Public School')).toBeOnTheScreen();
  });

  it('opens the school picker from the Edit affordance', async () => {
    await setup();
    const user = userEvent.setup();
    await user.press(await screen.findByTestId('screen-children-r1-edit'));
    await user.press(await screen.findByTestId('screen-children-edit-move-school'));

    expect(await screen.findByTestId('screen-children-school-picker-s2')).toBeOnTheScreen();
  });

  it('moves the recipient to the school that was picked', async () => {
    await setup();
    const user = userEvent.setup();
    await user.press(await screen.findByTestId('screen-children-r1-edit'));
    await user.press(await screen.findByTestId('screen-children-edit-move-school'));
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
    await user.press(await screen.findByTestId('screen-children-r1-edit'));
    await user.press(await screen.findByTestId('screen-children-edit-move-school'));

    rows = [LINK({ class_label: null, section_label: null, school: SCHOOLS[1] })];
    await user.press(await screen.findByTestId('screen-children-school-picker-s2'));

    expect(await screen.findByText('Beta International')).toBeOnTheScreen();
  });

  it('says the recipient has undelivered orders instead of "something went wrong"', async () => {
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
    await user.press(await screen.findByTestId('screen-children-r1-edit'));
    await user.press(await screen.findByTestId('screen-children-edit-move-school'));
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
    await user.press(await screen.findByTestId('screen-children-r1-edit'));
    await user.press(await screen.findByTestId('screen-children-edit-move-school'));
    await user.press(await screen.findByTestId('screen-children-school-picker-s2'));

    await screen.findByTestId('screen-children-move-error');
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('falls back to a plain sentence when the failure carried no code', async () => {
    // An unmapped failure becomes a generic 500 whose body may quote whatever the database
    // was refusing — and that row is a person (§13.3). A `code` is the marker of a string
    // that was written to be read.
    const error = new Error('recipient 0d1f… first_name Ishaan violates something') as Error & {
      context?: Response;
    };
    invoke.mockResolvedValue({ data: null, error });

    await setup();
    const user = userEvent.setup();
    await user.press(await screen.findByTestId('screen-children-r1-edit'));
    await user.press(await screen.findByTestId('screen-children-edit-move-school'));
    await user.press(await screen.findByTestId('screen-children-school-picker-s2'));

    expect(await screen.findByTestId('screen-children-move-error')).toBeOnTheScreen();
    expect(screen.queryByText(/violates something/)).toBeNull();
  });

  it('gives every row the same Edit affordance, whatever the link says', async () => {
    // `AR8`: co-guardians are cut from v1, so there is no read-only row and no permission UI.
    // `can_manage` stays in the schema defaulted true and this screen does not branch on it —
    // a row that withholds Edit is a co-guardian surface by another name.
    //
    // (This replaces a test asserting the opposite. It was correct under the two-guardian
    // model and is wrong under `AR8`; the assertion is not weakened, it is inverted.)
    rows = [{ ...LINK(), can_manage: false }];
    await setup();
    const user = userEvent.setup();
    await user.press(await screen.findByTestId('screen-children-r1-edit'));
    await user.press(await screen.findByTestId('screen-children-edit-move-school'));

    expect(await screen.findByTestId('screen-children-school-picker-s2')).toBeOnTheScreen();
  });

  it('refetches when the reload token changes', async () => {
    // The loop that makes adding someone visible: the form is pushed over this screen, which
    // stays mounted, so returning from it has to ask again.
    const { rerender } = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SessionProvider initial={{ status: 'signedIn', userId: 'u1', email: null }}>
          <ChildrenScreen onAddChild={jest.fn()} reloadToken={0} />
        </SessionProvider>
      </SafeAreaProvider>,
    );
    await screen.findByTestId('screen-children-r1');

    rows = [LINK(), LINK({ id: 'r2', first_name: 'Zoya', last_name: null })];
    await rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SessionProvider initial={{ status: 'signedIn', userId: 'u1', email: null }}>
          <ChildrenScreen onAddChild={jest.fn()} reloadToken={1} />
        </SessionProvider>
      </SafeAreaProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('screen-children-r2')).toBeOnTheScreen());
  });

  it('ticks the recipient the app is currently ordering for', async () => {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SessionProvider initial={{ status: 'signedIn', userId: 'u-1', email: null }}>
        <OrderTargetProvider
          initial={{ recipientId: 'r1', allergenIds: [], serviceDate: '2026-08-11' }}
        >
          <ChildrenScreen onAddChild={jest.fn()} />
        </OrderTargetProvider>
        </SessionProvider>
      </SafeAreaProvider>,
    );

    await screen.findByTestId('screen-children-r1');
    // `includeHiddenElements` because the tick is deliberately hidden from the accessibility
    // tree: the row already carries `selected`, and an icon announcing it too says it twice.
    // It is the *visual* carrier of the state, so §2.10 still needs it drawn.
    expect(
      screen.getByTestId('screen-children-r1-selected', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('screen-children-r1')).toBeSelected();
  });

  it('leaves the rows unticked when nothing has been chosen', async () => {
    await setup();
    await screen.findByTestId('screen-children-r1');
    expect(
      screen.getByTestId('screen-children-r1-chevron', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('screen-children-r1-selected', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it('chooses the recipient from a row press when a caller wired it', async () => {
    const onSelectRecipient = jest.fn();
    await setup({ onSelectRecipient });

    const user = userEvent.setup();
    await user.press(await screen.findByTestId('screen-children-r1'));

    expect(onSelectRecipient).toHaveBeenCalledWith('r1');
    // Choosing is not editing: the school sheet must stay shut.
    expect(screen.queryByTestId('screen-children-school-picker-s2')).toBeNull();
  });

  /**
   * `E05-37`. Andy, 2026-08-11: at the start of a school year **every** parent's child is in
   * the wrong class at once. With no edit they add the child again — duplicate recipients,
   * duplicate allergy records, and a support queue arriving for the whole user base in the
   * same week. These are the tests for the thing that stops that.
   */
  describe('correcting a child', () => {
    it('sends the corrected class and section, not a school move', async () => {
      await setup();
      const user = userEvent.setup();
      await user.press(await screen.findByTestId('screen-children-r1-edit'));

      // By label, not testID: `TextField` puts its testID on the wrapper `View` and the
      // `TextInput` carries `accessibilityLabel`. Targeting the label is also what a screen
      // reader does, so the test drives the field the way a person reaches it.
      await user.clear(await screen.findByLabelText('Class'));
      await user.type(await screen.findByLabelText('Class'), '6');
      await user.press(await screen.findByTestId('screen-children-edit-save'));

      await waitFor(() => expect(invoke).toHaveBeenCalled());
      const [name, options] = invoke.mock.calls[0] ?? [];
      expect(name).toBe('recipients/r1');
      expect(options.method).toBe('PATCH');
      expect(options.body.class_label).toBe('6');
      // `E05-43`: the absence of school_id is what makes this a correction rather than a move.
      // A correction that carried one would trip the future-order guard for a typo.
      expect(options.body.school_id).toBeUndefined();
    });

    it('re-reads rather than patching the row from the request', async () => {
      await setup();
      const user = userEvent.setup();
      await user.press(await screen.findByTestId('screen-children-r1-edit'));

      rows = [LINK({ class_label: '6' })];
      await user.press(await screen.findByTestId('screen-children-edit-save'));

      expect(await screen.findByText(/Class 6/)).toBeOnTheScreen();
    });

    it('will not save an empty first name', async () => {
      // The server refuses it too (`first_name_required`), but a disabled button is a better
      // answer than a round trip that comes back as an error.
      await setup();
      const user = userEvent.setup();
      await user.press(await screen.findByTestId('screen-children-r1-edit'));
      await user.clear(await screen.findByLabelText('First name'));

      await user.press(await screen.findByTestId('screen-children-edit-save'));
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  describe('removing a child', () => {
    it('asks first, and says what removal actually does', async () => {
      // Written against migration `0026`: removal erases. The three facts are the ones the
      // code enforces — every guardian's list, the details deleted, the invoices kept.
      await setup();
      const user = userEvent.setup();
      await user.press(await screen.findByTestId('screen-children-r1-edit'));
      await user.press(await screen.findByTestId('screen-children-edit-remove'));

      expect(await screen.findByTestId('screen-children-edit-confirm-remove')).toBeOnTheScreen();
      expect(screen.getByText(/any other parent/i)).toBeOnTheScreen();
      expect(screen.getByText(/deleted\. This can.t be undone/i)).toBeOnTheScreen();
      expect(screen.getByText(/Past orders and invoices are kept/i)).toBeOnTheScreen();
      // Nothing has been sent yet. A confirmation that had already acted would be a label.
      expect(invoke).not.toHaveBeenCalled();
    });

    it('removes only after the second tap', async () => {
      await setup();
      const user = userEvent.setup();
      await user.press(await screen.findByTestId('screen-children-r1-edit'));
      await user.press(await screen.findByTestId('screen-children-edit-remove'));
      await user.press(await screen.findByTestId('screen-children-edit-remove-confirm'));

      await waitFor(() => expect(invoke).toHaveBeenCalled());
      const [name, options] = invoke.mock.calls[0] ?? [];
      expect(name).toBe('recipients/r1');
      expect(options.method).toBe('DELETE');
    });

    it('backs out without sending anything', async () => {
      await setup();
      const user = userEvent.setup();
      await user.press(await screen.findByTestId('screen-children-r1-edit'));
      await user.press(await screen.findByTestId('screen-children-edit-remove'));
      await user.press(await screen.findByTestId('screen-children-edit-remove-cancel'));

      expect(await screen.findByLabelText('First name')).toBeOnTheScreen();
      expect(invoke).not.toHaveBeenCalled();
    });

    it('renders the undelivered-order refusal as guidance, not an error', async () => {
      // The commonest refusal, and there is something the parent can do about it. It must not
      // tell them to change a school — that is the move's advice, and this is a removal.
      const error = new Error('Edge Function returned a non-2xx status code') as Error & {
        context?: Response;
      };
      error.context = new Response(
        JSON.stringify({ code: 'future_orders_exist', message: 'Cancel those days first, then change the school.' }),
        { status: 409 },
      );
      invoke.mockResolvedValue({ data: null, error });

      await setup();
      const user = userEvent.setup();
      await user.press(await screen.findByTestId('screen-children-r1-edit'));
      await user.press(await screen.findByTestId('screen-children-edit-remove'));
      await user.press(await screen.findByTestId('screen-children-edit-remove-confirm'));

      const message = await screen.findByTestId('screen-children-edit-error');
      expect(message).toHaveTextContent(/hasn.t been delivered yet/i);
      expect(message).toHaveTextContent(/then you can remove them/i);
      expect(message).not.toHaveTextContent(/change the school/i);
    });

    it('keeps the sheet open when removal is refused', async () => {
      // A sheet that dismissed on failure would leave a parent believing a child had gone.
      invoke.mockResolvedValue({ data: null, error: new Error('network') });

      await setup();
      const user = userEvent.setup();
      await user.press(await screen.findByTestId('screen-children-r1-edit'));
      await user.press(await screen.findByTestId('screen-children-edit-remove'));
      await user.press(await screen.findByTestId('screen-children-edit-remove-confirm'));

      expect(await screen.findByTestId('screen-children-edit-confirm-remove')).toBeOnTheScreen();
    });
  });

  it('falls back to the edit path on a row press when choosing is not wired', async () => {
    // Nothing can set the order target from here yet — that needs the recipient's allergen
    // ids as well as their id, and sending `[]` would silently disable the add-to-cart
    // allergy warning (`F5`). Until it is wired the biggest target on the row still does
    // something a parent expects rather than nothing.
    //
    // It now lands on the **details** sheet rather than the school picker (`E05-37`). That is
    // the change, not a weakening: correcting a class is the ordinary reason to open a child,
    // and a row press that went straight to "which school?" answered a question nobody asked.
    await setup();
    const user = userEvent.setup();
    await user.press(await screen.findByTestId('screen-children-r1'));

    expect(await screen.findByTestId('screen-children-edit')).toBeOnTheScreen();
    expect(await screen.findByTestId('screen-children-edit-class')).toBeOnTheScreen();
  });
});

/**
 * The row is rendered directly here because `fetchRecipients` cannot yet produce a self row,
 * a break time or an allergy summary — `is_self` is in the schema (`0022`) and not in the
 * payload, the break is `E05-29`, and the allergy summary is tier S and deliberately absent
 * from `RECIPIENT_COLUMNS`. A design exercised only through a transport that strips those
 * fields is a design nothing tests.
 */
describe('RecipientListRow', () => {
  const noop = () => {};

  it('reads "You" for the adult ordering their own lunch', async () => {
    // `P13`. Printing an adult's own name back at them reads like a record of someone else.
    await render(
      <RecipientListRow
        recipient={ROW({ isSelf: true, firstName: 'Andy', lastName: 'Dial', classLabel: null, sectionLabel: null })}
        onPress={noop}
        onEdit={noop}
        testID="row"
      />,
    );

    expect(screen.getByText('You')).toBeOnTheScreen();
    expect(screen.queryByText(/Andy/)).toBeNull();
  });

  it('gives an adult no class, rather than a class of nothing', async () => {
    // Class and section belong to a school child. `is_self` rows carry neither.
    await render(
      <RecipientListRow
        recipient={ROW({ isSelf: true })}
        onPress={noop}
        onEdit={noop}
        testID="row"
      />,
    );
    expect(screen.queryByText(/Class/)).toBeNull();
  });

  it('draws declared allergies as an alert line', async () => {
    await render(
      <RecipientListRow
        recipient={ROW({ allergens: ['Peanuts', 'Milk'], allergenConsent: true })}
        onPress={noop}
        onEdit={noop}
        testID="row"
      />,
    );
    expect(screen.getByTestId('row-allergies')).toHaveTextContent('Allergies: Peanuts, Milk');
  });

  it('draws no allergy line at all once details were shared and none declared', async () => {
    // The one case where silence is honest: the answer was given and it was "none".
    await render(
      <RecipientListRow
        recipient={ROW({ allergens: [], allergenConsent: true })}
        onPress={noop}
        onEdit={noop}
        testID="row"
      />,
    );
    expect(screen.queryByTestId('row-allergies')).toBeNull();
  });

  it('draws the break time when it is known and nothing when it is not', async () => {
    // Never a plausible guess — the rule `OrderForBlock` follows for the same field.
    await render(
      <RecipientListRow
        recipient={ROW({ breakLabel: 'Morning break · 10:40' })}
        onPress={noop}
        onEdit={noop}
        testID="row"
      />,
    );
    expect(screen.getByTestId('row-break')).toHaveTextContent('Morning break · 10:40');

    await render(<RecipientListRow recipient={ROW()} onPress={noop} onEdit={noop} testID="bare" />);
    expect(screen.queryByTestId('bare-break')).toBeNull();
  });

  it('keeps Edit separate from the row itself', async () => {
    const onPress = jest.fn();
    const onEdit = jest.fn();
    await render(
      <RecipientListRow recipient={ROW()} onPress={onPress} onEdit={onEdit} testID="row" />,
    );

    const user = userEvent.setup();
    await user.press(screen.getByTestId('row-edit'));

    expect(onEdit).toHaveBeenCalled();
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('headline', () => {
  it('joins the name and the class the way the design draws them', () => {
    expect(headline(ROW())).toBe('Ishaan Mehta · Class 5-A');
    expect(headline(ROW({ sectionLabel: null }))).toBe('Ishaan Mehta · Class 5');
    expect(headline(ROW({ classLabel: null, sectionLabel: null }))).toBe('Ishaan Mehta');
    expect(headline(ROW({ lastName: null }))).toBe('Ishaan · Class 5-A');
  });
});

describe('allergyLine', () => {
  it('never renders an absent answer as reassurance', () => {
    // `F5`/`F6`. "We hold nothing" and "they told us there is nothing" are different facts,
    // and only one of them is safe to draw as silence.
    expect(allergyLine(ROW())?.tone).toBe('muted');
    expect(allergyLine(ROW({ allergenConsent: false }))?.tone).toBe('muted');
    expect(allergyLine(ROW({ allergenConsent: true }))).toBeNull();
    expect(allergyLine(ROW({ allergens: ['Peanuts'] }))).toEqual({
      tone: 'alert',
      text: 'Allergies: Peanuts',
    });
  });

  it('still warns when allergens were declared without a recorded consent flag', () => {
    // Whatever the flag says, a declared allergen is the one thing that must reach the screen.
    expect(allergyLine(ROW({ allergens: ['Milk'], allergenConsent: false }))?.tone).toBe('alert');
  });
});

describe('classifyReadFailure', () => {
  it('separates "we could not ask" from "the backend refused"', () => {
    // §5.21's N2 against everything else, decided on the *shape* of the error and never on
    // its text — a PostgREST message can quote the row it refused (§13.3).
    expect(classifyReadFailure(new api.ApiNotConfiguredError())).toBe('unreachable');
    expect(classifyReadFailure(new api.ApiError('Network request failed'))).toBe('unreachable');
    expect(classifyReadFailure(new TypeError('fetch failed'))).toBe('unreachable');
    expect(classifyReadFailure(new api.ApiError('permission denied', '42501'))).toBe('error');
    expect(classifyReadFailure(new api.RecipientPayloadError('child at 0 has no id'))).toBe(
      'error',
    );
  });
});
