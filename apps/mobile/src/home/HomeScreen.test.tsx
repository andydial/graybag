import { type ComponentProps } from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';
import { design, money } from '@graybag/shared';
import type { ReactElement } from 'react';

import { auditA11y, formatViolations } from '../a11y/audit';
import { CartProvider } from '../cart/CartContext';
import { HomeScreen as HomeScreenImpl, type HomeDish, type HomeScreenProps } from './HomeScreen';

/**
 * These are presentation tests, and the ordinary case they describe is a settled, signed-in
 * session. The component's own default is `pending` — it claims nothing until told — so the
 * default is supplied here rather than by the component, and the cases that are *about*
 * `access` still pass it explicitly and override this.
 */
const HomeScreen = (props: ComponentProps<typeof HomeScreenImpl>) => (
  <HomeScreenImpl access="signedIn" {...props} />
);


/**
 * `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09. Every caller awaits.
 *
 * `BrandHeader` reads the cart for its badge, so every render needs the provider. That is the
 * only context this screen touches: it fetches nothing and takes every piece of content as a
 * prop, which is what makes all eight of §5.4's states assertable here rather than only
 * reachable through three hooks and a network.
 */
const renderHome = (element: ReactElement) =>
  render(<CartProvider>{element}</CartProvider>);

const flattenStyle = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

const PANEER: HomeDish = {
  id: 'd-1',
  name: 'Paneer Wrap',
  pricePaise: 9500,
  imageUri: 'https://cdn.example/paneer.jpg',
  foodType: 'veg',
};

const RAJMA: HomeDish = {
  id: 'd-2',
  name: 'Rajma Rice',
  pricePaise: 8000,
  imageUri: null,
  foodType: 'veg',
};

const IDLI: HomeDish = {
  id: 'd-3',
  name: 'Idli Sambar',
  pricePaise: 6000,
  imageUri: 'https://cdn.example/idli.jpg',
  foodType: 'veg',
};

/** Signed in, one recipient, a published menu — the ordinary case the others deviate from. */
const SIGNED_IN: HomeScreenProps = {
  recipientName: 'Aarav',
  recipientClass: '5-A',
  schoolName: 'Alpha Public School',
  breakLabel: 'Morning break · 10:40',
  serviceDate: 'Tue 12 Aug',
  featured: PANEER,
  popular: [RAJMA, IDLI],
};

describe('HomeScreen — the delivering-to card', () => {
  it('names the recipient, the class, the school, the break and the day', async () => {
    await renderHome(<HomeScreen {...SIGNED_IN} />);

    expect(screen.getByTestId('screen-home-deliver-card')).toBeOnTheScreen();
    expect(screen.getByTestId('screen-home-deliver-who')).toHaveTextContent('Aarav · Class 5-A');
    expect(screen.getByTestId('screen-home-deliver-where')).toHaveTextContent(
      'Alpha Public School',
    );
    expect(screen.getByTestId('screen-home-deliver-band')).toHaveTextContent(
      'Morning break · 10:40 · Tue 12 Aug',
    );
  });

  it('opens the switcher when the card is pressed', async () => {
    const onSwitchRecipient = jest.fn();
    await renderHome(<HomeScreen {...SIGNED_IN} onSwitchRecipient={onSwitchRecipient} />);

    await userEvent.setup().press(screen.getByTestId('screen-home-deliver-card'));
    expect(onSwitchRecipient).toHaveBeenCalledTimes(1);
  });

  /**
   * Recipient-neutral copy. An adult ordering their own lunch is a real case; the caller
   * passes "You" and nothing on the screen contradicts it by assuming a parent and a child.
   */
  it('renders an adult ordering for themselves without inventing a relationship', async () => {
    await renderHome(<HomeScreen {...SIGNED_IN} recipientName="You" recipientClass={null} />);

    expect(screen.getByTestId('screen-home-deliver-who')).toHaveTextContent('You');
    expect(screen.queryByText(/your child/i)).toBeNull();
    expect(screen.queryByText(/Class/)).toBeNull();
  });

  /**
   * `OrderForBlock`'s rule, applied here: an unresolved break is **said to be unresolved**,
   * never filled in with a plausible one. A parent who reads a break time believes the lunch
   * is going to that break.
   */
  it('omits an unknown break rather than guessing one', async () => {
    await renderHome(<HomeScreen {...SIGNED_IN} breakLabel={null} />);
    expect(screen.getByTestId('screen-home-deliver-band')).toHaveTextContent('Tue 12 Aug');
  });

  /**
   * **This assertion was inverted on 2026-08-11 (`P19`).** It used to require the band to read
   * "Break and day are confirmed with the kitchen". Andy asked for that sentence gone from
   * everywhere, not only from the cart: it promised a manual step nobody can perform at volume,
   * and the break is now the parent's choice at checkout.
   *
   * With neither a break nor a day there is genuinely nothing to say, so the band says nothing.
   * Silence is honest; the old line was not.
   */
  it('says nothing rather than promising a step nobody performs', async () => {
    await renderHome(<HomeScreen {...SIGNED_IN} breakLabel={null} serviceDate={null} />);
    const band = screen.getByTestId('screen-home-deliver-band');
    expect(band).toHaveTextContent('');
    expect(band).not.toHaveTextContent(/confirm(ed)? with the kitchen/i);
  });

  /**
   * §3.1: white on `bg.surfaceBrand` is 3.85:1 — legal for large text and UI components and
   * illegal for body copy. So every string on the green half is either 24pt (WCAG "large") or
   * semibold, and this test is what stops somebody dropping a `scale.body` line in later.
   */
  it('keeps every white string on the green panel large or semibold', async () => {
    await renderHome(<HomeScreen {...SIGNED_IN} />);

    const who = flattenStyle(screen.getByTestId('screen-home-deliver-who').props.style);
    const where = flattenStyle(screen.getByTestId('screen-home-deliver-where').props.style);

    expect(who.color).toBe(design.text.onBrand);
    // 24pt is the WCAG large-text threshold for a normal weight.
    expect(who.fontSize).toBeGreaterThanOrEqual(design.scale.h2.size);

    expect(where.color).toBe(design.text.onBrand);
    expect(where.fontWeight).toBeGreaterThanOrEqual(design.scale.label.weight);
  });

  it('uses the darker band, not more green, for the break and the day', async () => {
    await renderHome(<HomeScreen {...SIGNED_IN} />);
    // White is 7.61 on `surfaceInverse` and 3.85 on `surfaceBrand`. The band exists so the
    // two lines a parent rereads sit on the surface that can legally carry them.
    const band = screen.getByTestId('screen-home-deliver-band').parent;
    expect(band).not.toBeNull();
  });
});

describe('HomeScreen — signed out', () => {
  it('reads as browsing a school, not as an error or a sign-in wall', async () => {
    await renderHome(<HomeScreen access="signedOut" schoolName="Alpha Public School" featured={PANEER} />);

    expect(screen.getByText('Browsing')).toBeOnTheScreen();
    expect(screen.getByTestId('screen-home-deliver-who')).toHaveTextContent('Alpha Public School');
    expect(screen.getByTestId('screen-home-deliver-where')).toHaveTextContent(
      'Mohali · menu for this week',
    );
    // `R1`: browsing never requires a session, so nothing here asks for one.
    expect(screen.queryByText(/sign in/i)).toBeNull();
  });

  /**
   * Signed out the two halves say different things — the green half is about which school you
   * are browsing, the band is an invitation to add somebody. Two targets, so neither line is a
   * promise the tap does not keep.
   */
  it('sends the green half to the school picker and the band to adding someone', async () => {
    const onChooseSchool = jest.fn();
    const onAddRecipient = jest.fn();
    await renderHome(
      <HomeScreen access="signedOut" schoolName="Alpha Public School" onChooseSchool={onChooseSchool} onAddRecipient={onAddRecipient} />,
    );

    const user = userEvent.setup();
    await user.press(screen.getByTestId('screen-home-deliver-band-action'));
    expect(onAddRecipient).toHaveBeenCalledTimes(1);
    expect(onChooseSchool).not.toHaveBeenCalled();

    await user.press(screen.getByTestId('screen-home-deliver-card'));
    expect(onChooseSchool).toHaveBeenCalledTimes(1);
  });
});

describe('HomeScreen — signed in with nobody added', () => {
  it("makes the card's job adding someone, in recipient-neutral words", async () => {
    const onAddRecipient = jest.fn();
    await renderHome(
      <HomeScreen schoolName="Alpha Public School" featured={PANEER} onAddRecipient={onAddRecipient} />,
    );

    expect(screen.getByTestId('screen-home-deliver-who')).toHaveTextContent('Add who is eating');
    expect(screen.queryByText(/your child/i)).toBeNull();

    await userEvent.setup().press(screen.getByTestId('screen-home-deliver-card'));
    expect(onAddRecipient).toHaveBeenCalledTimes(1);
  });

  /** `R2`: adding a recipient is an invitation, never a wall in front of the menu. */
  it('still shows the menu rails', async () => {
    await renderHome(<HomeScreen schoolName="Alpha Public School" featured={PANEER} popular={[RAJMA]} />);
    expect(screen.getByTestId('screen-home-featured')).toBeOnTheScreen();
    expect(screen.getByTestId('screen-home-popular')).toBeOnTheScreen();
  });
});

describe('HomeScreen — the promoted dish', () => {
  /**
   * §5.5, and the single most important rule on this screen: **a mis-tap must never add
   * food.** The button says "See dish" and it opens the dish. There is no add control here.
   */
  it('says "See dish" and opens the dish rather than adding it', async () => {
    const onSelectDish = jest.fn();
    await renderHome(<HomeScreen {...SIGNED_IN} onSelectDish={onSelectDish} />);

    expect(screen.getByTestId('screen-home-featured-cta')).toHaveTextContent('See dish');
    expect(screen.queryByText(/^add/i)).toBeNull();

    await userEvent.setup().press(screen.getByTestId('screen-home-featured-cta'));
    expect(onSelectDish).toHaveBeenCalledWith('d-1');
  });

  it('opens the dish when the card itself is pressed', async () => {
    const onSelectDish = jest.fn();
    await renderHome(<HomeScreen {...SIGNED_IN} onSelectDish={onSelectDish} />);

    await userEvent.setup().press(screen.getByTestId('screen-home-featured'));
    expect(onSelectDish).toHaveBeenCalledWith('d-1');
  });

  it('formats the price through the shared formatter, from paise', async () => {
    await renderHome(<HomeScreen {...SIGNED_IN} />);
    // 9500 paise, formatted at the edge by the one shared formatter — never hand-assembled
    // and never stored as rupees (non-negotiable #3, §3.5).
    expect(screen.getByTestId('screen-home-featured-price')).toHaveTextContent(
      money.formatPaise(9500),
    );
    expect(screen.getByTestId('screen-home-featured-price')).not.toHaveTextContent('9500');
  });

  it('titles the section with the school', async () => {
    await renderHome(<HomeScreen {...SIGNED_IN} />);
    expect(screen.getByText('This week at Alpha Public School')).toBeOnTheScreen();
  });
});

describe('HomeScreen — popular this week', () => {
  it('renders a card per dish, each opening its own dish', async () => {
    const onSelectDish = jest.fn();
    await renderHome(<HomeScreen {...SIGNED_IN} onSelectDish={onSelectDish} />);

    expect(screen.getByTestId('screen-home-popular-d-2')).toBeOnTheScreen();
    expect(screen.getByTestId('screen-home-popular-d-3')).toBeOnTheScreen();

    await userEvent.setup().press(screen.getByTestId('screen-home-popular-d-3'));
    expect(onSelectDish).toHaveBeenCalledWith('d-3');
  });

  /**
   * A dish with no photograph is the **brand tile, never a grey box**. Every dish in staging
   * has `image_path = null` until `E16-43`, so this is most of the menu today rather than a
   * rare edge, and a grey rectangle reads as broken where a branded tile reads as "coming".
   */
  it('draws the pattern tile for a dish with no photograph', async () => {
    await renderHome(<HomeScreen {...SIGNED_IN} />);

    // RAJMA has `imageUri: null`. Its tile renders in place of the image, at the same testID,
    // and it is filled with the brand's pale lime — **not** `bg.surfaceMuted`, which is the
    // grey placeholder fill this state exists to avoid.
    // `PatternTile` is an `ImageBackground`, so the testID lands on the pattern itself and the
    // fill is on the frame around it.
    const tile = flattenStyle(screen.getByTestId('screen-home-popular-d-2-image').parent?.props.style);
    expect(tile.backgroundColor).toBe(design.bg.surfaceAccent);
    expect(tile.backgroundColor).not.toBe(design.bg.surfaceMuted);
  });

  it('draws the real photograph when there is one', async () => {
    await renderHome(<HomeScreen {...SIGNED_IN} />);
    // Hidden from assistive tech on purpose — the dish's own name is directly beneath it —
    // so the query has to ask for hidden elements to see it at all.
    const photo = screen.getByTestId('screen-home-popular-d-3-image', {
      includeHiddenElements: true,
    });
    expect(photo.props.source).toEqual({ uri: 'https://cdn.example/idli.jpg' });
  });

  it('marks each dish veg / egg / non-veg', async () => {
    await renderHome(<HomeScreen {...SIGNED_IN} />);
    expect(screen.getByTestId('screen-home-popular-d-2-food-type').props.accessibilityLabel).toBe(
      'Pure vegetarian',
    );
  });
});

describe('HomeScreen — the search field is a doorway', () => {
  it('opens the menu instead of searching in place', async () => {
    const onBrowseMenu = jest.fn();
    await renderHome(<HomeScreen {...SIGNED_IN} onBrowseMenu={onBrowseMenu} />);

    await userEvent.setup().press(screen.getByTestId('screen-home-search'));
    expect(onBrowseMenu).toHaveBeenCalledTimes(1);
  });

  /**
   * It is announced as a button, not as a text field. A screen reader saying "text field" for
   * a control you cannot type into is a lie told to the users least able to check it.
   */
  it('is announced as a button, not as a text field', async () => {
    await renderHome(<HomeScreen {...SIGNED_IN} />);
    const doorway = screen.getByTestId('screen-home-search');
    expect(doorway.props.accessibilityLabel).toBe('Search the menu');
    expect(doorway.props.accessibilityHint).toBe('Opens the menu');
  });
});

describe('HomeScreen — states', () => {
  it('shows skeletons, never a spinner, while loading', async () => {
    await renderHome(<HomeScreen state="loading" {...SIGNED_IN} />);

    // `R9`/`S5`. The card and both rails are skeletons; the header and the search doorway do
    // not depend on the data, so they are already real.
    expect(screen.getByTestId('screen-home-skeleton')).toBeOnTheScreen();
    expect(screen.queryByTestId('screen-home-deliver-card')).toBeNull();
    expect(screen.queryByTestId('screen-home-featured')).toBeNull();
    // `Skeleton` announces itself as "Loading". No `ActivityIndicator` anywhere on this path.
    expect(screen.getAllByLabelText('Loading').length).toBeGreaterThan(0);
    expect(screen.getByTestId('screen-home-search')).toBeOnTheScreen();
  });

  /**
   * §5.21 N1 versus N2, and the defect this whole section exists to prevent: "this school's
   * menu has not been published" was once shown for a backend the app could not reach, and
   * that collapsed distinction cost three hours hunting a data problem that did not exist.
   *
   * Unpublished is a **succeeded request with a legitimately empty answer**. The rails
   * collapse, the card stays, and the copy says the app is fine.
   */
  it('explains an unpublished menu without looking like an error', async () => {
    const onChooseSchool = jest.fn();
    await renderHome(
      <HomeScreen {...SIGNED_IN} menuUnpublished onChooseSchool={onChooseSchool} />,
    );

    expect(screen.getByTestId('screen-home-deliver-card')).toBeOnTheScreen();
    expect(screen.queryByTestId('screen-home-featured')).toBeNull();
    expect(screen.queryByTestId('screen-home-popular')).toBeNull();

    expect(screen.getByTestId('screen-home-unpublished')).toBeOnTheScreen();
    expect(screen.queryByTestId('screen-home-error')).toBeNull();
    expect(screen.getByText(/Nothing is wrong with your app/)).toBeOnTheScreen();
    expect(screen.queryByText(/went wrong/i)).toBeNull();
    expect(screen.queryByText(/try again/i)).toBeNull();

    await userEvent.setup().press(screen.getByText('Browse another school'));
    expect(onChooseSchool).toHaveBeenCalledTimes(1);
  });

  /** N4: cached content is real and usable, and saying where it came from is the honest part. */
  it('says so quietly when the content is stale, and still shows it', async () => {
    await renderHome(<HomeScreen {...SIGNED_IN} stale />);

    expect(screen.getByTestId('screen-home-stale')).toHaveTextContent(
      'Offline — showing what you last loaded.',
    );
    expect(screen.getByTestId('screen-home-featured')).toBeOnTheScreen();
    expect(screen.getByTestId('screen-home-deliver-card')).toBeOnTheScreen();
  });

  it('does not show the stale line when the content is live', async () => {
    await renderHome(<HomeScreen {...SIGNED_IN} />);
    expect(screen.queryByTestId('screen-home-stale')).toBeNull();
  });

  it('offers a retry on error', async () => {
    const onRetry = jest.fn();
    await renderHome(<HomeScreen state="error" onRetry={onRetry} />);

    expect(screen.getByTestId('screen-home-error')).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByLabelText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  /** N1 with a published menu but nothing promoted — still not an error, still a way out. */
  it('says the week is empty rather than rendering two headings over nothing', async () => {
    await renderHome(<HomeScreen recipientName="Aarav" schoolName="Alpha Public School" />);

    expect(screen.getByTestId('screen-home-nothing')).toBeOnTheScreen();
    expect(screen.queryByTestId('screen-home-featured-section')).toBeNull();
    expect(screen.queryByTestId('screen-home-popular-section')).toBeNull();
  });
});

describe('HomeScreen — accessibility', () => {
  it.each([
    ['signed in', <HomeScreen key="a" {...SIGNED_IN} />],
    ['signed out', <HomeScreen key="b" access="signedOut" schoolName="Alpha Public School" featured={PANEER} />],
    ['no recipient', <HomeScreen key="c" schoolName="Alpha Public School" featured={PANEER} />],
    ['unpublished', <HomeScreen key="d" {...SIGNED_IN} menuUnpublished />],
    ['loading', <HomeScreen key="e" state="loading" />],
  ])('has a name and a big enough target on every control — %s', async (_name, element) => {
    await renderHome(element);
    // An empty tree passes this audit vacuously, which is how an a11y suite quietly stops
    // testing anything. Assert there was something to audit before believing the result.
    expect(screen.queryAllByRole('button').length).toBeGreaterThan(0);
    const violations = auditA11y(screen);
    expect(formatViolations(violations)).toBe('');
  });

  it('gives the delivering-to card one label rather than four stops', async () => {
    await renderHome(<HomeScreen {...SIGNED_IN} />);
    expect(screen.getByTestId('screen-home-deliver-card').props.accessibilityLabel).toBe(
      'Delivering to Aarav · Class 5-A, Alpha Public School, Morning break · 10:40 · Tue 12 Aug. Change.',
    );
  });
});
