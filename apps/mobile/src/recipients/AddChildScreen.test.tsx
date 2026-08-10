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

/**
 * A refusal as `functions.invoke` reports one: an error whose `context` is the raw Response,
 * which is how a non-2xx arrives. `invokeFunction` reads the code and message out of it.
 */
function refuse(code: string, message: string) {
  const error = new Error('Edge Function returned a non-2xx status code') as Error & {
    context?: Response;
  };
  error.context = new Response(JSON.stringify({ code, message }), { status: 409 });
  invoke.mockResolvedValue({ data: null, error });
}

beforeEach(() => {
  allergenRows = ALLERGEN_ROWS;
  stubTransport();
});

afterEach(() => api.setApiTransport(null));

describe('AddChildScreen', () => {
  it('cannot be submitted without the required consent', async () => {
    // `C10`: the person and the consent are one transaction, so there is no "add now, agree
    // later". The button being inert is that rule made visible rather than a validation nicety.
    await setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Ishaan');

    await user.press(screen.getByTestId('screen-add-child-submit'));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('says why the button is inert rather than leaving it grey', async () => {
    // §5.10 *Consent missing*: disabled **and the reason stated**. A dead button with no
    // explanation is the commonest way a form loses someone who was willing to agree.
    await setup();
    expect(screen.getByTestId('screen-add-child-consent-required')).toBeOnTheScreen();
    expect(screen.getByTestId('screen-add-child-submit')).toHaveTextContent(
      'Agree above to continue',
    );

    const user = userEvent.setup();
    await user.press(screen.getByTestId('screen-add-child-consent'));

    expect(screen.queryByTestId('screen-add-child-consent-required')).toBeNull();
    expect(screen.getByTestId('screen-add-child-submit')).toHaveTextContent('Save');
  });

  it('cannot be submitted without a first name', async () => {
    // The packing list is read aloud by a member of staff. Someone with no name on it
    // cannot be handed their lunch.
    await setup();
    const user = userEvent.setup();
    await user.press(screen.getByTestId('screen-add-child-consent'));

    await user.press(screen.getByTestId('screen-add-child-submit'));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('answers a missing first name on the field, and clears it when it is fixed', async () => {
    // §5.10 *Invalid*: inline, per field. The message is on the thing that is wrong, not in a
    // banner at the top that names a field you then have to go and find.
    await setup();
    const user = userEvent.setup();
    await user.press(screen.getByTestId('screen-add-child-consent'));
    await user.press(screen.getByTestId('screen-add-child-submit'));

    expect(
      await screen.findByText(/We need a first name/),
    ).toBeOnTheScreen();

    await user.type(screen.getByLabelText('First name'), 'Ishaan');
    expect(screen.queryByText(/We need a first name/)).toBeNull();
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

  it('says the allergy details were removed rather than dropping them quietly', async () => {
    // The refusal §5.10 asks for, on the client half. Someone who typed "peanut" and had it
    // silently discarded would believe the kitchen knows — which is the harm, not the loss
    // of the text.
    await setup();
    const user = userEvent.setup();
    await user.press(screen.getByTestId('screen-add-child-allergen-consent'));
    await screen.findByTestId('screen-add-child-allergen-a1');
    await user.press(screen.getByTestId('screen-add-child-allergen-a1'));

    await user.press(screen.getByTestId('screen-add-child-allergen-consent'));
    expect(screen.getByTestId('screen-add-child-allergy-withdrawn')).toBeOnTheScreen();

    // And it goes away when the permission is given back, rather than nagging.
    await user.press(screen.getByTestId('screen-add-child-allergen-consent'));
    expect(screen.queryByTestId('screen-add-child-allergy-withdrawn')).toBeNull();
  });

  it('says nothing about removal when there was nothing to remove', async () => {
    await setup();
    const user = userEvent.setup();
    await user.press(screen.getByTestId('screen-add-child-allergen-consent'));
    await screen.findByTestId('screen-add-child-allergen-a1');
    await user.press(screen.getByTestId('screen-add-child-allergen-consent'));

    expect(screen.queryByTestId('screen-add-child-allergy-withdrawn')).toBeNull();
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

  it('defaults to the school already being browsed, and says where it came from', async () => {
    // `AR7`: someone here has almost always answered "which school" once already, and every
    // avoidable step costs registrations. A prefilled field with no provenance reads as a
    // guess, so the hint is part of the prefill rather than decoration on it.
    await setup();
    expect(screen.getByTestId('screen-add-child-school')).toHaveTextContent(
      'Alpha Public School',
    );
    expect(
      screen.getByText('Taken from the menu you were browsing. Tap to change.'),
    ).toBeOnTheScreen();
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
    expect(await screen.findByText(/Choose the school/)).toBeOnTheScreen();
  });

  it('shows the server refusal rather than a generic failure', async () => {
    // The refusal codes exist so a parent gets a sentence they can act on. Collapsing them
    // into "something went wrong" throws away the whole reason the Edge Function maps them.
    refuse('school_unavailable', 'GrayBag is not serving that school yet.');

    await setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Ishaan');
    await user.press(screen.getByTestId('screen-add-child-consent'));
    await user.press(screen.getByTestId('screen-add-child-submit'));

    expect(
      await screen.findByText('GrayBag is not serving that school yet.'),
    ).toBeOnTheScreen();
    // And what happens next, which the server has no business deciding.
    expect(screen.getByText(/adding schools across Mohali/)).toBeOnTheScreen();
  });

  it('explains a server-side allergen refusal instead of swallowing it', async () => {
    // The server refuses the inconsistent combination too (`allergen_consent_required`), and
    // the screen must not paper over it — the same rule the client half enforces.
    refuse(
      'allergen_consent_required',
      'To store allergy details we need your permission on the allergies question.',
    );

    await setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Ishaan');
    await user.press(screen.getByTestId('screen-add-child-consent'));
    await user.press(screen.getByTestId('screen-add-child-submit'));

    expect(await screen.findByTestId('screen-add-child-error')).toBeOnTheScreen();
    expect(screen.getByText(/Tick the allergies box/)).toBeOnTheScreen();
  });

  it('offers a way forward when the failure has no code', async () => {
    invoke.mockRejectedValue(new Error('Network request failed'));

    await setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Ishaan');
    await user.press(screen.getByTestId('screen-add-child-consent'));
    await user.press(screen.getByTestId('screen-add-child-submit'));

    expect(await screen.findByTestId('screen-add-child-error')).toBeOnTheScreen();
    expect(screen.getByText(/tap Save again/)).toBeOnTheScreen();
  });

  it('will not save offline, and says why', async () => {
    // A consent is evidence of who agreed, to which wording, from which build. There is no
    // honest offline queue for that, so the screen refuses rather than promising.
    await setup({ offline: true });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Ishaan');
    await user.press(screen.getByTestId('screen-add-child-consent'));
    await user.press(screen.getByTestId('screen-add-child-submit'));

    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByTestId('screen-add-child-offline')).toBeOnTheScreen();
    expect(screen.getByTestId('screen-add-child-submit')).toHaveTextContent(/offline/);
  });

  it('hands the created child back, and says it worked', async () => {
    const { onAdded } = await setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Ishaan');
    await user.press(screen.getByTestId('screen-add-child-consent'));
    await user.press(screen.getByTestId('screen-add-child-submit'));

    await waitFor(() =>
      expect(onAdded).toHaveBeenCalledWith({ recipientId: 'r1', firstName: 'Ishaan' }),
    );
    // The screen does not depend on the caller navigating away to look like it succeeded —
    // §5.10 *Saved* is a state here, not a side effect of somebody else's router.
    expect(await screen.findByTestId('screen-add-child-saved')).toBeOnTheScreen();
  });

  it('does not send the same person twice', async () => {
    await setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('First name'), 'Ishaan');
    await user.press(screen.getByTestId('screen-add-child-consent'));
    await user.press(screen.getByTestId('screen-add-child-submit'));

    await screen.findByTestId('screen-add-child-saved');
    await user.press(screen.getByTestId('screen-add-child-submit'));

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('is written for whoever is being added, not for a parent', async () => {
    // `P13`: an adult may add themselves. Nothing on this screen may assume a parent, and the
    // consent block is where that assumption would do the most damage — a member of staff
    // asked to agree to us holding "your child's" details is being asked the wrong question.
    await setup();
    expect(screen.getByText('Add someone')).toBeOnTheScreen();
    expect(
      screen.getByText('So the right food reaches the right person.'),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/your child/i)).toBeNull();
  });
});
