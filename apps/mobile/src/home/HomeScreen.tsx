import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { design, money } from '@graybag/shared';

import {
  BrandHeader,
  BrandPanel,
  Button,
  EmptyState,
  ErrorState,
  FoodTypeMark,
  PatternTile,
  SectionHeading,
  Skeleton,
} from '../components';
import { DishImage, IMAGE_SIZES } from '../components/DishImage';

const {
  bg,
  text,
  space,
  radius,
  scale,
  layout,
  touchTarget,
    opacity,
} = design;

/**
 * Home (`docs/ux-spec.md` §5.4) — the most brand-heavy screen in the app, and the one that
 * has to answer three questions before a parent will trust anything else: **what am I
 * ordering, for whom, and for when.**
 *
 * ## Why this component fetches nothing
 *
 * Every piece of content arrives as a prop. That is not laziness about wiring — it is what
 * makes the eight states §5.4 enumerates renderable and testable at all. Home is the screen
 * with the most states and the least logic of its own; if it owned its own reads, "signed in
 * with no recipient, menu unpublished, offline" would be a fixture of three hooks rather than
 * three booleans, and it would go untested exactly the way `§5.21`'s collapsed empty states
 * went untested.
 *
 * ## The three rules this screen is most likely to break
 *
 * **White on the brand green is 3.85:1.** `BrandPanel` fills with `bg.surfaceBrand`, which
 * clears the bar for large text and UI components and *fails for body copy* (§3.1, and the
 * role's own docstring). So every white string on the green half of the "Delivering to" card
 * is either **large** (`scale.h2`, 24pt) or **semibold** (`scale.overline` / `scale.label`,
 * weight 600). Nothing on the green is `scale.body`. The lower band is `bg.surfaceInverse`,
 * where white is 7.61 and ordinary weights are legal — which is the actual reason the band
 * exists as a darker strip rather than as more green.
 *
 * **A mis-tap must never add food.** The promoted dish's button says **"See dish"** and opens
 * the dish (§5.5: *"a control labelled 'Order' that does not order is a worse lie than a
 * missing button"*). There is no add-to-cart control anywhere on this screen.
 *
 * **Copy is recipient-neutral.** An adult ordering their own lunch is a real case, and the
 * card then reads "You". Nothing here says "your child" — the caller supplies the name and
 * this screen never infers a relationship it was not told about.
 */

export interface HomeDish {
  id: string;
  name: string;
  /** Integer paise, GST-exclusive (`R4`, `R5`). Formatted at the edge, never stored as rupees. */
  pricePaise: number;
  imageUri: string | null;
  foodType: 'veg' | 'egg' | 'non_veg' | null;
}

export interface HomeScreenProps {
  testID?: string;

  /** The search field is a doorway to the Menu, not a search on this screen. */
  onBrowseMenu?: () => void;
  onChooseSchool?: () => void;
  onAddRecipient?: () => void;
  onSelectDish?: (dishId: string) => void;
  onSwitchRecipient?: () => void;
  /**
   * Refetch, for the error state. Optional only because every other callback is; **pass it**
   * — `ErrorState`'s "Try again" is the one affordance an error state must actually have, and
   * without this it is a button that does nothing.
   */
  onRetry?: () => void;

  /** "You" is a legitimate value. Null means signed in with nobody added yet. */
  recipientName?: string | null;
  /** Already combined by the caller — "5-A", not class and section separately. */
  recipientClass?: string | null;
  schoolName?: string | null;
  /** Never invented. Absent means the band omits it rather than guessing (see `OrderForBlock`). */
  breakLabel?: string | null;
  /** Human service date, already formatted by the caller. */
  serviceDate?: string | null;

  featured?: HomeDish | null;
  popular?: HomeDish[];

  state?: 'loading' | 'ready' | 'error';
  signedOut?: boolean;
  /** N1, not N2 (§5.21). The kitchen has not published — nothing is wrong with the app. */
  menuUnpublished?: boolean;
  /** N4 (§5.21). Cached content, said out loud rather than passed off as live. */
  stale?: boolean;
}

/** §3.5: at `AX1` and above the horizontal rail becomes a vertical list. */
const AX_FONT_SCALE = 1.35;

/** The promoted dish's photograph. Wide, because it is the one image on the screen with room. */
const HERO_ASPECT = 16 / 9;

/** Skeleton geometry, from tokens, so the boxes match what lands in them (`S5`). */
const DELIVER_SKELETON_HEIGHT = space[16] * 2;
const HERO_SKELETON_HEIGHT = space[16] * 3;

export function HomeScreen({
  testID = 'screen-home',
  onBrowseMenu,
  onChooseSchool,
  onAddRecipient,
  onSelectDish,
  onSwitchRecipient,
  onRetry,
  recipientName = null,
  recipientClass = null,
  schoolName = null,
  breakLabel = null,
  serviceDate = null,
  featured = null,
  popular = [],
  state = 'ready',
  signedOut = false,
  menuUnpublished = false,
  stale = false,
}: HomeScreenProps) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= AX_FONT_SCALE;

  if (state === 'error') {
    return (
      <View style={styles.screen} testID={testID}>
        <BrandHeader />
        <ErrorState
          body="We could not load your home screen. Check your connection and try again."
          onRetry={onRetry ?? noop}
          testID={`${testID}-error`}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen} testID={testID}>
      <BrandHeader />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        testID={`${testID}-scroll`}
      >
        {/*
          N4, not N2. We are holding real, usable content; saying where it came from is honest
          and refusing to show it would be worse (§5.21). A quiet line, never a blocking banner.
        */}
        {stale ? (
          <Text style={styles.stale} accessibilityLiveRegion="polite" testID={`${testID}-stale`}>
            Offline — showing what you last loaded.
          </Text>
        ) : null}

        <View style={styles.gutter}>
          <SearchDoorway testID={`${testID}-search`} onPress={onBrowseMenu} />
        </View>

        {state === 'loading' ? (
          <HomeSkeleton testID={testID} stacked={stacked} />
        ) : (
          <>
            <DeliverCard
              testID={testID}
              signedOut={signedOut}
              recipientName={recipientName}
              recipientClass={recipientClass}
              schoolName={schoolName}
              breakLabel={breakLabel}
              serviceDate={serviceDate}
              onChooseSchool={onChooseSchool}
              onAddRecipient={onAddRecipient}
              onSwitchRecipient={onSwitchRecipient}
            />

            {menuUnpublished ? (
              /*
                §5.21 N1 and `F4`. The kitchen has not published a menu — the request
                succeeded and the answer is legitimately zero dishes. So this is an
                `EmptyState`, never an `ErrorState`: no danger colour, no "something went
                wrong", and the body says in as many words that the app is fine. Getting this
                one wrong cost three hours of hunting a data problem that did not exist.
              */
              <EmptyState
                title={`${schoolName ?? 'This school'} hasn't published a menu yet`}
                body="We'll show it here the moment the kitchen publishes it. Nothing is wrong with your app."
                {...(onChooseSchool
                  ? { actionLabel: 'Browse another school', onAction: onChooseSchool }
                  : {})}
                testID={`${testID}-unpublished`}
              />
            ) : featured === null && popular.length === 0 ? (
              <EmptyState
                title="Nothing on the menu this week"
                body="The kitchen hasn't put anything up for these days yet. Try the full menu — there may be more there."
                {...(onBrowseMenu ? { actionLabel: 'Open the menu', onAction: onBrowseMenu } : {})}
                testID={`${testID}-nothing`}
              />
            ) : (
              <>
                {featured !== null ? (
                  <View style={styles.section} testID={`${testID}-featured-section`}>
                    <View style={styles.gutter}>
                      <SectionHeading>
                        {schoolName === null ? 'This week' : `This week at ${schoolName}`}
                      </SectionHeading>
                    </View>
                    <View style={styles.gutter}>
                      <FeaturedDish
                        dish={featured}
                        testID={`${testID}-featured`}
                        {...(onSelectDish ? { onSelect: onSelectDish } : {})}
                      />
                    </View>
                  </View>
                ) : null}

                {popular.length > 0 ? (
                  <View style={styles.section} testID={`${testID}-popular-section`}>
                    <View style={styles.gutter}>
                      <SectionHeading>Popular this week</SectionHeading>
                    </View>
                    <PopularRail
                      dishes={popular}
                      stacked={stacked}
                      testID={`${testID}-popular`}
                      {...(onSelectDish ? { onSelect: onSelectDish } : {})}
                    />
                  </View>
                ) : null}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const noop = () => {};

/**
 * The search field, which is not a field.
 *
 * §5.4 calls it a search box and it looks like one, but on this screen it does nothing except
 * open the Menu — that is where the query is actually typed and filtered (§5.5). So it is a
 * **button that is shaped like a field**, not a `TextInput` with `editable={false}`: a screen
 * reader announcing "text field" for a control you cannot type into is a lie told to exactly
 * the users least able to check it, and the shape is decoration either way.
 */
function SearchDoorway({ testID, onPress }: { testID: string; onPress?: (() => void) | undefined }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Search the menu"
      accessibilityHint="Opens the menu"
      style={({ pressed }) => [styles.search, pressed && styles.pressed]}
    >
      <Text style={styles.searchText}>Search the menu</Text>
    </Pressable>
  );
}

/**
 * The "Delivering to" card — **the most important control on the screen**, and the only one
 * that changes shape with the session.
 *
 * Two halves, and the split is a contrast decision as much as a visual one. The green half is
 * `BrandPanel` (`bg.surfaceBrand` + the vegetable pattern), where white is 3.85:1 and
 * therefore **large or semibold only**. The lower band is `bg.surfaceInverse`, where white is
 * 7.61:1, so the break time and the date — the two things a parent actually rereads — sit on
 * the surface that can carry them at a normal weight.
 *
 * The panel is drawn at `radius.none` and clipped by this component's own rounded, overflowing
 * box, because the card has a rounded outside and a straight seam down the middle. That is the
 * one legitimate use of `radius.none` (`S15`): a corner nobody can see.
 *
 * **One press target, except signed out.** Signed in, the whole card opens the switcher, which
 * is what the chevron promises. Signed out the two halves genuinely say different things — the
 * green half is about which school you are browsing, the band is an invitation to add somebody
 * — so the band gets its own target rather than the card quietly picking one of the two and
 * making the other line a lie.
 */
function DeliverCard({
  testID,
  signedOut,
  recipientName,
  recipientClass,
  schoolName,
  breakLabel,
  serviceDate,
  onChooseSchool,
  onAddRecipient,
  onSwitchRecipient,
}: {
  testID: string;
  signedOut: boolean;
  recipientName: string | null;
  recipientClass: string | null;
  schoolName: string | null;
  breakLabel: string | null;
  serviceDate: string | null;
  onChooseSchool?: (() => void) | undefined;
  onAddRecipient?: (() => void) | undefined;
  onSwitchRecipient?: (() => void) | undefined;
}) {
  const content = describeDelivery({
    signedOut,
    recipientName,
    recipientClass,
    schoolName,
    breakLabel,
    serviceDate,
  });

  const onCardPress = signedOut
    ? onChooseSchool
    : recipientName === null
      ? onAddRecipient
      : onSwitchRecipient;

  // Only signed out do the halves lead somewhere different. Everywhere else a second target
  // inside the first would be two ways to do one thing, and a second stop for a screen reader.
  const bandPress = signedOut ? onAddRecipient : undefined;

  const band = (
    <View style={styles.band}>
      <Text style={styles.bandText} testID={`${testID}-deliver-band`}>
        {content.band}
      </Text>
      <Text
        style={styles.chevron}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        ›
      </Text>
    </View>
  );

  return (
    <Pressable
      testID={`${testID}-deliver-card`}
      onPress={onCardPress}
      accessibilityRole="button"
      accessibilityLabel={content.a11yLabel}
      style={({ pressed }) => [styles.deliver, pressed && styles.pressed]}
    >
      <BrandPanel radius={radius.none} style={styles.deliverTop}>
        <Text style={styles.eyebrow}>{content.eyebrow}</Text>
        <Text style={styles.who} testID={`${testID}-deliver-who`}>
          {content.who}
        </Text>
        <Text style={styles.where} testID={`${testID}-deliver-where`}>
          {content.where}
        </Text>
      </BrandPanel>

      {bandPress === undefined ? (
        band
      ) : (
        <Pressable
          testID={`${testID}-deliver-band-action`}
          onPress={bandPress}
          accessibilityRole="button"
          accessibilityLabel={content.band}
        >
          {band}
        </Pressable>
      )}
    </Pressable>
  );
}

/**
 * What the card says, as data.
 *
 * Pulled out of the render so the copy for all three shapes is legible in one place and
 * testable without a renderer. Three rules run through it:
 *
 * - **Recipient-neutral.** No "your child" anywhere. `recipientName` may be "You".
 * - **Nothing invented.** An absent break or date is omitted, not filled with a plausible
 *   value — the same rule `OrderForBlock` states at length, for the same reason: a parent who
 *   reads a break time believes the lunch is going to that break.
 * - **Signed out is not an error.** Browsing with no session is the designed path (`R1`).
 */
function describeDelivery({
  signedOut,
  recipientName,
  recipientClass,
  schoolName,
  breakLabel,
  serviceDate,
}: {
  signedOut: boolean;
  recipientName: string | null;
  recipientClass: string | null;
  schoolName: string | null;
  breakLabel: string | null;
  serviceDate: string | null;
}): { eyebrow: string; who: string; where: string; band: string; a11yLabel: string } {
  if (signedOut) {
    const who = schoolName ?? 'Choose a school';
    return {
      eyebrow: 'Browsing',
      who,
      // R11: one city, so this is a fact rather than a placeholder for a location picker.
      where: 'Mohali · menu for this week',
      band: 'Add someone to place an order',
      a11yLabel: `Browsing ${who}, Mohali. Change school.`,
    };
  }

  if (recipientName === null) {
    return {
      eyebrow: 'Almost there',
      who: 'Add who is eating',
      where: 'A name, a school and a class is all we need',
      band: 'Takes about a minute',
      a11yLabel: 'Add who is eating. Takes about a minute.',
    };
  }

  const who =
    recipientClass === null || recipientClass === ''
      ? recipientName
      : `${recipientName} · Class ${recipientClass}`;
  const where = schoolName ?? 'School not set yet';
  const when = [breakLabel, serviceDate].filter(isPresent).join(' · ');

  return {
    eyebrow: 'Delivering to',
    who,
    where,
    // Never a guess. An unresolved break or day says so, exactly as the cart's block does.
    band: when === '' ? 'Break and day are confirmed with the kitchen' : when,
    a11yLabel: `Delivering to ${who}, ${where}${when === '' ? '' : `, ${when}`}. Change.`,
  };
}

const isPresent = (value: string | null): value is string => value !== null && value !== '';

/**
 * The promoted dish (§5.4 element 4) — one real dish, no fake discount.
 *
 * **Its button reads "See dish" and opens the dish.** §5.5 binds this explicitly: a mis-tap on
 * Home must never add food to a cart. The card itself is pressable too and does the same safe
 * thing, so the photograph is not dead space and there is no way to tap this and be surprised.
 */
function FeaturedDish({
  dish,
  onSelect,
  testID,
}: {
  dish: HomeDish;
  onSelect?: ((dishId: string) => void) | undefined;
  testID: string;
}) {
  const price = money.formatPaise(dish.pricePaise);
  const open = () => onSelect?.(dish.id);

  return (
    <Pressable
      testID={testID}
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${dish.name}, ${price}`}
      style={({ pressed }) => [styles.featured, pressed && styles.pressed]}
    >
      <View style={styles.hero}>
        <DishPhoto dish={dish} testID={`${testID}-image`} />
        <View style={styles.markOnPhoto}>
          <FoodTypeMark foodType={dish.foodType} testID={`${testID}-food-type`} />
        </View>
      </View>

      <View style={styles.featuredRow}>
        <View style={styles.featuredText}>
          <Text style={styles.featuredName} numberOfLines={2}>
            {dish.name}
          </Text>
          <Text style={styles.price} testID={`${testID}-price`}>
            {price}
          </Text>
        </View>
        {/* Never "Add" and never "Order". This opens the dish. */}
        <Button label="See dish" onPress={open} testID={`${testID}-cta`} />
      </View>
    </Pressable>
  );
}

/**
 * "Popular this week".
 *
 * Horizontal at ordinary text sizes and a **vertical list at `AX1` and above** (§3.5): a rail
 * whose cards no longer fit the screen is a rail whose second item cannot be reached, and
 * removing content because somebody asked for larger text is the opposite of what they asked.
 */
function PopularRail({
  dishes,
  onSelect,
  stacked,
  testID,
}: {
  dishes: HomeDish[];
  onSelect?: ((dishId: string) => void) | undefined;
  stacked: boolean;
  testID: string;
}) {
  const cards = dishes.map((dish) => (
    <PopularCard
      key={dish.id}
      dish={dish}
      stacked={stacked}
      testID={`${testID}-${dish.id}`}
      {...(onSelect ? { onSelect } : {})}
    />
  ));

  if (stacked) {
    return (
      <View style={[styles.gutter, styles.rowStack]} testID={testID}>
        {cards}
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
      testID={testID}
    >
      {cards}
    </ScrollView>
  );
}

function PopularCard({
  dish,
  onSelect,
  stacked,
  testID,
}: {
  dish: HomeDish;
  onSelect?: ((dishId: string) => void) | undefined;
  stacked: boolean;
  testID: string;
}) {
  const price = money.formatPaise(dish.pricePaise);

  return (
    <Pressable
      testID={testID}
      onPress={() => onSelect?.(dish.id)}
      accessibilityRole="button"
      // One label for the card. "Rajma Rice" then "₹95" then "button" is three stops for one
      // thing, which is three times the work for the same information.
      accessibilityLabel={`${dish.name}, ${price}`}
      style={({ pressed }) => [
        stacked ? styles.railCardStacked : styles.railCard,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.railThumb}>
        <DishPhoto dish={dish} size={IMAGE_SIZES.card} testID={`${testID}-image`} />
        <View style={styles.markOnPhoto}>
          <FoodTypeMark foodType={dish.foodType} testID={`${testID}-food-type`} />
        </View>
      </View>
      <Text style={styles.railName} numberOfLines={stacked ? 0 : 2}>
        {dish.name}
      </Text>
      <Text style={styles.price} testID={`${testID}-price`}>
        {price}
      </Text>
    </Pressable>
  );
}

/**
 * A dish photograph, or the brand tile when there is none.
 *
 * **Never a grey box.** Every dish in staging has `image_path = null` until `E16-43` uploads
 * the mirrored catalogue and three of the real photos are a permanent 403 at source, so "no
 * photo" is most of the menu today rather than a rare edge — a branded tile says "photo
 * coming" where a grey rectangle says "broken".
 *
 * Both cases are `DishImage` now: the rail asks for a square, the promoted dish asks for
 * 16:10 with `aspectRatio`, and `fill` covers a box the parent has already sized. This used to
 * hand-roll `expo-image` for the wide case because `DishImage` only drew squares — three
 * screens had made the same copy, which is three places for a performance decision to drift on
 * the one component whose reason for existing is that it is decided once.
 */
function DishPhoto({ dish, size, testID }: { dish: HomeDish; size?: number; testID: string }) {
  if (dish.imageUri === null) return <PatternTile testID={testID} />;

  if (size !== undefined) {
    return (
      <DishImage uri={dish.imageUri} recyclingKey={dish.id} size={size} testID={testID} />
    );
  }

  // The promoted dish: the card sizes the box, so fill it at the card's own ratio.
  return <DishImage uri={dish.imageUri} recyclingKey={dish.id} size={0} fill testID={testID} />;
}

/**
 * The loading state (`R9`/`S5`: skeletons, never spinners).
 *
 * The header and the search doorway are already real by the time this renders — they do not
 * depend on the data — so only the three blocks that do are skeletons, and each is the size of
 * the box that will replace it.
 */
function HomeSkeleton({ testID, stacked }: { testID: string; stacked: boolean }) {
  return (
    <View testID={`${testID}-skeleton`}>
      <View style={styles.gutter}>
        <Skeleton width="100%" height={DELIVER_SKELETON_HEIGHT} />
      </View>

      <View style={[styles.section, styles.gutter]}>
        <Skeleton width="60%" height={space[5]} />
        <View style={styles.skeletonGap}>
          <Skeleton width="100%" height={HERO_SKELETON_HEIGHT} />
        </View>
        <View style={styles.skeletonGap}>
          <Skeleton width="70%" height={space[5]} />
        </View>
      </View>

      <View style={[styles.section, styles.gutter]}>
        <Skeleton width="50%" height={space[5]} />
        <View style={[styles.skeletonGap, stacked ? styles.rowStack : styles.skeletonRail]}>
          <Skeleton width={IMAGE_SIZES.card} height={IMAGE_SIZES.card} />
          <Skeleton width={IMAGE_SIZES.card} height={IMAGE_SIZES.card} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  scroll: { paddingBottom: space[8] },
  gutter: { paddingHorizontal: layout.gutter },
  section: { marginTop: layout.sectionGap },
  pressed: { opacity: opacity.pressed },

  // A quiet line, not a banner. N4 is real content with a provenance note, not a failure.
  stale: {
    backgroundColor: bg.surfaceMuted,
    color: text.secondary,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
    paddingHorizontal: layout.gutter,
    paddingVertical: space[2],
  },

  search: {
    minHeight: touchTarget.min,
    justifyContent: 'center',
    backgroundColor: bg.surfaceMuted,
    borderRadius: radius.lg,
    paddingHorizontal: space[4],
    marginTop: space[2],
  },
  searchText: {
    color: text.tertiary,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
  },

  deliver: {
    marginTop: layout.sectionGap,
    marginHorizontal: layout.gutter,
    borderRadius: radius.xl,
    // The clip is what lets the panel inside be square-cornered without a visible corner.
    overflow: 'hidden',
  },
  deliverTop: { paddingHorizontal: space[5], paddingVertical: space[4] },
  eyebrow: {
    color: text.onBrand,
    fontSize: scale.overline.size,
    lineHeight: scale.overline.lineHeight,
    // Semibold. On `bg.surfaceBrand` this is the floor — see the note at the top of the file.
    fontWeight: scale.overline.weight,
    letterSpacing: scale.overline.tracking,
    textTransform: 'uppercase',
  },
  who: {
    color: text.onBrand,
    // 24pt is WCAG "large", which is what makes white on this green legal here.
    fontSize: scale.h2.size,
    lineHeight: scale.h2.lineHeight,
    fontWeight: scale.h2.weight,
    letterSpacing: scale.h2.tracking,
    marginTop: space[1],
  },
  where: {
    color: text.onBrand,
    fontSize: scale.label.size,
    lineHeight: scale.label.lineHeight,
    fontWeight: scale.label.weight,
    marginTop: space[1],
  },

  band: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    // White is 7.61 here, so this half can carry ordinary weights — which is why the break
    // time and the date live on it rather than on the green.
    backgroundColor: bg.surfaceInverse,
    paddingHorizontal: space[5],
    paddingVertical: space[3],
  },
  bandText: {
    flex: 1,
    color: text.onBrand,
    fontSize: scale.label.size,
    lineHeight: scale.label.lineHeight,
    fontWeight: scale.label.weight,
  },
  chevron: {
    color: text.onBrand,
    fontSize: scale.h3.size,
    lineHeight: scale.h3.lineHeight,
  },

  featured: { gap: space[3] },
  hero: {
    width: '100%',
    aspectRatio: HERO_ASPECT,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: bg.surfaceMuted,
  },
  photo: { width: '100%', height: '100%' },
  markOnPhoto: { position: 'absolute', top: space[2], left: space[2] },
  featuredRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space[3] },
  featuredText: { flex: 1, gap: space[1] },
  featuredName: {
    color: text.primary,
    fontSize: scale.h3.size,
    lineHeight: scale.h3.lineHeight,
    fontWeight: scale.h3.weight,
  },

  rail: { paddingHorizontal: layout.gutter, gap: layout.gridGutter },
  rowStack: { gap: layout.sectionGap, marginTop: space[3] },
  railCard: { width: IMAGE_SIZES.card, gap: space[1] },
  railCardStacked: { gap: space[1] },
  railThumb: {
    width: IMAGE_SIZES.card,
    height: IMAGE_SIZES.card,
    // `md`, matching `DishImage`'s own corner, so the clip and the image round together
    // rather than leaving a sliver of the box showing at each corner.
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: bg.surfaceMuted,
  },
  railName: {
    color: text.primary,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
    marginTop: space[2],
  },
  price: {
    color: text.price,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
    // §3.5: money is tabular everywhere, so a column of prices does not shimmer.
    fontVariant: ['tabular-nums'],
  },

  skeletonGap: { marginTop: space[3] },
  skeletonRail: { flexDirection: 'row', gap: layout.gridGutter },
});
