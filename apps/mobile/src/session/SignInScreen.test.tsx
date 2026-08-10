import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { api } from '@graybag/shared';

import { SignInScreen } from './SignInScreen';
import { SessionProvider } from './SessionContext';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.

/**
 * `SC3` puts ~150 parents through this screen in a compressed window, so the assertions
 * here are mostly about friction rather than correctness: what is *not* on the screen
 * matters as much as what is.
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

const renderScreen = (onSignedIn = jest.fn()) =>
  render(
    <SessionProvider>
      <SignInScreen onSignedIn={onSignedIn} />
    </SessionProvider>,
  );

afterEach(() => api.setApiTransport(null));

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
    expect(screen.getAllByLabelText(/Email address/)).toHaveLength(1);
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
    await user.type(screen.getByLabelText('Email address'), 'Parent@School.EDU');
    await user.press(screen.getByTestId('screen-sign-in-send'));

    await waitFor(() => expect(screen.getByLabelText('Six-digit code')).toBeTruthy());
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: 'parent@school.edu' });
  });

  it('shows the address it sent to, so a typo is visible', async () => {
    authStub();
    await renderScreen();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email address'), 'Parent@School.EDU');
    await user.press(screen.getByTestId('screen-sign-in-send'));

    expect(await screen.findByText(/parent@school\.edu/)).toBeTruthy();
  });

  it('offers a way back to the address without starting again', async () => {
    // The commonest reason a code never arrives is a typo in the address.
    authStub();
    await renderScreen();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email address'), 'a@b.com');
    await user.press(screen.getByTestId('screen-sign-in-send'));
    await user.press(await screen.findByTestId('screen-sign-in-back'));

    await waitFor(() => expect(screen.getByLabelText('Email address')).toBeTruthy());
  });

  it('signs in and dismisses itself', async () => {
    // It is presented modally over checkout: the point of signing in was to carry on with
    // what you were doing, not to arrive somewhere new.
    const onSignedIn = jest.fn();
    authStub();
    await renderScreen(onSignedIn);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email address'), 'a@b.com');
    await user.press(screen.getByTestId('screen-sign-in-send'));
    await user.type(await screen.findByLabelText('Six-digit code'), '123456');
    await user.press(screen.getByTestId('screen-sign-in-verify'));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
  });

  it('never leaves the screen when the code is wrong', async () => {
    authStub({
      verifyOtp: jest
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'Token has expired or is invalid' } }),
    });
    const onSignedIn = jest.fn();
    await renderScreen(onSignedIn);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email address'), 'a@b.com');
    await user.press(screen.getByTestId('screen-sign-in-send'));
    await user.type(await screen.findByLabelText('Six-digit code'), '000000');
    await user.press(screen.getByTestId('screen-sign-in-verify'));

    expect(await screen.findByText(/expired or is invalid/)).toBeTruthy();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('stays on the address step when the address is not usable', async () => {
    const auth = authStub();
    await renderScreen();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email address'), 'nope');
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
    await render(<SignInScreen />);
    expect(await screen.findByTestId('screen-sign-in-new-here')).toBeTruthy();
    expect(screen.getByText(/New here\?/)).toBeTruthy();
  });

  // R3 / non-negotiable #7: no passwords, and no OAuth in v1. If a Google or Apple button
  // ever appears without the client ids existing, this screen becomes a dead end again.
  it('offers no sign-in method that needs credentials we do not have', async () => {
    await render(<SignInScreen />);
    expect(screen.queryByText(/Google/i)).toBeNull();
    expect(screen.queryByText(/Apple/i)).toBeNull();
    // Not the WORD "password" — the screen says "No password to remember", which is the
    // point. What must not exist is a password FIELD.
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });
});
