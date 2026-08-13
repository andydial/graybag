import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { api } from '@graybag/shared';

import { useAllergenWatchlist } from './useAllergenWatchlist';
import { OrderTargetProvider } from '../session/OrderTargetContext';
import type { OrderTarget } from '../session/OrderTargetContext';

/**
 * `E05-31`, and the reason F5 was the divergence worth doing first.
 *
 * The distinction under test is one sentence on screen and the entire safety property behind
 * it: **`[]` says we asked and there are none; `null` says we cannot tell you.** Collapsing
 * them turns "we did not look" into "you are safe".
 */
function Probe() {
  const watchlist = useAllergenWatchlist();
  const detail =
    watchlist.status === 'ready' ? watchlist.avoid.map((a) => a.label).join(',') : '';
  return <Text testID="watchlist">{`${watchlist.status}|${detail}`}</Text>;
}

const base: OrderTarget = {
  recipientId: 'r-1',
  allergenIds: null,
  serviceDate: '2026-08-12' as OrderTarget['serviceDate'],
  displayName: 'Aarav',
};

const mount = (target: OrderTarget | null) =>
  render(
    <OrderTargetProvider initial={target}>
      <Probe />
    </OrderTargetProvider>,
  );

describe('useAllergenWatchlist', () => {
  /**
   * Stubbed at the transport, not with `jest.spyOn(api, …)`. `api` is a namespace of ESM
   * re-exports, so spying on it fails with "Cannot redefine property" — and going through the
   * transport means the real queries run, including the payload validation.
   */
  let allergensFail = false;

  beforeEach(() => {
    allergensFail = false;
    const builder = (data: unknown, error: unknown = null) => {
      const b: Record<string, unknown> = {};
      b.eq = () => b;
      b.is = () => b;
      b.order = () => b;
      b.then = (onfulfilled: (r: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve({ data, error }).then(onfulfilled);
      return b;
    };

    api.setApiTransport({
      from: (table: string) => ({
        select: () => {
          if (table === 'allergen') {
            return allergensFail
              ? builder(null, { message: 'network' })
              : builder([
                  { id: 'a1', code: 'peanut', display_name: 'Peanuts', is_major: true },
                  { id: 'a2', code: 'milk', display_name: 'Milk', is_major: true },
                ]);
          }
          // `guardian_link` (the provider's own read) and anything else: nothing.
          return builder([]);
        },
      }),
      functions: { invoke: jest.fn() },
      auth: {
        getSession: () =>
          Promise.resolve({ data: { session: { user: { id: 'u1' } } }, error: null }),
      },
    } as never);
  });

  afterEach(() => api.setApiTransport(null as never));

  it('is "none" with nobody selected — not a failure, and not a claim', async () => {
    await mount(null);
    expect(screen.getByTestId('watchlist')).toHaveTextContent('none|');
  });

  /**
   * The one that matters. A recipient we hold but whose allergies we have not read is
   * `unavailable`, so the menu suppresses flags AND says warnings are unavailable.
   */
  it('is "unavailable" when the allergens were never read', async () => {
    await mount({ ...base, allergenIds: null });
    await waitFor(() => expect(screen.getByTestId('watchlist')).toHaveTextContent('unavailable|'));
  });

  it('is "ready" and empty when we asked and there genuinely are none', async () => {
    await mount({ ...base, allergenIds: [] });
    // Distinct from `unavailable` above: no flags either way, but this one is entitled to be
    // silent and that one is not.
    await waitFor(() => expect(screen.getByTestId('watchlist')).toHaveTextContent('ready|'));
  });

  it('names the allergens it will warn about', async () => {
    await mount({ ...base, allergenIds: ['a1', 'a2'] });
    await waitFor(() =>
      expect(screen.getByTestId('watchlist')).toHaveTextContent('ready|Peanuts,Milk'),
    );
  });

  it('is "unavailable" when the labels fail, even though the ids arrived', async () => {
    // Through the transport flag, not `jest.spyOn` — see the note on `beforeEach`.
    allergensFail = true;
    await mount({ ...base, allergenIds: ['a1'] });
    // A flag we cannot name is a flag nobody can act on.
    await waitFor(() => expect(screen.getByTestId('watchlist')).toHaveTextContent('unavailable|'));
  });

  it('still flags an id it cannot name rather than falling silent', async () => {
    await mount({ ...base, allergenIds: ['a-unknown'] });
    await waitFor(() =>
      expect(screen.getByTestId('watchlist')).toHaveTextContent(
        'ready|an allergen you told us about',
      ),
    );
  });
});
