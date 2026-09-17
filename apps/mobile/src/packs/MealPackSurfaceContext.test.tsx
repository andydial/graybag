import { render, screen, userEvent } from '@testing-library/react-native';
import { Text, Pressable } from 'react-native';

import { MealPackSurfaceProvider, useMealPackSurface } from './MealPackSurfaceContext';

/**
 * Mocked as a MODULE, not with `spyOn`.
 *
 * `api` is an ES module namespace object, so its properties are non-configurable and
 * `jest.spyOn(api, …)` throws `Cannot redefine property`. `packThisOrderDrawsFrom` keeps its real
 * behaviour — it is a pure selector and mocking it would hide whether the provider picks the
 * right pack, which is half of what this file is about.
 */
// `mock`-prefixed because a jest.mock factory may not reference any other out-of-scope variable.
const mockFetchSurface = jest.fn();
const mockFetchBalances = jest.fn();
jest.mock('@graybag/shared', () => ({
  api: {
    fetchMealPackSurface: (...args: unknown[]) => mockFetchSurface(...args),
    fetchMealPackBalances: (...args: unknown[]) => mockFetchBalances(...args),
    packThisOrderDrawsFrom: (
      balances: { schoolId: string; status: string; itemsRemaining: number; itemsReserved: number }[],
      schoolId: string,
    ) =>
      balances.find(
        (b) => b.schoolId === schoolId && b.status === 'active' &&
               b.itemsRemaining - b.itemsReserved > 0,
      ) ?? null,
  },
}));

/**
 * `E21-95`. **The surface must be re-read when something we did changed the answer.**
 *
 * Andy bought a pack on staging and the balance screen stayed empty. Nothing was wrong with the
 * data — the pack was `active`, settlement had completed, the invoice was issued, and reading as
 * the parent returned one row. The app simply never asked again: `meal_pack_surface` was last
 * called **108 seconds before the money moved**, and `meal_pack_balances` was never called at
 * all, because it is only called when `hasBalance` is already true.
 *
 * The effect keyed on `[userId, schoolId]`. Neither changes when you buy something, so a fetch
 * that was correct on mount outlived the event that invalidated it.
 *
 * These tests are about the mechanism rather than the screen: does calling `refresh()` actually
 * produce a second read, and does the second read's answer replace the first.
 */

jest.mock('../session/SelectedSchoolContext', () => ({
  useSelectedSchool: () => ({ schoolId: 's-1', schoolName: 'Amity' }),
}));
jest.mock('../session/SessionContext', () => ({
  useSession: () => ({ status: 'signedIn', userId: 'u-1' }),
}));

function Probe() {
  const surface = useMealPackSurface();
  return (
    <>
      <Text testID="has-balance">{String(surface.hasBalance)}</Text>
      <Text testID="pack-count">{String(surface.allPacks.length)}</Text>
      <Text testID="unavailable">{String(surface.unavailable)}</Text>
      <Pressable testID="refresh" onPress={surface.refresh}>
        <Text>refresh</Text>
      </Pressable>
    </>
  );
}

const BALANCE = {
  id: 'p-1',
  schoolId: 's-1',
  schoolName: 'Amity',
  name: 'Pack 1',
  itemsTotal: 20,
  itemsRemaining: 20,
  itemsReserved: 0,
  bonusItems: 2,
  bonusRemaining: 0,
  bonusGranted: false,
  bonusStillPossible: true,
  bonusWindowEndsAt: '2026-10-17T00:00:00Z',
  purchasedAt: '2026-09-17T06:57:39Z',
  expiresAt: '2026-11-16T06:57:39Z',
  status: 'active' as const,
  pricePaidPaise: 300_000,
  cgstPaise: 7_500,
  sgstPaise: 7_500,
};

beforeEach(() => {
  mockFetchSurface.mockReset();
  mockFetchBalances.mockReset();
});

it('RE-READS after refresh, and the new answer wins', async () => {
  /*
   * The bug, exactly: the first read says "no balance" because the purchase has not settled yet,
   * the second says "yes". Before `refresh()` existed the second read never happened and the
   * parent kept the first answer for the life of the mount.
   */
  const surfaceSpy = mockFetchSurface
    .mockResolvedValueOnce({ canBuy: true, hasBalance: false })
    .mockResolvedValueOnce({ canBuy: true, hasBalance: true });
  const balancesSpy = mockFetchBalances.mockResolvedValue([BALANCE]);

  await render(
    <MealPackSurfaceProvider>
      <Probe />
    </MealPackSurfaceProvider>,
  );

  // Before: the pre-purchase answer, and the pack list was never even requested.
  expect(await screen.findByTestId('has-balance')).toHaveTextContent('false');
  expect(balancesSpy).not.toHaveBeenCalled();
  expect(surfaceSpy).toHaveBeenCalledTimes(1);

  await userEvent.press(screen.getByTestId('refresh'));

  // After: asked again, and this time the numbers were fetched too.
  expect(await screen.findByTestId('has-balance')).toHaveTextContent('true');
  expect(await screen.findByTestId('pack-count')).toHaveTextContent('1');
  expect(surfaceSpy).toHaveBeenCalledTimes(2);
  expect(balancesSpy).toHaveBeenCalledTimes(1);
});

it('refreshes AGAIN on a second call, rather than latching', async () => {
  // A boolean "needs reload" flag would pass the test above and fail this one: already-true
  // changes nothing and the second read never fires. That is the same class of bug one level
  // down, which is why the counter is a counter.
  const surfaceSpy = mockFetchSurface.mockResolvedValue({ canBuy: true, hasBalance: false });
  mockFetchBalances.mockResolvedValue([]);

  await render(
    <MealPackSurfaceProvider>
      <Probe />
    </MealPackSurfaceProvider>,
  );
  await screen.findByTestId('has-balance');

  await userEvent.press(screen.getByTestId('refresh'));
  await userEvent.press(screen.getByTestId('refresh'));

  expect(surfaceSpy).toHaveBeenCalledTimes(3);
});

it('reports UNAVAILABLE when the server says there is a balance and the numbers will not load', async () => {
  /*
   * The state that must never render as "you have no pack". `hasBalance` is the server's word
   * that this parent is owed items; a failed numbers read is no reason to withdraw it, and every
   * reason to say so out loud.
   */
  mockFetchSurface.mockResolvedValue({ canBuy: true, hasBalance: true });
  mockFetchBalances.mockRejectedValue(new Error('network down'));

  await render(
    <MealPackSurfaceProvider>
      <Probe />
    </MealPackSurfaceProvider>,
  );

  expect(await screen.findByTestId('unavailable')).toHaveTextContent('true');
  // And the debt is NOT withdrawn just because the numbers failed.
  expect(screen.getByTestId('has-balance')).toHaveTextContent('true');
  expect(screen.getByTestId('pack-count')).toHaveTextContent('0');
});

it('is not unavailable when there is simply nothing to load', async () => {
  mockFetchSurface.mockResolvedValue({ canBuy: true, hasBalance: false });
  const balancesSpy = mockFetchBalances.mockResolvedValue([]);

  await render(
    <MealPackSurfaceProvider>
      <Probe />
    </MealPackSurfaceProvider>,
  );

  expect(await screen.findByTestId('unavailable')).toHaveTextContent('false');
  // A parent with no pack still costs exactly one request, which is the reason for the branch.
  expect(balancesSpy).not.toHaveBeenCalled();
});
