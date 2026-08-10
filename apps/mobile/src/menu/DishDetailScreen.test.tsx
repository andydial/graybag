import { render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { cart as cartDomain, menu as menuDomain } from '@graybag/shared';

import { CartProvider, useCart } from '../cart/CartContext';
import {
  DishDetailScreen,
  allergenLabel,
  dishAllergenView,
  recipientVoice,
  type DishDetailTarget,
} from './DishDetailScreen';
import { setMenuCache, type CachedMenuPayload } from './useCachedMenu';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const SCHOOL = 'school-1';

const PAYLOAD: CachedMenuPayload = {
  categories: [{ id: 'drinks', label: 'Drinks' }],
  dishes: [
    {
      id: 'd1',
      menuItemId: 'mi-d1',
      name: 'Cold Coffee',
      description: 'Chilled, with milk',
      categoryId: 'drinks',
      foodType: 'veg',
      ingredientsText: 'milk, coffee, sugar',
      pricePaise: 7_550,
      imageUri: 'https://example.test/cold-coffee.jpg',
      allergens: [{ allergenId: 'milk', presence: 'contains' }],
      allergensDeclaredNone: false,
    },
    {
      // Nobody has said. NOT "no allergens" — MI1/MI7/0006.
      id: 'd2',
      menuItemId: 'mi-d2',
      name: 'Veg Sandwich',
      description: null,
      categoryId: 'drinks',
      foodType: 'non_veg',
      ingredientsText: null,
      pricePaise: 6_000,
      imageUri: null,
      allergens: [],
      allergensDeclaredNone: false,
    },
    {
      id: 'd3',
      menuItemId: 'mi-d3',
      name: 'Fruit Bowl',
      description: null,
      categoryId: 'drinks',
      foodType: 'veg',
      ingredientsText: 'seasonal fruit',
      pricePaise: 5_500,
      imageUri: null,
      allergens: [],
      allergensDeclaredNone: true,
    },
  ],
};

function fakeCache(result: Partial<{ stale: boolean; reject: boolean }> = {}) {
  const get = jest.fn(async () => {
    if (result.reject) throw new Error('nothing cached and offline');
    return { menu: PAYLOAD, version: 1, stale: result.stale ?? false, refetched: false };
  });
  return { get, invalidate: jest.fn(async () => {}) } as never;
}

/**
 * A child with a milk allergy.
 *
 * The allergen ids are regulated health data (DPDP, non-negotiable #4). They are asserted on
 * only through what the screen *does* with them — nothing in this file expects them to be
 * rendered, and nothing may log them. The **name** is a different matter: §5.6 requires the
 * confirmation to say whose allergy it is, so the name is expected on screen and the id is
 * expected never to be.
 */
/** Asserted to be a real service date rather than trusted as a literal. */
const SERVICE_DATE = '2026-09-01';
if (!menuDomain.isServiceDate(SERVICE_DATE)) throw new Error('fixture is not a service date');

const TARGET: DishDetailTarget = {
  recipientId: 'r1',
  recipientName: 'Aarav',
  className: 'Class 5-A',
  schoolName: 'Alpha Public School',
  breakLabel: 'Morning break · 10:40',
  allergenIds: ['milk'],
  serviceDate: SERVICE_DATE,
};

const NO_ALLERGIES: DishDetailTarget = {
  ...TARGET,
  recipientId: 'r2',
  recipientName: 'Meera',
  allergenIds: [],
};

/** The same allergy, with the health-data purpose declined. We may not check. */
const NO_CONSENT: DishDetailTarget = { ...TARGET, allergenConsent: false };

/** The account holder ordering for themselves. "For you", never "your child". */
const MYSELF: DishDetailTarget = { ...TARGET, recipientName: null, allergenIds: [] };

/**
 * An id and no display name — the state the app is in today, because `OrderTargetContext`
 * does not carry one yet. The copy has to stay neutral rather than guess a relationship.
 */
const UNNAMED: DishDetailTarget = {
  recipientId: 'r4',
  allergenIds: [],
  serviceDate: SERVICE_DATE,
};

/** Reads the live cart out of the provider, so adds are asserted against the domain object. */
let seenCart: cartDomain.Cart = cartDomain.emptyCart();
function CartProbe() {
  seenCart = useCart().cart;
  return null;
}

async function renderDish(
  dishId: string,
  {
    schoolId = SCHOOL,
    target = null,
    ordering,
    onBackToMenu,
    onChangeTarget,
  }: {
    schoolId?: string | null;
    target?: DishDetailTarget | null;
    ordering?: { closed: boolean; nextOpenDate?: string | null };
    onBackToMenu?: () => void;
    onChangeTarget?: () => void;
  } = {},
) {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <CartProvider>
        <CartProbe />
        <DishDetailScreen
          dishId={dishId}
          schoolId={schoolId}
          target={target}
          {...(ordering === undefined ? {} : { ordering })}
          {...(onBackToMenu === undefined ? {} : { onBackToMenu })}
          {...(onChangeTarget === undefined ? {} : { onChangeTarget })}
        />
      </CartProvider>
    </SafeAreaProvider>,
  );
  // `onNeedsTarget` is gone with `E05-32` — there is nowhere to send anyone before adding.
  return {};
}

afterEach(() => {
  setMenuCache(null);
  seenCart = cartDomain.emptyCart();
});

describe('DishDetailScreen', () => {
  it('shows the dish from the cached menu with no session anywhere in sight', async () => {
    // AR7: there is no session provider in this test at all, and it renders.
    setMenuCache(fakeCache());
    await renderDish('d1');

    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());
    expect(screen.getByText('Chilled, with milk')).toBeOnTheScreen();
    expect(screen.getByText('milk, coffee, sugar')).toBeOnTheScreen();
    // `includeHiddenElements` because the hero is decorative and hidden from accessibility —
    // a dish image next to the dish's own name adds nothing to announce.
    expect(
      screen.getByTestId('screen-dish-detail-image', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
  });

  it('names the dish as a heading, so a screen reader lands on it', async () => {
    setMenuCache(fakeCache());
    await renderDish('d1');
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());
    expect(screen.getAllByRole('header')[0]).toHaveTextContent('Cold Coffee');
  });

  it('formats the price from integer paise, dividing only to display it', async () => {
    setMenuCache(fakeCache());
    await renderDish('d1');
    // 7550 paise. The number that travels is paise; this is the only place it is divided.
    await waitFor(() => expect(screen.getByTestId('screen-dish-detail-price')).toHaveTextContent(
      '₹75.50',
    ));
  });

  it('puts the price on the button too, so the decision and the number are together', async () => {
    setMenuCache(fakeCache());
    await renderDish('d1');
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());
    expect(screen.getByTestId('screen-dish-detail-add-button')).toHaveTextContent(
      'Add to cart · ₹75.50',
    );
  });

  it('says the price excludes GST, because the button is not what will be charged', async () => {
    setMenuCache(fakeCache());
    await renderDish('d1');
    await waitFor(() =>
      expect(screen.getByTestId('screen-dish-detail-tax-note')).toHaveTextContent(
        'Price excludes GST. 5% is added at checkout.',
      ),
    );
  });

  it('omits the description and ingredients rather than printing empty headings', async () => {
    setMenuCache(fakeCache());
    await renderDish('d2');
    await waitFor(() => expect(screen.getByText('Veg Sandwich')).toBeOnTheScreen());
    expect(screen.queryByTestId('screen-dish-detail-description')).toBeNull();
    expect(screen.queryByTestId('screen-dish-detail-ingredients')).toBeNull();
  });

  // The line carries BOTH now (`0023`): the veg/egg/non-veg word and the category. Asserting
  // the whole string rather than just the category is strictly more than it checked before —
  // and it is the half an Indian parent reads first.
  it('shows whether it is vegetarian, and the category, under the name', async () => {
    setMenuCache(fakeCache());
    await renderDish('d1');
    await waitFor(() =>
      expect(screen.getByTestId('screen-dish-detail-food-type')).toHaveTextContent(
        'Pure vegetarian · Drinks',
      ),
    );
  });

  /**
   * `E21`. Every dish in staging has no image until the mirrored catalogue is uploaded, so
   * this is most of the menu rather than an edge case — and a grey box on most of the menu
   * reads as broken.
   */
  it('draws a pattern tile for a dish with no photo, never a grey box', async () => {
    setMenuCache(fakeCache());
    await renderDish('d3');
    await waitFor(() => expect(screen.getByText('Fruit Bowl')).toBeOnTheScreen());
    expect(
      screen.getByTestId('screen-dish-detail-image', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
  });

  /**
   * `docs/ux-spec.md` §5.6 — four renderings, and the difference between them is the safety
   * property rather than the wording.
   */
  describe('the allergen block (D7, MI1, MI7)', () => {
    it('lists the kitchen declaration when we can check and nothing clashes', async () => {
      setMenuCache(fakeCache());
      await renderDish('d1', { target: NO_ALLERGIES });
      await waitFor(() => expect(screen.getByText('Contains Milk')).toBeOnTheScreen());
      expect(screen.getByTestId('screen-dish-detail-allergens-declared')).toHaveTextContent(
        /None of these is one of Meera's/,
      );
    });

    /**
     * The state the whole block exists for. An empty tag list and an unanswered question are
     * opposite facts wearing the same shape, and the wrong version of this screen is one line
     * long: rendering nothing.
     */
    it('says "not provided" for a dish nobody has described, and never calls it safe', async () => {
      setMenuCache(fakeCache());
      await renderDish('d2', { target: NO_ALLERGIES });

      await waitFor(() =>
        expect(screen.getByText('Allergen information not provided')).toBeOnTheScreen(),
      );
      expect(screen.getByTestId('screen-dish-detail-allergens-not-provided')).toHaveTextContent(
        /not the same as/,
      );
      // No reassurance is available for this dish, and there must be none on screen.
      expect(screen.queryByTestId('screen-dish-detail-allergens-none')).toBeNull();
      expect(screen.queryByText('No allergens')).toBeNull();
    });

    it('reassures only when the kitchen explicitly declared none', async () => {
      setMenuCache(fakeCache());
      await renderDish('d3', { target: NO_ALLERGIES });
      await waitFor(() =>
        expect(screen.getByTestId('screen-dish-detail-allergens-none')).toBeOnTheScreen(),
      );
      expect(screen.queryByText('Allergen information not provided')).toBeNull();
    });

    it('names the recipient and the allergen when it clashes', async () => {
      setMenuCache(fakeCache());
      await renderDish('d1', { target: TARGET });
      await waitFor(() =>
        expect(screen.getByTestId('screen-dish-detail-allergens-clash')).toBeOnTheScreen(),
      );
      const block = screen.getByTestId('screen-dish-detail-allergens-clash');
      expect(block).toHaveTextContent(/Aarav is allergic to Milk/);
      // Still orderable — the block informs, it does not forbid. §5.6.
      expect(block).toHaveTextContent(/You can still order it/);
      expect(screen.getByTestId('screen-dish-detail-add-button')).toHaveTextContent(
        'Add to cart · ₹75.50',
      );
    });

    /**
     * **The signed-out case is a safety defect if got wrong, and it was.** The prototype once
     * rendered a warning naming a child while signed out, where no child and no allergen data
     * exist. A warning is a claim about data we hold.
     */
    it('with no recipient, says we cannot check and names nobody', async () => {
      setMenuCache(fakeCache());
      await renderDish('d1');

      await waitFor(() =>
        expect(screen.getByTestId('screen-dish-detail-allergens-cannot-check')).toBeOnTheScreen(),
      );
      expect(screen.getByText("We can't check this for anyone yet")).toBeOnTheScreen();
      // The kitchen's own declaration still stands — it is a fact about the dish.
      expect(screen.getByTestId('screen-dish-detail-allergens-declaration')).toHaveTextContent(
        /The kitchen declares this dish contains Milk\./,
      );
      // No person, no clash, no reassurance.
      expect(screen.queryByText(/Aarav/)).toBeNull();
      expect(screen.queryByTestId('screen-dish-detail-allergens-clash')).toBeNull();
      expect(screen.queryByTestId('screen-dish-detail-allergens-none')).toBeNull();
    });

    /**
     * Consent withheld is not the same as "no allergies". Without the separate health-data
     * purpose we hold nothing to check against, so the silence that would otherwise read as
     * safety has to be replaced by saying so.
     */
    it('with allergen consent withheld, says we cannot check rather than clearing the dish', async () => {
      setMenuCache(fakeCache());
      await renderDish('d1', { target: NO_CONSENT });

      await waitFor(() =>
        expect(screen.getByTestId('screen-dish-detail-allergens-cannot-check')).toBeOnTheScreen(),
      );
      expect(screen.getByText("We can't check this against Aarav's allergies")).toBeOnTheScreen();
      expect(screen.getByTestId('screen-dish-detail-allergens-declaration')).toHaveTextContent(/contains Milk/);
      expect(screen.queryByTestId('screen-dish-detail-allergens-clash')).toBeNull();
    });

    it('says the kitchen has said nothing, rather than saying nothing, when we cannot check', async () => {
      setMenuCache(fakeCache());
      await renderDish('d2');
      await waitFor(() =>
        expect(screen.getByTestId('screen-dish-detail-allergens-declaration')).toHaveTextContent(
          /The kitchen has not told us what is in this dish either way\./,
        ),
      );
    });

    it('is the domain rule, not this screen re-deciding it', () => {
      const milk = {
        allergens: [{ allergenId: 'milk', presence: 'contains' as const }],
        allergensDeclaredNone: false,
      };
      // Clash only via `allergenWarning`, and only with a recipient we may check.
      expect(dishAllergenView(milk, TARGET)).toEqual({ kind: 'clash', allergenIds: ['milk'] });
      expect(dishAllergenView(milk, NO_ALLERGIES)).toEqual({
        kind: 'declared',
        allergenIds: ['milk'],
      });
      expect(dishAllergenView(milk, null).kind).toBe('cannotCheck');
      expect(dishAllergenView(milk, NO_CONSENT).kind).toBe('cannotCheck');
      // `unknown` is a warning in the domain and is NOT a clash on screen (MI7).
      expect(
        dishAllergenView({ allergens: [], allergensDeclaredNone: false }, TARGET),
      ).toEqual({ kind: 'notProvided' });
      expect(menuDomain.allergenWarning(milk, ['milk'])).toEqual({
        warn: true,
        reason: 'match',
        allergenIds: ['milk'],
      });
    });

    it('spells out "may contain" rather than folding it into "contains"', () => {
      expect(allergenLabel({ allergenId: 'tree_nuts', presence: 'contains' })).toBe('Tree nuts');
      expect(allergenLabel({ allergenId: 'peanut', presence: 'may_contain' })).toBe(
        'Peanut — may contain',
      );
    });
  });

  /**
   * §5.6: "a parent must never be one tap from paying without seeing whose lunch this is and
   * when it is handed over".
   */
  describe('the For block', () => {
    it('names the recipient, the class, the school and the day', async () => {
      setMenuCache(fakeCache());
      await renderDish('d3', { target: TARGET });

      await waitFor(() => expect(screen.getByText('For Aarav')).toBeOnTheScreen());
      expect(screen.getByTestId('screen-dish-detail-for')).toHaveTextContent(/Class 5-A/);
      expect(screen.getByTestId('screen-dish-detail-for')).toHaveTextContent(
        /Alpha Public School/,
      );
      // R7: the full month, never "01/09".
      expect(screen.getByTestId('screen-dish-detail-for-when')).toHaveTextContent(/September/);
    });

    it('says "For you" when the recipient is the account holder, never "your child"', async () => {
      setMenuCache(fakeCache());
      await renderDish('d3', { target: MYSELF });
      await waitFor(() => expect(screen.getByText('For you')).toBeOnTheScreen());
      expect(screen.queryByText(/your child/i)).toBeNull();
    });

    it('signed out, says nobody is chosen and that adding still works', async () => {
      setMenuCache(fakeCache());
      await renderDish('d3');
      await waitFor(() => expect(screen.getByText('Nobody chosen yet')).toBeOnTheScreen());
      expect(screen.getByTestId('screen-dish-detail-for-none')).toHaveTextContent(
        /Adding to your cart works without this/,
      );
    });

    it('offers the switcher only when there is somewhere to switch', async () => {
      setMenuCache(fakeCache());
      const onChangeTarget = jest.fn();
      await renderDish('d3', { target: TARGET, onChangeTarget });
      await waitFor(() => expect(screen.getByText('For Aarav')).toBeOnTheScreen());

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-for-change'));
      expect(onChangeTarget).toHaveBeenCalledTimes(1);
    });

    it('has no switcher when the screen was given nowhere to send anyone', async () => {
      setMenuCache(fakeCache());
      await renderDish('d3', { target: TARGET });
      await waitFor(() => expect(screen.getByText('For Aarav')).toBeOnTheScreen());
      expect(screen.queryByTestId('screen-dish-detail-for-change')).toBeNull();
    });
  });

  it('says the dish has gone rather than showing an error', async () => {
    setMenuCache(fakeCache());
    await renderDish('does-not-exist');
    await waitFor(() =>
      expect(screen.getByText('This dish is not on the menu')).toBeOnTheScreen(),
    );
    expect(screen.queryByTestId('error-state')).toBeNull();
    // Nothing to add, so there is no add button to disable.
    expect(screen.queryByTestId('screen-dish-detail-add-button')).toBeNull();
  });

  it('offers the way back when the dish has gone and there is one', async () => {
    setMenuCache(fakeCache());
    const onBackToMenu = jest.fn();
    await renderDish('does-not-exist', { onBackToMenu });
    await waitFor(() =>
      expect(screen.getByText('This dish is not on the menu')).toBeOnTheScreen(),
    );

    await userEvent.setup().press(screen.getByLabelText('Back to the menu'));
    expect(onBackToMenu).toHaveBeenCalledTimes(1);
  });

  it('shows a stale menu with a quiet notice, not an error (P8, MC3)', async () => {
    setMenuCache(fakeCache({ stale: true }));
    await renderDish('d1');
    await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());
    expect(screen.getByTestId('screen-dish-detail-stale')).toHaveTextContent(
      /Offline — showing the menu you last loaded/,
    );
    // Offline the cart still fills — it is local. The price is what gets reconfirmed (L7).
    expect(screen.getByTestId('screen-dish-detail-stale')).toHaveTextContent(
      /reconfirm the price/,
    );
    expect(screen.queryByTestId('error-state')).toBeNull();
    expect(screen.getByTestId('screen-dish-detail-add-button')).toBeOnTheScreen();
  });

  it('errors only when there is nothing cached and the fetch failed', async () => {
    setMenuCache(fakeCache({ reject: true }));
    await renderDish('d1');
    await waitFor(() => expect(screen.getByTestId('error-state')).toBeOnTheScreen());
    expect(screen.getByLabelText('Try again')).toBeOnTheScreen();
  });

  describe('adding to the cart', () => {
    /**
     * The identity rule. A cart line is the **menu item** — what is being offered, on which
     * menu, at what price — and not the dish, because two menus can offer the same food for
     * different money. Getting these the wrong way round produces a cart that looks right and
     * a checkout that cannot resolve a line.
     */
    it('adds a line identified by menuItemId, not dishId', async () => {
      setMenuCache(fakeCache());
      await renderDish('d3', { target: NO_ALLERGIES });
      await waitFor(() => expect(screen.getByText('Fruit Bowl')).toBeOnTheScreen());

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-button'));

      await waitFor(() => expect(seenCart.lines).toHaveLength(1));
      expect(seenCart.lines[0]).toMatchObject({
        menuItemId: 'mi-d3',
        dishId: 'd3',
        key: cartDomain.lineKey({
          recipientId: 'r2',
          serviceDate: TARGET.serviceDate,
          menuItemId: 'mi-d3',
          comment: null,
        }),
      });
    });

    it('snapshots the price the parent was looking at, in paise (L7)', async () => {
      setMenuCache(fakeCache());
      await renderDish('d3', { target: NO_ALLERGIES });
      await waitFor(() => expect(screen.getByText('Fruit Bowl')).toBeOnTheScreen());

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-button'));

      await waitFor(() => expect(seenCart.lines).toHaveLength(1));
      // Integer paise, exactly as it came off the menu. Checkout compares against this.
      expect(seenCart.lines[0]).toMatchObject({
        unitPricePaise: 5_500,
        quantity: 1,
        recipientId: 'r2',
        serviceDate: TARGET.serviceDate,
      });
    });

    it('confirms the add without navigating away from the dish', async () => {
      setMenuCache(fakeCache());
      await renderDish('d3', { target: NO_ALLERGIES });
      await waitFor(() => expect(screen.getByText('Fruit Bowl')).toBeOnTheScreen());

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-button'));
      await waitFor(() =>
        expect(screen.getByTestId('screen-dish-detail-add-added')).toBeOnTheScreen(),
      );
      expect(screen.getByText('Fruit Bowl')).toBeOnTheScreen();
    });

    /**
     * REPLACED, and the old assertion is worth recording because it encoded the defect.
     *
     * It used to assert that with nobody to order for, the add button is ABSENT and nothing is
     * added — the screen offered "Add a child" instead. That reads like `AR7` care, and it was
     * the opposite: `R1` says the cart fills signed out and the only gate is checkout, so
     * refusing to add was a wall in front of the cart.
     *
     * It also had an effect nobody traced until Andy did: the app's ONLY `navigate('SignIn')`
     * is the cart's Place order button, so a visitor who could not fill a cart could not reach
     * sign-in at all. A green test was holding the front door shut (`E05-32`).
     */
    it('adds to the cart with nobody to order for — the recipient is chosen at the gate', async () => {
      setMenuCache(fakeCache());
      await renderDish('d3');
      await waitFor(() => expect(screen.getByText('Fruit Bowl')).toBeOnTheScreen());

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-button'));

      expect(seenCart.lines).toHaveLength(1);
      // Null rather than a stand-in: there genuinely is no recipient yet, and inventing one
      // is how a line ends up attributed to the wrong child at checkout.
      expect(seenCart.lines[0]?.recipientId).toBeNull();
      expect(seenCart.lines[0]?.serviceDate).toBeNull();
    });

    it('says who it will be for, rather than leaving the absence unexplained', async () => {
      setMenuCache(fakeCache());
      await renderDish('d3');
      await waitFor(() => expect(screen.getByText('Fruit Bowl')).toBeOnTheScreen());

      expect(screen.getByTestId('screen-dish-detail-add-no-target')).toBeTruthy();
    });

    // With no recipient there is nobody to check against, so no warning can exist. Rendering
    // one would be the §5.21 defect in its most dangerous form — a safety claim from data we
    // do not hold.
    it('raises no allergen warning when there is no recipient to check against', async () => {
      setMenuCache(fakeCache());
      await renderDish('d1');
      await waitFor(() => expect(screen.getByTestId('screen-dish-detail-add-button')).toBeTruthy());

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-button'));

      expect(seenCart.lines).toHaveLength(1);
      expect(screen.queryByTestId('screen-dish-detail-add-warning-body')).toBeNull();
    });

    it('cannot be added once the day has closed, and says which day to try instead', async () => {
      setMenuCache(fakeCache());
      await renderDish('d3', {
        target: TARGET,
        ordering: { closed: true, nextOpenDate: SERVICE_DATE },
      });
      await waitFor(() => expect(screen.getByText('Fruit Bowl')).toBeOnTheScreen());

      expect(screen.getByTestId('screen-dish-detail-cutoff')).toHaveTextContent(/September/);
      const button = screen.getByTestId('screen-dish-detail-add-button');
      expect(button).toHaveTextContent('Ordering has closed');
      expect(button).toBeDisabled();

      await userEvent.setup().press(button);
      expect(seenCart.lines).toHaveLength(0);
    });
  });

  /**
   * `D7` / `E05-05`. The confirmation is at add-to-cart because that is where the decision is
   * made — at checkout it would arrive after it.
   */
  describe('the second, deliberate tap', () => {
    it('blocks the add when the dish declares an allergen the recipient has', async () => {
      setMenuCache(fakeCache());
      // d1 contains milk; TARGET's child has a milk allergy.
      await renderDish('d1', { target: TARGET });
      await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-button'));

      await waitFor(() =>
        expect(screen.getByTestId('screen-dish-detail-add-warning-body')).toBeOnTheScreen(),
      );
      // Nothing was added. The add happens on the second, deliberate press or not at all.
      expect(seenCart.lines).toHaveLength(0);
    });

    /**
     * CHANGED with the §5.6 rewrite, deliberately and in the safer direction.
     *
     * The old assertion said the confirmation names the dish and the allergen and **never the
     * recipient**. The spec now requires all three — "Mix Veg Poha contains Peanuts. Aarav is
     * allergic to Peanuts. Add it anyway?" — because a confirmation that will not say whose
     * allergy it is about is asking for a decision without supplying the fact it turns on.
     * The regulated part is the **id and the allergy list**, and those are still asserted
     * absent.
     */
    it('names the dish, the allergen and the recipient — and never their id', async () => {
      setMenuCache(fakeCache());
      await renderDish('d1', { target: TARGET });
      await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-button'));

      const body = await screen.findByTestId('screen-dish-detail-add-warning-body');
      expect(body).toHaveTextContent(/Cold Coffee contains Milk/);
      expect(body).toHaveTextContent(/Aarav is allergic to Milk/);
      // The recipient id is regulated data and has no business on the screen or in the tree.
      expect(screen.queryByText(/r1/)).toBeNull();
    });

    /**
     * §5.6, and it is a rule rather than a preference: "Add anyway" is one tap doing a
     * confirmation's job, and "anyway" is a reprimand for a decision a parent may have every
     * right to make.
     */
    it('keeps the main button neutral and puts the choice in its own surface', async () => {
      setMenuCache(fakeCache());
      await renderDish('d1', { target: TARGET });
      await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

      expect(screen.getByTestId('screen-dish-detail-add-button')).toHaveTextContent(
        'Add to cart · ₹75.50',
      );
      expect(screen.queryByText(/Add anyway/)).toBeNull();

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-button'));

      expect(
        await screen.findByTestId('screen-dish-detail-add-warning-confirm'),
      ).toHaveTextContent('Yes, add it for Aarav');
      expect(screen.getByTestId('screen-dish-detail-add-warning-cancel')).toHaveTextContent(
        "Don't add it",
      );
    });

    it('adds only after the confirmation is taken', async () => {
      setMenuCache(fakeCache());
      await renderDish('d1', { target: TARGET });
      await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

      const user = userEvent.setup();
      await user.press(screen.getByTestId('screen-dish-detail-add-button'));
      await screen.findByTestId('screen-dish-detail-add-warning-confirm');
      expect(seenCart.lines).toHaveLength(0);

      await user.press(screen.getByTestId('screen-dish-detail-add-warning-confirm'));
      await waitFor(() => expect(seenCart.lines).toHaveLength(1));
      expect(seenCart.lines[0]).toMatchObject({ menuItemId: 'mi-d1', unitPricePaise: 7_550 });
    });

    it('backing out adds nothing', async () => {
      setMenuCache(fakeCache());
      await renderDish('d1', { target: TARGET });
      await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

      const user = userEvent.setup();
      await user.press(screen.getByTestId('screen-dish-detail-add-button'));
      await user.press(await screen.findByTestId('screen-dish-detail-add-warning-cancel'));

      await waitFor(() =>
        expect(screen.queryByTestId('screen-dish-detail-add-warning-body')).toBeNull(),
      );
      expect(seenCart.lines).toHaveLength(0);
    });

    it('does not ask about an allergen the recipient does not have', async () => {
      setMenuCache(fakeCache());
      // d1 declares milk; this recipient has no declared allergies.
      await renderDish('d1', { target: NO_ALLERGIES });
      await waitFor(() => expect(screen.getByText('Cold Coffee')).toBeOnTheScreen());

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-button'));

      await waitFor(() => expect(seenCart.lines).toHaveLength(1));
      expect(screen.queryByTestId('screen-dish-detail-add-warning-body')).toBeNull();
    });

    /**
     * `MI7`: an undescribed dish warns for every recipient, allergies or not. It stays
     * **inline** rather than becoming a sheet, because a sheet on every undescribed dish
     * trains parents to dismiss it unread — and the one that mattered would go with it.
     */
    it('does not block an undescribed dish, and says so on the screen instead', async () => {
      setMenuCache(fakeCache());
      await renderDish('d2', { target: TARGET });
      await waitFor(() =>
        expect(screen.getByText('Allergen information not provided')).toBeOnTheScreen(),
      );

      await userEvent.setup().press(screen.getByTestId('screen-dish-detail-add-button'));

      await waitFor(() => expect(seenCart.lines).toHaveLength(1));
      expect(screen.queryByTestId('screen-dish-detail-add-warning-body')).toBeNull();
      // Still on screen after the add — the block is a property of the dish, not a step.
      expect(screen.getByTestId('screen-dish-detail-allergens-not-provided')).toBeOnTheScreen();
    });

    it('does not confirm against a person it cannot name', () => {
      // No recipient: nothing to confirm, and the confirming control cannot invent a name.
      expect(recipientVoice(null).confirmLabel).toBe('Yes, add it');
      expect(recipientVoice(MYSELF)).toMatchObject({ subject: 'You', verb: 'are' });
      expect(recipientVoice(TARGET)).toMatchObject({
        subject: 'Aarav',
        verb: 'is',
        confirmLabel: 'Yes, add it for Aarav',
        forLabel: 'For Aarav',
      });
      // An id with no name yet: neutral, and never "your child".
      expect(recipientVoice(UNNAMED).forLabel).toBe("For the person you've chosen");
      expect(recipientVoice(UNNAMED).confirmLabel).toBe('Yes, add it');
    });
  });

  it('shows a skeleton, never a spinner, while loading (S5)', async () => {
    // A cache that never resolves is the only honest way to assert a loading state.
    setMenuCache({ get: () => new Promise(() => {}), invalidate: jest.fn() } as never);
    await renderDish('d1');
    expect(screen.getByTestId('screen-dish-detail-skeleton')).toBeOnTheScreen();
    expect(screen.queryByText('Cold Coffee')).toBeNull();
  });
});
