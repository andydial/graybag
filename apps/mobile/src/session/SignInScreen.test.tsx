import { AppState, type AppStateStatus } from 'react-native';
import { act, render, screen, userEvent, waitFor, within } from '@testing-library/react-native';
import { api } from '@graybag/shared';

import { SignInScreen, clearPendingSignIn, CODE_LENGTH } from './SignInScreen';
import { SessionProvider } from './SessionContext';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.

/**
 * `SC3` puts ~150 parents through this screen in a compressed window, so the assertions
 * here are mostly about friction rather than correctness: what is *not* on the screen
 * matters as much as what is.
 *
 * The second half of the file is `docs/ux-spec.md` §5.9.1 — **backgrounding is the normal
 * case on this screen, not an edge case**, because reading the code means leaving the app.
 * Those tests are the ones that would catch a regression nobody would ever reproduce by
 * hand, since every manual test of a sign-in screen is done without ever leaving it.
 */

function authStub(overrides: Record<string, unknown> = {}) {
  const auth = {
    signInWithOtp: jest.fn().mockResolvedValue({ error: null }),
    verifyOtp: jest
      .fn()
      .mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } }, error: null }),
    signOut: jest.fn().mockResolvedValue({ error: null }),
    getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
    ...overrides,
  };
  api.setApiTransport({
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth,
  } as never);
  return auth;
}

const renderScreen = (
  props: Partial<React.ComponentProps<typeof SignInScreen>> = {},
  onSignedIn = jest.fn(),
) =>
  render(
    <SessionProvider>
      <SignInScreen onSignedIn={onSignedIn} {...props} />
    </SessionProvider>,
  );

/**
 * The clock, under test control.
 *
 * The countdown is anchored to a timestamp (§5.9.1), so "40 seconds passed while the app was
 * in the background" is expressible as a jump in `Date.now()` — which is exactly what it is
 * on a real device, and what a tick-based countdown would get wrong.
 */
let clock = 1_700_000_000_000;
const tickClock = (ms: number) => {
  clock += ms;
};

/** The `AppState` listener the screen registers, so a test can foreground the app. */
let appState: ((status: AppStateStatus) => void) | null = null;
const foreground = async () => {
  await act(async () => {
    appState?.('background');
    appState?.('active');
  });
};

beforeEach(() => {
  // The draft (§5.9.1) is module state by design, so it is cleared at both ends: a test that
  // fails mid-flow must not decide where the next one starts.
  clearPendingSignIn();
  clock = 1_700_000_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  appState = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    handler: (status: AppStateStatus) => void,
  ) => {
    appState = handler;
    return { remove: jest.fn() };
  }) as never);
});

afterEach(() => {
  api.setApiTransport(null);
  clearPendingSignIn();
  jest.restoreAllMocks();
});

/** Address → code, the path every later test starts from. */
async function reachCodeStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email'), 'parent@school.edu');
  await user.press(screen.getByTestId('screen-sign-in-send'));
  await screen.findByLabelText('Six-digit code');
}

describe('SignInScreen', () => {
  it('asks for an email and nothing else', async () => {
    // U1: no passwords. A password field appearing here is a decision nobody made.
    authStub();
    await renderScreen();

    expect(screen.getByTestId('screen-sign-in-email')).toBeTruthy();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/password/i)).toBeNull();
    // Exactly one input on this step. A second one is either a password or a "confirm
    // email", and both are steps U1 and AR4 exist to remove.
    // The label, exactly — `/Email/` would also match the "Email me a code" button.
    expect(screen.getAllByLabelText('Email')).toHaveLength(1);
  });

  it('says why it is asking now, and that the order is not lost', async () => {
    // §5.8. The gate is at checkout (R1), so this sentence answers a question the parent
    // already has — and the half that matters is "your order is kept".
    authStub();
    await renderScreen();

    expect(screen.getByText(/We need an account to place your order/)).toBeTruthy();
    expect(screen.getByText(/your order is kept/)).toBeTruthy();
  });

  it('opens with the welcome, not with a title bar reading "Sign in"', async () => {
    authStub();
    await renderScreen();

    expect(screen.getByText('welcome 👋')).toBeTruthy();
  });

  it('does not ask the user whether they are new', async () => {
    // AR7: sign up and sign in are the same act. A "create an account / sign in" choice is
    // a step that exists for the database's benefit, not the parent's.
    authStub();
    await renderScreen();

    expect(screen.queryByText(/create an account/i)).toBeNull();
    expect(screen.queryByText(/sign up/i)).toBeNull();
    expect(screen.queryByText(/already have an account/i)).toBeNull();
  });

  it('sends a code and moves to the code step', async () => {
    const auth = authStub();
    await renderScreen();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'Parent@School.EDU');
    await user.press(screen.getByTestId('screen-sign-in-send'));

    await waitFor(() => expect(screen.getByLabelText('Six-digit code')).toBeTruthy());
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: 'parent@school.edu' });
  });

  it('shows the address it sent to, so a typo is visible', async () => {
    authStub();
    await renderScreen();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'Parent@School.EDU');
    await user.press(screen.getByTestId('screen-sign-in-send'));

    expect(await screen.findByText(/parent@school\.edu/)).toBeTruthy();
  });

  it('offers a way back to the address without starting again', async () => {
    // The commonest reason a code never arrives is a typo in the address.
    authStub();
    await renderScreen();

    const user = userEvent.setup();
    await reachCodeStep(user);
    await user.press(screen.getByTestId('screen-sign-in-back'));

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
    // And the address is still there — "Change" is an edit, not a reset.
    expect(screen.getByLabelText('Email').props.value).toBe('parent@school.edu');
  });

  it('signs in and dismisses itself', async () => {
    // It is presented modally over checkout: the point of signing in was to carry on with
    // what you were doing, not to arrive somewhere new.
    const onSignedIn = jest.fn();
    authStub();
    await renderScreen({}, onSignedIn);

    const user = userEvent.setup();
    await reachCodeStep(user);
    await user.type(screen.getByLabelText('Six-digit code'), '123456');
    await user.press(screen.getByTestId('screen-sign-in-verify'));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
  });

  it('never leaves the screen when the code is wrong, and keeps the digits', async () => {
    authStub({
      verifyOtp: jest
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'Token has expired or is invalid' } }),
    });
    const onSignedIn = jest.fn();
    await renderScreen({}, onSignedIn);

    const user = userEvent.setup();
    await reachCodeStep(user);
    await user.type(screen.getByLabelText('Six-digit code'), '000000');
    await user.press(screen.getByTestId('screen-sign-in-verify'));

    expect(await screen.findByText(/expired or is invalid/)).toBeTruthy();
    expect(onSignedIn).not.toHaveBeenCalled();
    // §5.9 "wrong code": inline, **code retained**. Clearing it makes the commonest recovery
    // — one mistyped digit — into re-entering all six.
    expect(screen.getByLabelText('Six-digit code').props.value).toBe('000000');
  });

  it('stays on the address step when the address is not usable', async () => {
    const auth = authStub();
    await renderScreen();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'nope');
    await user.press(screen.getByTestId('screen-sign-in-send'));

    expect(await screen.findByText(/does not look like an email address/)).toBeTruthy();
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });
});

/**
 * `AR4`: first sign-in IS registration. There is no separate register step and there never
 * will be — but the screen has to say so, because a screen headed "Sign in" with no visible
 * way to create an account reads as broken. Andy concluded he was blocked on OAuth client ids
 * that do not exist, and 150 Amity parents will meet this screen cold.
 */
describe('SignInScreen — a new user can tell this is for them', () => {
  it('tells a new user that entering an email is all it takes', async () => {
    authStub();
    await render(<SignInScreen />);
    expect(await screen.findByTestId('screen-sign-in-new-here')).toBeTruthy();
    expect(screen.getByText(/New here\?/)).toBeTruthy();
    expect(screen.getByText(/that is all it takes to create/)).toBeTruthy();
  });

  // R3 / non-negotiable #7: no passwords, and no OAuth in v1. If a Google or Apple button
  // ever appears without the client ids existing, this screen becomes a dead end again.
  it('offers no sign-in method that needs credentials we do not have', async () => {
    authStub();
    await render(<SignInScreen />);
    expect(screen.queryByText(/Google/i)).toBeNull();
    expect(screen.queryByText(/Apple/i)).toBeNull();
    // Not the WORD "password" — the screen says "No passwords, ever", which is the point.
    // What must not exist is a password FIELD.
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.getByText('No passwords, ever.')).toBeTruthy();
  });
});

/** §5.9 — the six boxes, and what an empty one may contain. */
describe('SignInScreen — the code input', () => {
  // The boxes are hidden from the accessibility tree on purpose — a screen reader meets one
  // control, not six anonymous boxes — so a test has to ask for them explicitly.
  const box = (index: number) =>
    screen.getByTestId(`screen-sign-in-box-${index}`, { includeHiddenElements: true });
  const digitsIn = (index: number) =>
    within(box(index)).queryByText(/\d/, { includeHiddenElements: true });

  it('draws six boxes and never puts a digit in an empty one', async () => {
    authStub();
    await renderScreen();
    const user = userEvent.setup();
    await reachCodeStep(user);

    for (let index = 0; index < CODE_LENGTH; index += 1) {
      expect(box(index)).toBeTruthy();
    }
    expect(
      screen.queryByTestId(`screen-sign-in-box-${CODE_LENGTH}`, { includeHiddenElements: true }),
    ).toBeNull();

    // The prototype once numbered the empty boxes 1–6 and it read as a pre-filled code.
    await user.type(screen.getByLabelText('Six-digit code'), '12');
    expect(digitsIn(0)).toBeTruthy();
    expect(digitsIn(1)).toBeTruthy();
    expect(digitsIn(2)).toBeNull();
    expect(digitsIn(5)).toBeNull();
  });

  it('takes digits only', async () => {
    authStub();
    await renderScreen();
    const user = userEvent.setup();
    await reachCodeStep(user);

    await user.type(screen.getByLabelText('Six-digit code'), '12a3');
    expect(screen.getByLabelText('Six-digit code').props.value).toBe('123');
  });

  it('will not verify a part-typed code', async () => {
    const auth = authStub();
    await renderScreen();
    const user = userEvent.setup();
    await reachCodeStep(user);

    await user.type(screen.getByLabelText('Six-digit code'), '123');
    expect(screen.getByTestId('screen-sign-in-verify')).toHaveTextContent('Enter the code');
    await user.press(screen.getByTestId('screen-sign-in-verify'));
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });
});

/** §5.9 — wrong code, attempts left, too many attempts. */
describe('SignInScreen — attempts', () => {
  const rejecting = () =>
    authStub({
      verifyOtp: jest
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'Token has expired or is invalid' } }),
    });

  it('counts down the attempts left rather than failing silently', async () => {
    rejecting();
    await renderScreen();
    const user = userEvent.setup();
    await reachCodeStep(user);
    await user.type(screen.getByLabelText('Six-digit code'), '000000');

    await user.press(screen.getByTestId('screen-sign-in-verify'));
    expect(await screen.findByText(/2 attempts left/)).toBeTruthy();

    await user.press(screen.getByTestId('screen-sign-in-verify'));
    expect(await screen.findByText(/1 attempt left/)).toBeTruthy();
  });

  it('locks out after three, and the way out is a new code rather than a dead end', async () => {
    const auth = rejecting();
    await renderScreen();
    const user = userEvent.setup();
    await reachCodeStep(user);
    await user.type(screen.getByLabelText('Six-digit code'), '000000');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await user.press(screen.getByTestId('screen-sign-in-verify'));
    }

    expect(await screen.findByTestId('screen-sign-in-code-error')).toHaveTextContent(
      /That is 3 attempts — ask for a new code/,
    );
    expect(screen.getByTestId('screen-sign-in-verify')).toHaveTextContent('Ask for a new code');
    expect(auth.verifyOtp).toHaveBeenCalledTimes(3);

    // A fourth press is not another attempt.
    await user.press(screen.getByTestId('screen-sign-in-verify'));
    expect(auth.verifyOtp).toHaveBeenCalledTimes(3);

    // And the cooldown is out of the way, because resending is now the only move.
    expect(screen.getByTestId('screen-sign-in-resend')).toHaveTextContent('Send a new code');
  });

  it('does not spend an attempt on a request the server refused to look at', async () => {
    authStub({
      verifyOtp: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'For security purposes, you can only request this after 51 seconds', status: 429 },
      }),
    });
    await renderScreen();
    const user = userEvent.setup();
    await reachCodeStep(user);
    await user.type(screen.getByLabelText('Six-digit code'), '000000');
    await user.press(screen.getByTestId('screen-sign-in-verify'));

    expect(await screen.findByText(/Too many attempts\. Wait a minute/)).toBeTruthy();
    expect(screen.queryByText(/attempts left/)).toBeNull();
  });
});

/** §5.9 — resend cooling down, resent. */
describe('SignInScreen — resend', () => {
  it('cools down for thirty seconds and says so', async () => {
    const auth = authStub();
    await renderScreen();
    const user = userEvent.setup();
    await reachCodeStep(user);

    expect(screen.getByTestId('screen-sign-in-resend')).toHaveTextContent('Resend in 0:30');
    await user.press(screen.getByTestId('screen-sign-in-resend'));
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(1);
  });

  it('offers a new code once the countdown is spent, and clears the old digits', async () => {
    const auth = authStub();
    await renderScreen();
    const user = userEvent.setup();
    await reachCodeStep(user);
    await user.type(screen.getByLabelText('Six-digit code'), '111111');

    tickClock(31_000);
    await foreground();

    expect(screen.getByTestId('screen-sign-in-resend')).toHaveTextContent('Send a new code');
    await user.press(screen.getByTestId('screen-sign-in-resend'));

    await waitFor(() => expect(auth.signInWithOtp).toHaveBeenCalledTimes(2));
    // The old code is dead. Leaving its digits invites typing the code from the older of two
    // emails into boxes that already hold half of it.
    expect(screen.getByLabelText('Six-digit code').props.value).toBe('');
    expect(await screen.findByTestId('screen-sign-in-resent')).toBeTruthy();
    expect(screen.getByTestId('screen-sign-in-resend')).toHaveTextContent('Resend in 0:30');
  });
});

/** §5.8 / §5.9 — offline. */
describe('SignInScreen — offline', () => {
  it('explains rather than failing, and keeps the address', async () => {
    const auth = authStub({
      signInWithOtp: jest.fn().mockRejectedValue(new Error('Network request failed')),
    });
    await renderScreen();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'parent@school.edu');
    await user.press(screen.getByTestId('screen-sign-in-send'));

    expect(await screen.findByTestId('screen-sign-in-offline')).toBeTruthy();
    expect(screen.getByTestId('screen-sign-in-send')).toHaveTextContent("You're offline");
    expect(screen.getByLabelText('Email').props.value).toBe('parent@school.edu');

    // Not a dead end: a retry is on screen, and it works the moment the connection does.
    auth.signInWithOtp.mockResolvedValue({ error: null });
    await user.press(screen.getByTestId('screen-sign-in-retry'));
    await waitFor(() => expect(screen.getByLabelText('Six-digit code')).toBeTruthy());
  });

  it('keeps the code when verifying could not reach the server', async () => {
    authStub({
      verifyOtp: jest.fn().mockRejectedValue(new Error('Network request failed')),
    });
    await renderScreen();
    const user = userEvent.setup();
    await reachCodeStep(user);
    await user.type(screen.getByLabelText('Six-digit code'), '123456');
    await user.press(screen.getByTestId('screen-sign-in-verify'));

    expect(await screen.findByTestId('screen-sign-in-offline')).toBeTruthy();
    expect(screen.getByLabelText('Six-digit code').props.value).toBe('123456');
    // An attempt that never reached the server is not one of the three.
    expect(screen.queryByText(/attempts left/)).toBeNull();
  });
});

/**
 * §5.9.1 — **backgrounding is the normal case here**.
 *
 * This is the only screen in the product whose happy path requires leaving the app: the code
 * is in Mail, not in GrayBag. Every one of these would pass trivially on a screen nobody ever
 * leaves, which is precisely why they are written down.
 */
describe('SignInScreen — returning from the background', () => {
  it('keeps the digits, the address and the countdown', async () => {
    authStub();
    await renderScreen();
    const user = userEvent.setup();
    await reachCodeStep(user);
    await user.type(screen.getByLabelText('Six-digit code'), '1234');

    tickClock(12_000);
    await foreground();

    expect(screen.getByLabelText('Six-digit code').props.value).toBe('1234');
    expect(screen.getByText(/parent@school\.edu/)).toBeTruthy();
    // Anchored to a timestamp: twelve seconds passed while the app was away, and the
    // countdown knows it. A tick-based timer would still say 0:30.
    expect(screen.getByTestId('screen-sign-in-resend')).toHaveTextContent('Resend in 0:18');
  });

  it('does not let the countdown restart, which is how resends get spammed', async () => {
    authStub();
    await renderScreen();
    const user = userEvent.setup();
    await reachCodeStep(user);

    for (let round = 0; round < 3; round += 1) {
      tickClock(5_000);
      await foreground();
    }

    expect(screen.getByTestId('screen-sign-in-resend')).toHaveTextContent('Resend in 0:15');
  });

  it('fills an exact six-digit clipboard, and never submits it', async () => {
    const auth = authStub();
    await renderScreen({ readClipboard: () => '654321' });
    const user = userEvent.setup();
    await reachCodeStep(user);

    await foreground();

    expect(screen.getByLabelText('Six-digit code').props.value).toBe('654321');
    expect(await screen.findByTestId('screen-sign-in-autofilled')).toBeTruthy();
    // §5.9.1: a code that verifies itself while a parent is still reading is disorienting,
    // and a wrong auto-submit burns one of their three attempts.
    expect(auth.verifyOtp).not.toHaveBeenCalled();

    // It is filled and highlighted; the parent taps Verify.
    await user.press(screen.getByTestId('screen-sign-in-verify'));
    await waitFor(() => expect(auth.verifyOtp).toHaveBeenCalledTimes(1));
  });

  it('ignores a clipboard that is not exactly six digits', async () => {
    authStub();
    await renderScreen({ readClipboard: () => 'Your GrayBag code is 654321' });
    const user = userEvent.setup();
    await reachCodeStep(user);

    await foreground();

    // Only an exact match. Anything looser fills the boxes with somebody's phone number.
    expect(screen.getByLabelText('Six-digit code').props.value).toBe('');
    expect(screen.queryByTestId('screen-sign-in-autofilled')).toBeNull();
  });

  it('does not overwrite digits the parent has already typed', async () => {
    authStub();
    await renderScreen({ readClipboard: () => '654321' });
    const user = userEvent.setup();
    await reachCodeStep(user);
    await user.type(screen.getByLabelText('Six-digit code'), '12345');

    await foreground();

    expect(screen.getByLabelText('Six-digit code').props.value).toBe('12345');
  });

  it('survives a clipboard that will not read', async () => {
    authStub();
    await renderScreen({
      readClipboard: () => Promise.reject(new Error('clipboard unavailable')),
    });
    const user = userEvent.setup();
    await reachCodeStep(user);

    await foreground();

    // No error, no notice — they can still type it.
    expect(screen.getByLabelText('Six-digit code')).toBeTruthy();
    expect(screen.queryByTestId('screen-sign-in-autofilled')).toBeNull();
  });

  it('survives the screen being unmounted while the parent is in Mail', async () => {
    // A navigator swapping the stack out looks identical to the parent. Re-typing four of
    // six digits because of it is the exact failure §5.9.1 names.
    authStub();
    const view = await renderScreen();
    const user = userEvent.setup();
    await reachCodeStep(user);
    await user.type(screen.getByLabelText('Six-digit code'), '1234');

    // `unmount` is async on RNTL v14, like `render`. Not awaiting it overlaps two `act`
    // scopes, and React's response to that is to render the next tree as nothing — which
    // shows up as a later test failing rather than this one.
    await view.unmount();
    tickClock(10_000);
    await renderScreen();

    expect(screen.getByLabelText('Six-digit code').props.value).toBe('1234');
    expect(screen.getByText(/parent@school\.edu/)).toBeTruthy();
    expect(screen.getByTestId('screen-sign-in-resend')).toHaveTextContent('Resend in 0:20');
  });
});

/**
 * Non-negotiable #4 and the DPDP work. An address is personal data and a live code is a
 * credential; neither belongs in a log line, a crash report or an analytics event, and the
 * cheapest place to catch a stray `console.log` is here rather than in a Sentry review.
 */
describe('SignInScreen — nothing here is logged', () => {
  it('never writes the address or the code to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => {}),
    );

    authStub({
      verifyOtp: jest
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'Token has expired or is invalid' } }),
    });
    await renderScreen();
    const user = userEvent.setup();
    await reachCodeStep(user);
    await user.type(screen.getByLabelText('Six-digit code'), '424242');
    await user.press(screen.getByTestId('screen-sign-in-verify'));
    await screen.findByText(/2 attempts left/);

    const written = spies
      .flatMap((spy) => spy.mock.calls)
      .flat()
      .map((argument) => String(argument))
      .join(' ');

    expect(written).not.toContain('parent@school.edu');
    expect(written).not.toContain('424242');
  });
});
