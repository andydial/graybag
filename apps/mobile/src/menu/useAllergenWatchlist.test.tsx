import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { api } from '@graybag/shared';

import { useAllergenWatchlist, useRecipientWatchlist } from './useAllergenWatchlist';
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

/**
 * `useRecipientWatchlist` — `E21-51`.
 *
 * The planner picks a child per day, so it cannot ask `OrderTargetContext` whose allergies
 * matter. This hook answers for a recipient the caller names, and it has to keep the same three
 * states, because the planner is the screen where losing the distinction costs most: a parent
 * chooses food for several days at once, so one silent "unchecked reads as safe" multiplies.
 */
function RecipientProbe({ recipientId }: { recipientId: string }) {
  const watchlist = useRecipientWatchlist(recipientId);
  const detail =
    watchlist.status === 'ready' ? watchlist.avoid.map((a) => a.label).join(',') : '';
  return <Text testID="watchlist">{`${watchlist.status}|${detail}`}</Text>;
}

describe('useRecipientWatchlist', () => {
  let allergenRowsFail = false;
  let linked = true;
  let allergenRowsHang = false;

  beforeEach(() => {
    allergenRowsFail = false;
    linked = true;
    allergenRowsHang = false;
    const builder = (data: unknown, error: unknown = null) => {
      const b: Record<string, unknown> = {};
      b.eq = () => b;
      b.is = () => b;
      b.order = () => b;
      b.then = (onfulfilled: (r: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve({ data, error }).then(onfulfilled);
      return b;
    };

    /** A read that never settles — the only way to observe the window before an answer. */
    const hanging = () => {
      const b: Record<string, unknown> = {};
      b.eq = () => b;
      b.is = () => b;
      b.order = () => b;
      b.then = () => new Promise(() => {});
      return b;
    };

    api.setApiTransport({
      from: (table: string) => ({
        select: () => {
          if (table === 'allergen') {
            return builder([
              { id: 'a1', code: 'peanut', display_name: 'Peanuts', is_major: true },
              { id: 'a2', code: 'milk', display_name: 'Milk', is_major: true },
            ]);
          }
          if (table === 'guardian_link') {
            return builder(linked ? [{ recipient_id: 'r-9' }] : []);
          }
          if (table === 'recipient_allergen') {
            if (allergenRowsHang) return hanging();
            return allergenRowsFail
              ? builder(null, { message: 'network' })
              : builder([{ allergen_id: 'a1' }]);
          }
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

  it('is "none" with no recipient — the planner has no day open', async () => {
    await render(<RecipientProbe recipientId="" />);
    expect(screen.getByTestId('watchlist')).toHaveTextContent('none|');
  });

  it('is "unavailable" BEFORE the read resolves, never "ready" with nothing', async () => {
    // The window that would otherwise render a dish with no warning while the answer is still in
    // flight, which a parent reads as "checked, and safe".
    allergenRowsHang = true;
    await render(<RecipientProbe recipientId="r-9" />);
    expect(screen.getByTestId('watchlist')).toHaveTextContent('unavailable|');
  });

  it('names the allergens once they arrive', async () => {
    await render(<RecipientProbe recipientId="r-9" />);
    await waitFor(() => expect(screen.getByTestId('watchlist')).toHaveTextContent('ready|Peanuts'));
  });

  /** The safety property. A failed read is "we cannot tell you", never "there are none". */
  it('is "unavailable" when the allergen read fails', async () => {
    allergenRowsFail = true;
    await render(<RecipientProbe recipientId="r-9" />);
    await waitFor(() => expect(screen.getByTestId('watchlist')).toHaveTextContent('unavailable|'));
    expect(screen.getByTestId('watchlist')).not.toHaveTextContent('ready');
  });

  it('is "ready" and empty when the child genuinely has none', async () => {
    linked = false; // no guardian link → the function answers `[]`, which is a real answer
    await render(<RecipientProbe recipientId="r-9" />);
    await waitFor(() => expect(screen.getByTestId('watchlist')).toHaveTextContent('ready|'));
  });

  it('does not carry one child’s clean result over to the next child', async () => {
    // Two days, two children. Without the reset the second child inherits the first child's
    // answer for as long as the fetch takes — a warning, or the absence of one, about the
    // wrong person.
    const view = await render(<RecipientProbe recipientId="r-9" />);
    await waitFor(() => expect(screen.getByTestId('watchlist')).toHaveTextContent('ready|Peanuts'));

    // The second child's read is left in flight, which is the only window in which a stale
    // answer is observable. Holding the previous child's result keyed to the previous child,
    // the hook cannot serve it here; resetting in an effect, it serves it for a frame.
    allergenRowsHang = true;
    await view.rerender(<RecipientProbe recipientId="r-other" />);
    expect(screen.getByTestId('watchlist')).toHaveTextContent('unavailable|');
  });
});
