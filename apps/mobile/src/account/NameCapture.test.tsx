import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '@graybag/shared';

import { NameCapture } from './NameCapture';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.
//
// Text fields are found by their **label**: `TextField` puts its testID on the wrapping View
// and identifies the `TextInput` by `accessibilityLabel`.

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

let invoke: jest.Mock;
let profileRows: unknown[];
let readError: { message: string; code?: string } | null;

/**
 * Stubbed at the transport, not by spying on `api`'s exports — those are non-configurable ESM
 * getters. `setApiTransport` is the seam the module was built with, and it is the better test:
 * the request that would go over the wire is asserted, so `setUserName`'s own rules are
 * exercised rather than mocked away.
 */
function stubTransport() {
  invoke = jest.fn().mockResolvedValue({ data: { first_name: 'Priya' }, error: null });

  const builder = {
    eq: () => builder,
    order: () => builder,
    then: (onfulfilled: (r: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data: profileRows, error: readError }).then(onfulfilled),
  };

  api.setApiTransport({
    from: () => ({ select: () => builder }),
    functions: { invoke },
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }),
    },
  } as never);
}

const NO_NAME = { first_name: null, last_name: null, name_prompted_at: null };

async function setup() {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <NameCapture />
    </SafeAreaProvider>,
  );
}

const body = () => invoke.mock.calls[0]?.[1].body as Record<string, unknown>;

beforeEach(() => {
  profileRows = [NO_NAME];
  readError = null;
  stubTransport();
});

afterEach(() => api.setApiTransport(null));

describe('NameCapture', () => {
  it('asks when there is no name and no record of asking', async () => {
    await setup();
    expect(await screen.findByTestId('name-capture')).toBeOnTheScreen();
    expect(screen.getByText('What should we call you?')).toBeOnTheScreen();
  });

  it('says it is optional, in the copy and not only in the code', async () => {
    // `P18`: one optional field with a clear skip. A field a parent believes is required is
    // required, whatever the schema says.
    await setup();
    await screen.findByTestId('name-capture');
    expect(screen.getByText(/Optional\./)).toBeOnTheScreen();
    expect(screen.getByTestId('name-capture-skip')).toHaveTextContent('Not now');
  });

  it('never asks again once the question has been answered', async () => {
    // The whole point of `name_prompted_at`. A skip that is not recorded is a question that
    // comes back on the next order, which is how an optional field becomes a nag.
    profileRows = [{ ...NO_NAME, name_prompted_at: '2026-08-11T10:00:00+00:00' }];
    await setup();
    await waitFor(() => expect(screen.queryByTestId('name-capture')).toBeNull());
  });

  it('never asks somebody whose name we already have', async () => {
    profileRows = [{ first_name: 'Priya', last_name: null, name_prompted_at: null }];
    await setup();
    await waitFor(() => expect(screen.queryByTestId('name-capture')).toBeNull());
  });

  it('asks nobody when the read fails', async () => {
    // Fails closed. Asking a parent for a name we may already be printing on their invoice is
    // worse than not asking at all.
    readError = { message: 'permission denied', code: '42501' };
    await setup();
    await waitFor(() => expect(screen.queryByTestId('name-capture')).toBeNull());
  });

  it('saves a name through the Edge Function', async () => {
    await setup();
    const user = userEvent.setup();
    await screen.findByTestId('name-capture');

    await user.type(screen.getByLabelText('Your name'), 'Priya');
    await user.press(screen.getByTestId('name-capture-save'));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke.mock.calls[0]?.[0]).toBe('account');
    expect(body()).toEqual({ first_name: 'Priya', last_name: null });
  });

  it('records a skip rather than only hiding itself', async () => {
    // Hiding it locally would ask again on the next order, and on the next device today.
    await setup();
    const user = userEvent.setup();
    await screen.findByTestId('name-capture');

    await user.press(screen.getByTestId('name-capture-skip'));

    expect(screen.queryByTestId('name-capture')).toBeNull();
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(body()).toEqual({ skip_name_prompt: true });
  });

  it('dismisses on skip without waiting for the write', async () => {
    // Making somebody watch a spinner in order to DECLINE a question would be worse than the
    // question. The write settles behind them; failing costs one more ask, which is the state
    // they were already in.
    let settle: (value: unknown) => void = () => {};
    invoke.mockReturnValue(new Promise((resolve) => (settle = resolve)));

    await setup();
    const user = userEvent.setup();
    await screen.findByTestId('name-capture');
    await user.press(screen.getByTestId('name-capture-skip'));

    expect(screen.queryByTestId('name-capture')).toBeNull();
    settle({ data: null, error: null });
  });

  it('treats an empty field as a skip, not as an error', async () => {
    // Someone who pressed Save on a blank field has told us they would rather not. Answering
    // that with "please enter a name" argues with them about an optional question.
    await setup();
    const user = userEvent.setup();
    await screen.findByTestId('name-capture');

    await user.press(screen.getByTestId('name-capture-save'));

    expect(screen.queryByTestId('name-capture')).toBeNull();
    await waitFor(() => expect(body()).toEqual({ skip_name_prompt: true }));
  });

  it('keeps the field open and says so when a save fails', async () => {
    // The asymmetry with skip: they typed something, so a form that cleared itself mid-flight
    // could not tell them it had not been kept.
    const failure = new Error('Edge Function returned a non-2xx status code') as Error & {
      context?: Response;
    };
    failure.context = new Response(JSON.stringify({ error: 'nope' }), { status: 500 });
    invoke.mockResolvedValue({ data: null, error: failure });

    await setup();
    const user = userEvent.setup();
    await screen.findByTestId('name-capture');

    await user.type(screen.getByLabelText('Your name'), 'Priya');
    await user.press(screen.getByTestId('name-capture-save'));

    expect(await screen.findByTestId('name-capture-error')).toHaveTextContent(/add it later/);
    expect(screen.getByTestId('name-capture')).toBeOnTheScreen();
  });

  it('puts no name in the failure message', async () => {
    // §13.3 tier A. The message is ours, not the server's — a backend message can quote the
    // value it refused, and that value is somebody's name.
    const failure = new Error('duplicate key value violates unique constraint') as Error & {
      context?: Response;
    };
    failure.context = new Response(JSON.stringify({ error: 'Priya already exists' }), {
      status: 500,
    });
    invoke.mockResolvedValue({ data: null, error: failure });

    await setup();
    const user = userEvent.setup();
    await screen.findByTestId('name-capture');

    await user.type(screen.getByLabelText('Your name'), 'Priya');
    await user.press(screen.getByTestId('name-capture-save'));

    expect(await screen.findByTestId('name-capture-error')).not.toHaveTextContent('Priya');
  });
});
