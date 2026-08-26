import { render, screen, userEvent } from '@testing-library/react-native';

import { MyPacksScreen, type PackBalance } from './MyPacksScreen';
import { PacksScreen } from './PacksScreen';

/**
 * `E21-36`. The three cases, as the parent meets them.
 *
 * Andy's rule and his amendment, both:
 *
 *   1. **Never offered here** — no concept. Nothing suggests packs exist.
 *   2. **Reached anyway** — a stale link or a bookmark gets the prototype's refusal. *"It's a
 *      fallback for a route nobody is given, not an entry point."*
 *   3. **Owns a pack at a school we switched off** — keeps the balance and can still spend it.
 *
 * Case 3 is the one asserted hardest here, because it is the one where a plausible
 * implementation — gate the whole feature on one "packs available" flag — is wrong in a way that
 * costs a parent money they have already paid.
 */

const mockTrack = jest.fn();
jest.mock('../analytics/analytics', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
  identifyParent: jest.fn(),
  analyticsOffReason: () => null,
  flushAnalytics: async () => {},
}));

let mockSurface = { canBuy: false, hasBalance: false, loading: false, allPacks: [] as unknown[] };
jest.mock('./MealPackSurfaceContext', () => ({
  useMealPackSurface: () => mockSurface,
  showsPackEntryPoint: (s: { canBuy: boolean; hasBalance: boolean }) => s.canBuy || s.hasBalance,
}));

let mockSchool = { schoolId: 's-1' as string | null, schoolName: 'Amity International School' };
jest.mock('../session/SelectedSchoolContext', () => ({
  useSelectedSchool: () => mockSchool,
}));

const mockOffers = jest.fn();
jest.mock('@graybag/shared', () => {
  const actual = jest.requireActual('@graybag/shared');
  return {
    ...actual,
    api: { ...actual.api, fetchMealPackOffers: (...a: unknown[]) => mockOffers(...a) },
  };
});

const OFFER = {
  id: 'o-1',
  name: '10 meal pack',
  mealsCount: 10,
  itemsPerMeal: 2,
  requiredCategoryId: 'cat-1',
  netPricePaise: 300000,
  alacarteReferencePaise: 337500,
  validityDays: 60,
};

const BALANCE: PackBalance = {
  packName: '10 meal pack',
  mealsTotal: 10,
  mealsRemaining: 7,
  purchasedLabel: '12 Aug 2026',
  expiresLabel: '11 Oct 2026',
  expired: false,
};

beforeEach(() => {
  mockTrack.mockClear();
  mockOffers.mockReset();
  mockSurface = { canBuy: false, hasBalance: false, loading: false, allPacks: [] };
  mockSchool = { schoolId: 's-1', schoolName: 'Amity International School' };
});

describe('case 2 — the offers screen reached when packs are not sold here', () => {
  it('shows the designed refusal, not an empty list', async () => {
    await render(<PacksScreen />);
    expect(screen.getByTestId('screen-packs-not-offered')).toBeTruthy();
    expect(screen.getByText(/aren’t offered at this school/)).toBeTruthy();
  });

  it('names the school, so the refusal is about somewhere rather than everywhere', async () => {
    await render(<PacksScreen />);
    expect(screen.getByText(/Amity International School takes single orders only/)).toBeTruthy();
  });

  it('does not even ASK the server for offers', async () => {
    // The gate already answered. A request here would be a spinner promising something that is
    // not coming, and a needless call on a school-gate connection.
    await render(<PacksScreen />);
    expect(mockOffers).not.toHaveBeenCalled();
  });

  it('emits nothing itself — the navigator owns screen_viewed for a real route', async () => {
    // This used to assert the screen emitted `packs`. Once `Packs` became a registered route the
    // navigator's own listener emitted it too, and `screens.test.ts` caught the double count.
    // The claim it was making — "a stale link is a real visit, and worth counting" — is still
    // true and is now asserted where it holds: `screenNameFor('Packs') === 'packs'`, so the
    // refusal state is reported exactly like any other screen, by one emitter.
    await render(<PacksScreen />);
    expect(mockTrack.mock.calls.filter(([e]) => e === 'screen_viewed')).toHaveLength(0);
  });
});

describe('case 2 — the offers screen when packs ARE sold here', () => {
  beforeEach(() => {
    mockSurface = { canBuy: true, hasBalance: false, loading: false, allPacks: [] };
  });

  it('lists what is on sale', async () => {
    mockOffers.mockResolvedValue([OFFER]);
    await render(<PacksScreen />);
    expect(await screen.findByTestId('screen-packs-offer-o-1')).toBeTruthy();
    expect(screen.getByText('10 meal pack')).toBeTruthy();
  });

  it('shows the saving against buying the meals singly', async () => {
    mockOffers.mockResolvedValue([OFFER]);
    await render(<PacksScreen />);
    expect(await screen.findByText(/save/)).toBeTruthy();
  });

  it('distinguishes "we could not ask" from "there are none"', async () => {
    // §5.21. A failed read must not render as an absence of mockOffers.
    mockOffers.mockRejectedValue(new Error('network'));
    await render(<PacksScreen />);
    expect(await screen.findByTestId('screen-packs-error')).toBeTruthy();
    expect(screen.queryByTestId('screen-packs-not-offered')).toBeNull();
  });

  it('emits no amount when an offer is opened', async () => {
    mockOffers.mockResolvedValue([OFFER]);
    const onOpenOffer = jest.fn();
    await render(<PacksScreen onOpenOffer={onOpenOffer} />);
    await userEvent.press(await screen.findByTestId('screen-packs-offer-o-1'));

    expect(onOpenOffer).toHaveBeenCalledWith('o-1');
    const [, properties] = mockTrack.mock.calls.find(([e]) => e === 'pack_offer_opened') ?? [];
    // The offer id and the price are both absent on purpose — `D4`. Which offers get opened is
    // answerable from our own database.
    expect(JSON.stringify(properties ?? {})).not.toMatch(/o-1|300000|337500/);
  });
});

describe('case 3 — a parent who owns a pack at a school we switched off', () => {
  beforeEach(() => {
    // The exact state: selling is off, the balance is not.
    mockSurface = { canBuy: false, hasBalance: true, loading: false, allPacks: [] };
  });

  it('still shows the balance', async () => {
    await render(<MyPacksScreen balance={BALANCE} />);
    expect(screen.getByTestId('screen-my-packs-balance')).toBeTruthy();
    expect(screen.getByText('7 of 10')).toBeTruthy();
  });

  it('STILL OFFERS TO SPEND IT — the button that must not vanish', async () => {
    // This is the assertion that would have failed under "gate everything on canBuy", and the
    // failure would have been a parent unable to reach meals they had already paid for.
    const onPlanMeals = jest.fn();
    await render(<MyPacksScreen balance={BALANCE} onPlanMeals={onPlanMeals} />);
    await userEvent.press(screen.getByText('Plan meals from this pack'));
    expect(onPlanMeals).toHaveBeenCalled();
  });

  it('does NOT offer to sell another, because that part really is switched off', async () => {
    const onSeeOffers = jest.fn();
    await render(
      <MyPacksScreen balance={{ ...BALANCE, mealsRemaining: 0 }} onSeeOffers={onSeeOffers} />,
    );
    expect(screen.getByText(/used every meal/)).toBeTruthy();
    expect(screen.queryByText('Buy another')).toBeNull();
  });

  it('offers to sell again once the school is switched back on', async () => {
    mockSurface = { canBuy: true, hasBalance: true, loading: false, allPacks: [] };
    const onSeeOffers = jest.fn();
    await render(
      <MyPacksScreen balance={{ ...BALANCE, mealsRemaining: 0 }} onSeeOffers={onSeeOffers} />,
    );
    await userEvent.press(screen.getByText('Buy another'));
    expect(onSeeOffers).toHaveBeenCalled();
  });
});

describe('the three empties are three different sentences', () => {
  it('no pack at all', async () => {
    mockSurface = { canBuy: true, hasBalance: false, loading: false, allPacks: [] };
    await render(<MyPacksScreen balance={null} />);
    expect(screen.getByText(/don’t have a meal pack/)).toBeTruthy();
  });

  it('every meal spent — recoverable, and says how', async () => {
    mockSurface = { canBuy: true, hasBalance: true, loading: false, allPacks: [] };
    await render(<MyPacksScreen balance={{ ...BALANCE, mealsRemaining: 0 }} />);
    expect(screen.getByText(/used every meal/)).toBeTruthy();
    expect(screen.getByText(/spent oldest first/)).toBeTruthy();
  });

  it('expired — says plainly that the meals are gone, and does not offer to plan', async () => {
    mockSurface = { canBuy: true, hasBalance: false, loading: false, allPacks: [] };
    const onPlanMeals = jest.fn();
    await render(
      <MyPacksScreen balance={{ ...BALANCE, expired: true }} onPlanMeals={onPlanMeals} />,
    );
    expect(screen.getByText('This pack has expired')).toBeTruthy();
    expect(screen.getByText(/Unused meals are gone/)).toBeTruthy();
    expect(screen.queryByText('Plan meals from this pack')).toBeNull();
  });

  it('an expired pack shows no progress meter, which would imply something remains', async () => {
    mockSurface = { canBuy: true, hasBalance: false, loading: false, allPacks: [] };
    await render(<MyPacksScreen balance={{ ...BALANCE, expired: true }} />);
    expect(screen.queryByTestId('screen-my-packs-meter')).toBeNull();
  });
});

describe('E21-49 — two packs, both visible, with the order explained', () => {
  const SECOND: PackBalance = {
    packName: '20 meal pack',
    mealsTotal: 20,
    mealsRemaining: 20,
    purchasedLabel: '20 Aug 2026',
    expiresLabel: '18 Nov 2026',
    expired: false,
  };

  beforeEach(() => {
    mockSurface = { canBuy: true, hasBalance: true, loading: false, allPacks: [] };
  });

  it('shows the second pack with its OWN expiry', async () => {
    // The failure this prevents: a 3-meal pack expiring Friday sitting invisible behind a
    // 10-meal pack expiring in October. A summed total cannot answer "when do I lose these",
    // and neither can showing only one pack.
    await render(<MyPacksScreen balance={BALANCE} otherPacks={[SECOND]} />);
    expect(screen.getByTestId('screen-my-packs-other-packs')).toBeTruthy();
    expect(screen.getByText(/20 of 20 · 20 meal pack/)).toBeTruthy();
    expect(screen.getByText(/Expires 18 Nov 2026/)).toBeTruthy();
  });

  it('says WHY one comes before the other', async () => {
    // A list with no explanation leaves a parent to infer the ordering, and the inference most
    // people make — biggest first, or newest first — is wrong.
    await render(<MyPacksScreen balance={BALANCE} otherPacks={[SECOND]} />);
    expect(screen.getByText(/expires soonest/)).toBeTruthy();
  });

  it('shows nothing extra for a parent with one pack', async () => {
    await render(<MyPacksScreen balance={BALANCE} otherPacks={[]} />);
    expect(screen.queryByTestId('screen-my-packs-other-packs')).toBeNull();
  });

  it('marks an expired second pack as expired rather than showing a count', async () => {
    await render(
      <MyPacksScreen balance={BALANCE} otherPacks={[{ ...SECOND, expired: true }]} />,
    );
    expect(screen.getByText(/Expired 18 Nov 2026/)).toBeTruthy();
  });
});
