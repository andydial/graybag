import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { api } from '@graybag/shared';

import { OrderTargetProvider } from './OrderTargetContext';
import { SessionProvider } from './SessionContext';
import { useAudience, addRecipientRoute } from './audience';

/**
 * **No screen renders recipient data without a session.**
 *
 * Andy found this on his own phone: Home said "Add someone to place an order", the cart showed a
 * line for a child he had created earlier, and Account asked him to sign in — all at once. A
 * child's first name was on screen with no session behind it. Under the DPDP Act a minor's name
 * is regulated (tier P, non-negotiable #4), so this is a data-protection defect and not a
 * cosmetic one.
 *
 * Two tests, deliberately of different kinds, because the behavioural one alone would let the
 * next screen reintroduce it:
 *
 * 1. **Behaviour** — with the client holding a persisted session and the app not knowing it yet,
 *    nothing names anybody.
 * 2. **Structure** — no screen may reach the target context directly. That is the only way the
 *    behaviour can regress: by a new screen deriving session state for itself, which is what all
 *    seven original call sites did.
 */

/** A transport that answers as though somebody signed in on a previous launch. */
function persistedSessionTransport({ session }: { session: boolean }) {
  // `guardian_link` rows wrapping a nested `recipient`, as `fetchRecipients` actually reads them.
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
    b.then = (onfulfilled: (r: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data, error: null }).then(onfulfilled);
    return b;
  };
  return {
    from: (table: string) =>
      // Only the link table returns children. The allergen read answers empty, which leaves
      // `allergenIds` null — "we did not check", per `E05-31`.
      ({ select: () => builder(table === 'guardian_link' && session ? rows : []) }),
    functions: { invoke: jest.fn() },
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: session ? { user: { id: 'u-1', email: 'a@b.com' } } : null },
          error: null,
        }),
    },
  } as never;
}

/**
 * Records **every** render, not just the settled one.
 *
 * A single assertion after `waitFor` cannot see a frame that flashed and passed, and a frame is
 * exactly how long a name needs to be on screen to have been on screen. The tests below assert
 * over the whole sequence.
 */
const seen: string[] = [];

function Probe() {
  const audience = useAudience();
  const name = audience.kind === 'ordering' ? audience.target.displayName : '';
  const rendered = `${audience.kind}|${name ?? ''}`;
  seen.push(rendered);
  return <Text testID="probe">{rendered}</Text>;
}

/** Any frame that put a person's name on screen. */
const framesNamingSomebody = () => seen.filter((frame) => frame.split('|')[1] !== '');

describe('no recipient data without a session', () => {
  beforeEach(() => {
    seen.length = 0;
  });
  afterEach(() => api.setApiTransport(null as never));

  /**
   * The exact sequence from Andy's phone: the Supabase client has a session in the keychain, the
   * app has not read it back yet. The old code rendered a child here.
   */
  it('names nobody before the stored session has been read back', async () => {
    api.setApiTransport(persistedSessionTransport({ session: true }));

    await render(
      <SessionProvider>
        <OrderTargetProvider>
          <Probe />
        </OrderTargetProvider>
      </SessionProvider>,
    );

    // Once the keychain read resolves, the same child is fine to show — there is a session now.
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('ordering|Aarav'));

    // The whole point: every frame before that named nobody, and none of them claimed to be a
    // settled answer. `unknown` until proven otherwise.
    const before = seen.slice(0, seen.indexOf('ordering|Aarav'));
    if (before.some((frame) => frame !== 'unknown|')) {
      throw new Error(`A frame claimed an answer before the session was read: ${before.join(' → ')}`);
    }

    // And "Add someone" never flashed at a parent who already has a child on the account.
    if (seen.includes('needsRecipient|')) {
      throw new Error(`Offered to add a child to an account that has one: ${seen.join(' → ')}`);
    }
  });

  it('names nobody, ever, when there is genuinely no session', async () => {
    api.setApiTransport(persistedSessionTransport({ session: false }));

    await render(
      <SessionProvider>
        <OrderTargetProvider>
          <Probe />
        </OrderTargetProvider>
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('visitor|'));
    // Give the recipient read every chance to land late and overwrite it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId('probe')).toHaveTextContent('visitor|');

    const named = framesNamingSomebody();
    if (named.length > 0) {
      throw new Error(`Named somebody with no session: ${named.join(' → ')}`);
    }
  });

  /**
   * A target held from before a sign-out is a persisted reference to a minor. It must be cleared
   * in the same tick, not merely left un-refreshed — the screen would keep rendering it.
   */
  it('drops a recipient already in hand when the session goes away', async () => {
    api.setApiTransport(persistedSessionTransport({ session: false }));

    await render(
      <SessionProvider initial={{ status: 'signedOut', userId: null, email: null }}>
        <OrderTargetProvider
          initial={{
            recipientId: 'r-1',
            allergenIds: null,
            serviceDate: '2026-08-12' as never,
            displayName: 'Aarav',
          }}
        >
          <Probe />
        </OrderTargetProvider>
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('visitor|'));

    // It was handed a target on the way in. It must not have rendered them even once.
    const named = framesNamingSomebody();
    if (named.length > 0) {
      throw new Error(`Rendered a held recipient after sign-out: ${named.join(' → ')}`);
    }
  });

  it('sends a visitor to sign in before the add-someone form, not after', () => {
    // The form cannot submit without a session — `create_recipient` requires one. Routing
    // straight to it hands the parent a form that fails on submit.
    expect(addRecipientRoute({ kind: 'visitor' })).toBe('SignIn');
    expect(addRecipientRoute({ kind: 'needsRecipient', userId: 'u-1' })).toBe('AddChild');
    // Nothing is offered until we know which door it should open.
    expect(addRecipientRoute({ kind: 'unknown' })).toBeNull();
  });

  /**
   * The structural half. `useOrderTarget` hands back a recipient with no proof of a session
   * attached, so a screen calling it is asserting something it has not checked — which is what
   * every one of the original call sites did.
   *
   * Screens go through `useAudience`/`useOrderingTarget`, where the recipient is reachable only
   * from the variant that carries a `userId`.
   */
  it('keeps screens off the target context entirely', () => {
    const root = join(__dirname, '..');
    /**
     * Allowed to read it directly:
     * - `session/` — this is where the derivation lives.
     * - `useAllergenWatchlist` — consumed by the menu through `MenuScreen`'s prop, and it emits
     *   only allergen *labels* from the public reference table, never a name. Its three-state
     *   contract is tested separately (`E05-31`).
     */
    const allowed = [join('src', 'session'), join('src', 'menu', 'useAllergenWatchlist.ts')];

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
        if (allowed.some((a) => rel.startsWith(a))) continue;
        // Comments describe the rule in several files; only real calls count.
        const source = readFileSync(path, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        if (/\buseOrderTarget\s*\(/.test(source)) offenders.push(rel);
      }
    };
    walk(root);

    if (offenders.length > 0) {
      throw new Error(
        `These read the recipient without proof of a session — use useAudience()/useOrderingTarget() instead:\n  ${offenders.join('\n  ')}`,
      );
    }
  });
});
