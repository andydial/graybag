import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '@graybag/shared';

import { AddChildScreen } from './AddChildScreen';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.
//
// Text fields are found by their **label**, not by a testID: `TextField` puts its testID on
// the wrapping View and identifies the `TextInput` by `accessibilityLabel`, which is the
// name a user actually perceives. `user.type` refuses anything that is not a host TextInput,
// so a testID query here fails with "Passed instance has type View".

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const SCHOOL = { schoolId: 's1', schoolName: 'Alpha Public School' };

async function setup(overrides: Partial<Parameters<typeof AddChildScreen>[0]> = {}) {
  const onAdded = jest.fn();
  const onCancel = jest.fn();
  // Awaited inside, so a caller cannot forget. `render` is async on RNTL v14 and forgetting
  // it fails with "render function has not been called", which reads as a broken component.
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <AddChildScreen
        initialSchool={SCHOOL}
        appVersion="2.0.0"
        onAdded={onAdded}
        onCancel={onCancel}
        {...overrides}
      />
    </SafeAreaProvider>,
  );
  return { onAdded, onCancel };
}

/**
 * The api module is stubbed at its **transport**, not by spying on its exports.
 *
 * `api` is a namespace of ESM re-exports, so `jest.spyOn(api, 'createRecipient')` fails with
 * "Cannot redefine property" — the bindings are non-configurable getters. `setApiTransport`
 * is the seam the module was built with (`SchoolPicker.test.tsx` uses the same one), and it
 * is the better test anyway: the request that would go over the wire is asserted, so
 * `createRecipient`'s own rules — allergy details withheld without their consent, strict
 * booleans — are exercised rather than mocked away.
 */
let invoke: jest.Mock;
let allergenRows: unknown[];

function stubTransport() {
  invoke = jest.fn().mockResolvedValue({ data: createdRow, error: null });

  const builder = {
    eq: () => builder,
    order: () => builder,
    then: (onfulfilled: (r: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: allergenRows, error: null }).then(onfulfilled),
  };

  api.setApiTransport({
    from: () => ({ select: () => builder }),
    functions: { invoke },
  } as never);
}

/** As the Edge Function returns it — snake_case, straight from `create_recipient`. */
const createdRow = {
  recipient_id: 'r1',
  first_name: 'Ishaan',
  school_id: 's1',
  notice_version_id: 'pv1',
};

/** As PostgREST returns the allergen rows. */
const ALLERGEN_ROWS = [
  { id: 'a1', code: 'milk', display_name: 'Milk', is_major: true },
  { id: 'a2', code: 'tree_nut', display_name: 'Tree nut', is_major: true },
];

/** The body of the one write this screen makes. */
const sentBody = () => invoke.mock.calls[0]?.[1].body as Record<string, unknown>;

beforeEach(() => {
  allergenRows = ALLERGEN_ROWS;
  stubTransport();
});

afterEach(() => api.setApiTransport(null));

describe('AddChildScreen', () => {
  it('cannot be submitted without the required consent', async () => {
    // `C10`: the child and the consent are one transaction, so there is no "add now, agree
    // later". The button being inert is that rule made visible rather than a validation nicety.
    await setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Ishaan');

    await user.press(screen.getByTestId('screen-add-child-submit'));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('cannot be submitted without a first name', async () => {
    // The packing list is read aloud by a member of staff. A child with no name on it
    // cannot be handed their lunch.
    await setup();
    const user = userEvent.setup();
    await user.press(screen.getByTestId('screen-add-child-consent'));

    await user.press(screen.getByTestId('screen-add-child-submit'));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('submits the child with the consent on the same call', async () => {
    await setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Ishaan');
    await user.type(screen.getByLabelText('Class'), '5');
    await user.press(screen.getByTestId('screen-add-child-consent'));
    await user.press(screen.getByTestId('screen-add-child-submit'));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(sentBody()).toMatchObject({
      first_name: 'Ishaan',
      school_id: 's1',
      class_label: '5',
      consent_granted: true,
      app_version: '2.0.0',
    });
  });

  it('does not ask about allergies until it has been allowed to', async () => {
    // The details come after the permission — in the code as well as on the screen. Asking
    // first is how a form ends up holding data it was not allowed to collect.
    await setup();
    expect(screen.queryByTestId('screen-add-child-allergens')).toBeNull();
    expect(screen.queryByTestId('screen-add-child-allergen-a1')).toBeNull();
  });

  it('asks once the separate consent is given', async () => {
    await setup();
    const user = userEvent.setup();
    await user.press(screen.getByTestId('screen-add-child-allergen-consent'));

    await screen.findByTestId('screen-add-child-allergen-a1');
    expect(await screen.findByTestId('screen-add-child-allergen-a1')).toBeOnTheScreen();
  });

  it('sends allergy details only with their own consent', async () => {
    // `C12` / DPDP §13.3. The server refuses the inconsistent combination too, and must —
    // this is the client not putting the details in the request in the first place.
    await setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Ishaan');
    await user.press(screen.getByTestId('screen-add-child-consent'));

    await user.press(screen.getByTestId('screen-add-child-allergen-consent'));
    await screen.findByTestId('screen-add-child-allergen-a1');
    await user.press(screen.getByTestId('screen-add-child-allergen-a1'));
    await user.type(screen.getByLabelText('Anything else we should know'), 'Severe');

    // Then change their mind.
    await user.press(screen.getByTestId('screen-add-child-allergen-consent'));
    await user.press(screen.getByTestId('screen-add-child-submit'));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(sentBody()).toMatchObject({
      allergen_consent: false,
      allergen_ids: [],
      allergy_note: null,
    });
  });

  it('keeps the allergy details when the consent stands', async () => {
    await setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Ishaan');
    await user.press(screen.getByTestId('screen-add-child-consent'));
    await user.press(screen.getByTestId('screen-add-child-allergen-consent'));
    await screen.findByTestId('screen-add-child-allergen-a1');
    await user.press(screen.getByTestId('screen-add-child-allergen-a1'));
    await user.press(screen.getByTestId('screen-add-child-submit'));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(sentBody()).toMatchObject({ allergen_consent: true, allergen_ids: ['a1'] });
  });

  it('defaults to the school already being browsed', async () => {
    // `AR7`: a parent here has almost always answered "which school" once already, and every
    // avoidable step costs registrations.
    await setup();
    expect(screen.getByTestId('screen-add-child-school')).toHaveTextContent(
      'Alpha Public School',
    );
  });

  it('asks for a school when none has been chosen', async () => {
    await setup({ initialSchool: { schoolId: null, schoolName: null } });
    expect(screen.getByTestId('screen-add-child-school')).toHaveTextContent(
      'Choose a school',
    );
  });

  it('cannot be submitted with no school', async () => {
    await setup({ initialSchool: { schoolId: null, schoolName: null } });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Ishaan');
    await user.press(screen.getByTestId('screen-add-child-consent'));
    await user.press(screen.getByTestId('screen-add-child-submit'));

    expect(invoke).not.toHaveBeenCalled();
  });

  it('shows the server refusal rather than a generic failure', async () => {
    // The refusal codes exist so a parent gets a sentence they can act on. Collapsing them
    // into "something went wrong" throws away the whole reason the Edge Function maps them.
    // A refusal arrives as an error whose `context` is the raw Response, which is how
    // `functions.invoke` reports a non-2xx.
    const error = new Error('Edge Function returned a non-2xx status code') as Error & {
      context?: Response;
    };
    error.context = new Response(
      JSON.stringify({
        code: 'school_unavailable',
        message: 'GrayBag is not serving that school yet.',
      }),
      { status: 409 },
    );
    invoke.mockResolvedValue({ data: null, error });

    await setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Ishaan');
    await user.press(screen.getByTestId('screen-add-child-consent'));
    await user.press(screen.getByTestId('screen-add-child-submit'));

    expect(
      await screen.findByText('GrayBag is not serving that school yet.'),
    ).toBeOnTheScreen();
  });

  it('hands the created child back', async () => {
    const { onAdded } = await setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Ishaan');
    await user.press(screen.getByTestId('screen-add-child-consent'));
    await user.press(screen.getByTestId('screen-add-child-submit'));

    await waitFor(() =>
      expect(onAdded).toHaveBeenCalledWith({ recipientId: 'r1', firstName: 'Ishaan' }),
    );
  });
});
