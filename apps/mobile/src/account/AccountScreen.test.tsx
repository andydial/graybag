import { type ComponentProps } from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AccountScreen as AccountScreenImpl } from './AccountScreen';
import { CartProvider } from '../cart/CartContext';
import { auditA11y, formatViolations } from '../a11y/audit';

/**
 * These are presentation tests, and the ordinary case they describe is a settled, signed-in
 * session. The component's own default is `pending` — it claims nothing until told — so the
 * default is supplied here rather than by the component, and the cases that are *about*
 * `access` still pass it explicitly and override this.
 */
const AccountScreen = (props: ComponentProps<typeof AccountScreenImpl>) => (
  <AccountScreenImpl access="signedIn" {...props} />
);


/**
 * Account (`docs/ux-spec.md` §5.17).
 *
 * The screen holds no state of its own, so what is worth testing is not behaviour but
 * **which doors exist in which state** — that is the entire product of this screen, and it
 * is exactly the thing that regressed before: the app once had one route to sign-in and it
 * was behind the cart.
 *
 * `render` is async on RNTL v14 — see `docs/learnings.md` 2026-08-09.
 */

// `BrandHeader` reads the cart for its badge, so every mount needs the provider.
const Wrapper = ({ children }: { children: ReactNode }) => <CartProvider>{children}</CartProvider>;

type Props = Parameters<typeof AccountScreen>[0];

const mount = (props: Props = {}) =>
  render(
    <Wrapper>
      <AccountScreen {...props} />
    </Wrapper>,
  );

/** Every string the screen puts on the display. */
function renderedText(): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') walk((node as { children?: unknown }).children);
  };
  walk(screen.toJSON());
  return parts.join(' ');
}

describe('AccountScreen, signed in', () => {
  const signedIn: Props = { email: 'parent@example.com' };

  it('is the account screen, whatever is on it', async () => {
    await mount(signedIn);
    expect(screen.getByTestId('screen-account')).toBeOnTheScreen();
  });

  it('shows the signed-in email under the title, and never as a control', async () => {
    await mount(signedIn);

    const identity = screen.getByTestId('screen-account-identity');
    expect(identity).toHaveTextContent('parent@example.com');
    // Display only. A selectable or pressable email is an invitation to move it somewhere
    // it must not go (non-negotiable #4).
    expect(identity.props.selectable).toBeFalsy();
    expect(identity.props.onPress).toBeUndefined();
  });

  it('offers the account holder’s own name, and does not scold when there is none', async () => {
    // `P18` / `E05-39`. Every account was in this state until `0030`, and Andy's instruction
    // was that order one has no name and that must be fine everywhere — so the row invites.
    // An optional field that renders as an unfinished task is not optional.
    const onEditName = jest.fn();
    await mount({ ...signedIn, onEditName });

    const row = screen.getByTestId('screen-account-name');
    // Regex, not a string: RNTL's `toHaveTextContent` matches a string EXACTLY against the
    // node's whole text, and this row concatenates its title, subtitle and chevron.
    expect(row).toHaveTextContent(/Your name/);
    expect(row).toHaveTextContent(/we’ll manage without one/);

    await userEvent.setup().press(row);
    expect(onEditName).toHaveBeenCalled();
  });

  it('shows the name once there is one', async () => {
    await mount({ ...signedIn, yourName: 'Priya Sharma' });
    expect(screen.getByTestId('screen-account-name')).toHaveTextContent(/Priya Sharma/);
  });

  it('opens every door §5.17 says it has', async () => {
    const onRecipients = jest.fn();
    const onOrders = jest.fn();
    const onSupport = jest.fn();
    const onDeleteAccount = jest.fn();
    const onSignOut = jest.fn();
    const user = userEvent.setup();

    await mount({
      ...signedIn,
      onRecipients,
      onOrders,
      onSupport,
      onDeleteAccount,
      onSignOut,
    });

    await user.press(screen.getByTestId('screen-account-recipients'));
    await user.press(screen.getByTestId('screen-account-orders'));
    await user.press(screen.getByTestId('screen-account-support'));
    await user.press(screen.getByTestId('screen-account-delete'));
    await user.press(screen.getByTestId('screen-account-signout'));

    expect(onRecipients).toHaveBeenCalledTimes(1);
    expect(onOrders).toHaveBeenCalledTimes(1);
    expect(onSupport).toHaveBeenCalledTimes(1);
    expect(onDeleteAccount).toHaveBeenCalledTimes(1);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('tells the caller which policy was asked for', async () => {
    const onPolicy = jest.fn();
    const user = userEvent.setup();
    await mount({ ...signedIn, onPolicy });

    await user.press(screen.getByTestId('screen-account-privacy'));
    await user.press(screen.getByTestId('screen-account-terms'));
    await user.press(screen.getByTestId('screen-account-refund'));

    expect(onPolicy.mock.calls).toEqual([['privacy'], ['terms'], ['refund']]);
  });

  /**
   * Both stores require an in-app route to account deletion, and the flow behind it is not
   * built. A row that appears only once its destination exists is how a compliance
   * requirement quietly ships missing.
   */
  it('offers account deletion even with nothing wired behind it', async () => {
    await mount(signedIn);
    expect(screen.getByTestId('screen-account-delete')).toBeOnTheScreen();
    expect(screen.getByText('Delete my account')).toBeOnTheScreen();
  });

  // An adult may order for themselves. Wording that assumes a child has to be found and
  // fixed on every screen later, so it does not start here.
  it('names the recipients row without assuming a child', async () => {
    await mount(signedIn);

    expect(screen.getByTestId('screen-account-recipients')).toBeOnTheScreen();
    expect(renderedText()).not.toMatch(/your child\b/i);
  });

  it('has no sign-in button to press', async () => {
    await mount(signedIn);
    expect(screen.queryByTestId('screen-account-signin')).toBeNull();
  });
});

describe('AccountScreen, signed out', () => {
  const signedOut: Props = { access: 'signedOut' as const };

  it('is still the account screen', async () => {
    await mount(signedOut);
    expect(screen.getByTestId('screen-account')).toBeOnTheScreen();
    expect(screen.getByTestId('screen-account-identity')).toHaveTextContent('Not signed in');
  });

  /**
   * The regression this file exists for. The app shipped with exactly one `navigate('SignIn')`
   * and it sat behind the cart's Place order button, which a visitor with no child could not
   * reach. Account is where a person looks for it.
   */
  it('leads with sign-in as the primary action', async () => {
    const onSignIn = jest.fn();
    const user = userEvent.setup();
    await mount({ ...signedOut, onSignIn });

    const button = screen.getByTestId('screen-account-signin');
    expect(button).toBeOnTheScreen();

    await user.press(button);
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  // `AR7`: browsing is not gated, and this screen is an invitation rather than a wall. If the
  // sentence saying so ever goes, the button reads as a demand.
  it('says an account is not needed to look around', async () => {
    await mount(signedOut);
    expect(renderedText()).toMatch(/don.t need an account/i);
  });

  // Reachable without a session on purpose — the person most likely to read the policies is
  // the one deciding whether to sign in at all, and both stores require them in the app.
  it('still offers the policies and the grievance officer', async () => {
    await mount(signedOut);

    expect(screen.getByTestId('screen-account-privacy')).toBeOnTheScreen();
    expect(screen.getByTestId('screen-account-terms')).toBeOnTheScreen();
    expect(screen.getByTestId('screen-account-refund')).toBeOnTheScreen();
    expect(screen.getByTestId('screen-account-support')).toBeOnTheScreen();
  });

  it('offers nothing that needs a session', async () => {
    await mount(signedOut);

    expect(screen.queryByTestId('screen-account-recipients')).toBeNull();
    expect(screen.queryByTestId('screen-account-orders')).toBeNull();
    // `E05-39`. There is no account to name, so there is nothing to set.
    expect(screen.queryByTestId('screen-account-name')).toBeNull();
    expect(screen.queryByTestId('screen-account-delete')).toBeNull();
    expect(screen.queryByTestId('screen-account-signout')).toBeNull();
  });

  it('never shows an email for a session that does not exist', async () => {
    // A stale email left in a prop must not survive signing out.
    await mount({ access: 'signedOut' as const, email: 'parent@example.com' });
    expect(renderedText()).not.toMatch(/parent@example\.com/);
  });
});

/**
 * The build label is not decoration.
 *
 * Two bug reports have been chased against a binary nobody could identify afterwards. It
 * prints the environment and the commit, it lives at the foot of the one screen a person can
 * always reach, and it is deliberately not behind `__DEV__` — that would remove it from
 * exactly the builds whose identity is hardest to establish weeks later.
 */
describe('the build label', () => {
  it.each([
    ['signed in', { email: 'parent@example.com' } as Props],
    ['signed out', { access: 'signedOut' as const } as Props],
  ])('is on screen when %s', async (_name, props) => {
    await mount(props);
    expect(screen.getByTestId('build-label')).toBeOnTheScreen();
  });
});

describe('accessibility', () => {
  it.each([
    ['signed in', { email: 'parent@example.com' } as Props],
    ['signed out', { access: 'signedOut' as const } as Props],
  ])('every control is named and hittable when %s', async (_name, props) => {
    await mount(props);

    const violations = auditA11y(screen);
    expect(formatViolations(violations)).toBe('');
  });

  it('carries a heading a screen reader can jump to', async () => {
    await mount({ email: 'parent@example.com' });
    expect(screen.getByRole('header')).toHaveTextContent('Account');
  });
});
