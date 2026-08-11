import { render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '@graybag/shared';

import { CartProvider } from '../cart/CartContext';
import { AccountScreen, ChildrenScreen } from '../screens';
import { OrderTargetProvider } from './OrderTargetContext';
import { SessionProvider } from './SessionContext';

/**
 * **Account must agree with the rest of the app about whether anyone is signed in.**
 *
 * Third report of the same shape, and this time inverted: "Who to order for" correctly listed
 * Andy's children while Account said "Not signed in". The session was real; one screen rendered
 * as though it were not.
 *
 * ## The cause, and it was mine
 *
 * `AccountScreen`'s identity line reads
 * `access !== 'signedIn' || email === null || email === '' ? … : email` — so a **missing email
 * falls into the same branch as a missing session** and prints "Not signed in". The container in
 * `screens/index.tsx` has never passed `email` to it: the prop existed, nothing supplied it, and
 * `Session` did not carry an address to supply.
 *
 * So this was not a stale provider or a propagation delay. It was a screen inferring "is there a
 * session" from a field that says nothing about sessions — exactly the shape of `E03-26` and
 * `E03-27`, a third time, in the one screen whose entire job is to report session state.
 *
 * The fix is to stop inferring: `Session` carries `email`, the container passes it, and an
 * absent address renders as an absent address rather than as an absent session.
 *
 * These tests mount the **container** components from `screens/index.tsx` — the ones the
 * navigator actually renders — not the presentational ones. Every previous test in this family
 * mounted the presentational component and passed props by hand, which is precisely how a
 * container that never passes a prop went unnoticed.
 */

function transport({ email }: { email: string | null }) {
  const rows = [
    {
      can_order: true,
      can_manage: true,
      recipient: {
        id: 'r-1',
        first_name: 'Aarav',
        class_label: '4',
        section_label: 'B',
        is_active: true,
        school: { id: 's-1', name: 'Amity International School' },
      },
    },
  ];
  const builder = (data: unknown) => {
    const b: Record<string, unknown> = {};
    b.eq = () => b;
    b.is = () => b;
    b.order = () => b;
    b.then = (onfulfilled: (r: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data, error: null }).then(onfulfilled);
    return b;
  };
  return {
    from: (table: string) => ({
      select: () => builder(table === 'guardian_link' ? rows : []),
    }),
    functions: { invoke: jest.fn() },
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { user: { id: 'u-1', email } } },
          error: null,
        }),
      signOut: () => Promise.resolve({ error: null }),
    },
  } as never;
}

const mount = (ui: React.ReactElement) =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <SessionProvider>
        <OrderTargetProvider>
          <CartProvider>
            <NavigationContainer>{ui}</NavigationContainer>
          </CartProvider>
        </OrderTargetProvider>
      </SessionProvider>
    </SafeAreaProvider>,
  );

describe('Account reflects the session the rest of the app has', () => {
  afterEach(() => api.setApiTransport(null as never));

  it('does not claim "Not signed in" while a session exists', async () => {
    api.setApiTransport(transport({ email: 'andy@graybag.com' }));

    await mount(<AccountScreen />);

    await waitFor(() => expect(screen.queryByText('Not signed in')).toBeNull());
    expect(screen.getByText('andy@graybag.com')).toBeOnTheScreen();
  });

  /**
   * The specific regression: a session with no email attached. An identity provider need not
   * return one, and "we do not know your address" is not "you are not signed in".
   */
  it('stays signed in when the session carries no email', async () => {
    api.setApiTransport(transport({ email: null }));

    await mount(<AccountScreen />);

    await waitFor(() => expect(screen.queryByText('Sign in')).toBeNull());
    expect(screen.queryByText('Not signed in')).toBeNull();
  });

  /**
   * The disagreement itself, asserted across two screens in one tree — which is the thing that
   * kept shipping. Each screen was individually defensible; together they contradicted.
   */
  it('agrees with Who-to-order-for about whether there is a session', async () => {
    api.setApiTransport(transport({ email: 'andy@graybag.com' }));

    await mount(
      <>
        <AccountScreen />
        <ChildrenScreen />
      </>,
    );

    // The children list is the screen Andy saw working.
    await waitFor(() => expect(screen.getByText(/Aarav/)).toBeTruthy());
    // Then Account must not be saying the opposite at the same moment.
    expect(screen.queryByText('Not signed in')).toBeNull();
  });
});
