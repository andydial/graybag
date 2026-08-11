import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '@graybag/shared';

import { ChildrenScreen } from '../recipients/ChildrenScreen';
import { OrderTargetProvider } from './OrderTargetContext';
import { SessionProvider } from './SessionContext';
import { useSignOut } from './useRecipients';

/**
 * **The disclosure `E03-26` did not close.**
 *
 * Andy, on his own phone, after that fix shipped: signed out, Home still let him select a child,
 * and Account → "Who to order for" still listed his children.
 *
 * ## What the earlier test was actually asserting, and why it passed
 *
 * `no-recipient-without-session.test.tsx` asserted two true things that together sound like the
 * property and are not it:
 *
 * 1. `useAudience()` never yields a recipient without a session.
 * 2. No screen calls `useOrderTarget()` directly.
 *
 * Both still hold. Neither says anything about a screen calling **`api.fetchRecipients()`
 * itself**, which is exactly what `ChildrenScreen` — the "Who to order for" list — does in its
 * own `useEffect`. It never consulted the session at all, so gating the *context* left it
 * untouched. The structural guard even walked every file looking for `useOrderTarget(` and gave
 * this screen a clean bill, because the string it searched for was not the one that mattered.
 *
 * The lesson is about where the guard was placed. `E03-26` made the *context* safe and called
 * that "no screen renders recipient data without a session". The real invariant is about **the
 * network read**, one layer below, where there is exactly one door: `api.fetchRecipients()`.
 *
 * ## And why the session disagreed in the first place
 *
 * `fetchRecipients` gates on `currentUser()` — the *Supabase* session in the keychain — while the
 * screens gate on `SessionContext`. Nothing in the app ever called `api.signOut()`, and
 * `screens/index.tsx` never even passed `onSignOut` to Account, so the Sign out row was inert:
 * the keychain session outlived every attempt to leave it. Two sessions, one of them
 * unreachable by the user.
 */

/** A transport holding a live session in the keychain, exactly as a returning device does. */
function keychainSession({ signedIn }: { signedIn: boolean }) {
  // Stateful on purpose. A stub whose `signOut` does not clear `getSession` would let this suite
  // pass while the real client kept answering — the failure mode being tested.
  let live = signedIn;
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
        school: { id: 's-1', name: 'Alpha Public School' },
      },
    },
  ];
  const builder = (data: unknown) => {
    const b: Record<string, unknown> = {};
    b.eq = () => b;
    b.is = () => b;
    b.order = () => b;
    b.then = (onfulfilled: (r: { data: unknown; error: unknown }) => unknown) => Promise.resolve({ data, error: null }).then(onfulfilled);
    return b;
  };
  return {
    from: (table: string) => ({ select: () => builder(table === 'guardian_link' ? rows : []) }),
    functions: { invoke: jest.fn() },
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: live ? { user: { id: 'u-1', email: 'a@b.com' } } : null },
          error: null,
        }),
      signOut: () => {
        live = false;
        return Promise.resolve({ error: null });
      },
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
          <NavigationContainer>{ui}</NavigationContainer>
        </OrderTargetProvider>
      </SessionProvider>
    </SafeAreaProvider>,
  );

describe('a signed-out app never discloses a recipient', () => {
  afterEach(() => api.setApiTransport(null as never));

  /**
   * The reported defect, at the screen Andy named — "Who to order for" with no session.
   *
   * The premise took two attempts to state correctly, and the correction is the finding. My first
   * version forced `SessionProvider` to `signedOut` while the stub's keychain still held a
   * session, and the screen rendered "Aarav · Class 4-B" anyway. That was not the bug reproducing
   * — it was the *fix* working as designed: the session is now derived from the keychain, so
   * forcing the context is not a thing the app can do to itself.
   *
   * Which located the real defect precisely. The app was never able to reach a signed-out state
   * at all: nothing called `api.signOut()`, and Account's Sign out row was passed no handler. The
   * keychain session was permanent. So the honest test is the one below — sign out for real, and
   * watch the names go.
   */
  it('shows nobody, and offers sign-in, when there is no session', async () => {
    api.setApiTransport(keychainSession({ signedIn: false }) as never);

    await mount(<ChildrenScreen onAddChild={() => {}} onSignIn={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('screen-children-signedout')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 30));

    expect(screen.queryByText(/Aarav/)).toBeNull();
    // N3, not N1: it must not claim the account is empty, because it cannot see the account.
    expect(screen.queryByText('Nobody added yet')).toBeNull();
  });

  /**
   * Signing out has to actually remove them. This is the wire that did not exist: `useSignOut`
   * closes the Supabase session, the restored app session follows it down, and the list empties.
   */
  it('drops the list the moment the user signs out', async () => {
    api.setApiTransport(keychainSession({ signedIn: true }) as never);

    const Screen = () => {
      const signOut = useSignOut();
      return (
        <>
          <Text testID="signout" onPress={() => void signOut()}>
            Sign out
          </Text>
          <ChildrenScreen onAddChild={() => {}} onSignIn={() => {}} />
        </>
      );
    };

    const user = userEvent.setup();
    await mount(<Screen />);

    // Signed in, the child is legitimately on screen.
    await waitFor(() => expect(screen.getByText(/Aarav/)).toBeTruthy());

    await user.press(screen.getByTestId('signout'));

    // And gone, without a relaunch.
    await waitFor(() => expect(screen.queryByText(/Aarav/)).toBeNull());
  });

  /**
   * The durable half, and the one that would have caught this in the first place.
   *
   * The previous guard searched every file for `useOrderTarget(` — the wrong string. The read
   * that discloses a recipient is `api.fetchRecipients`, and there must be exactly one caller:
   * `session/useRecipients.ts`, which asks the app's session first.
   *
   * A new screen that fetches its own list is precisely how this defect shipped twice.
   */
  it('keeps every screen off api.fetchRecipients', () => {
    const root = join(__dirname, '..');
    /**
     * The whole session module, not just one file: `OrderTargetContext` also reads recipients and
     * is gated on the session in the same way. The rule is that **the session module owns this
     * read** — a screen never does one. That is the line the defect crossed.
     */
    const allowed = join('src', 'session');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        const rel = path.slice(path.indexOf(join('src', '')));
        if (rel.startsWith(allowed)) continue;
        const source = readFileSync(path, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        if (/\bapi\.fetchRecipients\s*\(/.test(source)) offenders.push(rel);
      }
    };
    walk(root);

    if (offenders.length > 0) {
      throw new Error(
        `These read recipients without consulting the app session — use useRecipients():\n  ${offenders.join('\n  ')}`,
      );
    }
  });

  /**
   * Sign out must close **both** sessions. Closing only the app's leaves the keychain session
   * answering reads, which is the state Andy's phone was in.
   */
  it('signs out of Supabase, not just the UI', () => {
    const source = readFileSync(join(__dirname, 'useRecipients.ts'), 'utf8');
    if (!/api\.signOut\s*\(/.test(source)) {
      throw new Error('useSignOut must call api.signOut() — a local-only sign-out leaves the keychain session live.');
    }
    const wiring = readFileSync(join(__dirname, '..', 'screens', 'index.tsx'), 'utf8');
    if (!/onSignOut=/.test(wiring)) {
      throw new Error('Account renders a Sign out row; screens/index.tsx must pass onSignOut or it does nothing.');
    }
  });
});
