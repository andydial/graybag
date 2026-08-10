import { Image } from 'expo-image';
import { ImageBackground, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { design } from '@graybag/shared';

import { CartBadge } from './cart/CartBadge';
import { useCart } from '../cart/CartContext';

const { bg, text, border, foodType, space, radius, borderWidth, scale } = design;

/**
 * The brand furniture every screen shares — `E21`, built from
 * `docs/prototype/graybag-prototype.html`.
 *
 * These live in one file because they are the pieces that make a screen look like GrayBag
 * rather than like a wireframe, and eight screens are about to use them at once. A second
 * implementation of the header or the veg mark is how two screens come to disagree about what
 * the product looks like.
 *
 * **Everything here is a semantic role or an asset.** No colour literals, no spacing literals —
 * `config/eslint-design-system.js` enforces it, and this file is the one most tempted to cheat.
 */

const LOGO_GREEN = require('../../assets/brand/logo-green.png');
const LOGO_WHITE = require('../../assets/brand/logo-white.png');
const ICON_GREEN = require('../../assets/brand/icon-green.png');
const PATTERN_DARK = require('../../assets/brand/pattern-dark.png');
const PATTERN_GREEN = require('../../assets/brand/pattern-green.png');

/**
 * The full lockup — mark and wordmark together, as supplied.
 *
 * **Never set the wordmark in type beside the mark.** The supplied asset is the lockup; drawing
 * the icon and then typing "graybag" next to it produced a duplicated wordmark in the first
 * prototype build, and the spacing is not ours to invent.
 *
 * The white variant exists because the green lockup on a green fill is invisible — which is
 * exactly how the first prototype shipped a header nobody could see.
 */
export function Lockup({ height = 28, white = false }: { height?: number; white?: boolean }) {
  return (
    <Image
      source={white ? LOGO_WHITE : LOGO_GREEN}
      style={{ height, width: height * 3.05 }}
      contentFit="contain"
      accessibilityLabel="GrayBag"
    />
  );
}

/**
 * The app bar: lockup left, cart badge right.
 *
 * No notification bell — `P?`/ux-spec §5.4: with no push in v1 a bell would have nothing to
 * show that the Orders tab does not already carry, and the cart count is the thing a parent
 * actually looks for.
 */
export function BrandHeader({ testID = 'brand-header' }: { testID?: string }) {
  const { itemCount } = useCart();
  return (
    <View style={styles.header} testID={testID}>
      <Lockup />
      <View style={styles.headerRight}>
        <CartBadge count={itemCount} />
      </View>
    </View>
  );
}

/**
 * A green panel with the vegetable pattern over it — splash, welcome, confirmation, empty
 * states, and the "Delivering to" card.
 *
 * The **dark green** pattern over a green fill, not the green one: the pattern PNGs are coloured
 * shapes on transparency, so green-on-green vanishes. Tone-on-tone is what gives reference
 * screens 01 and 02 their texture.
 */
export function BrandPanel({
  children,
  style,
  radius: cornerRadius = radius.lg,
  testID,
}: {
  children?: React.ReactNode;
  style?: ViewStyle;
  radius?: number;
  testID?: string;
}) {
  return (
    <ImageBackground
      source={PATTERN_DARK}
      imageStyle={[styles.patternImage, { borderRadius: cornerRadius }]}
      style={[styles.panel, { borderRadius: cornerRadius }, style]}
      testID={testID}
    >
      {children}
    </ImageBackground>
  );
}

/**
 * What a dish with no photograph looks like.
 *
 * **Never a grey box.** Every dish in staging has `image_path = null` until `E16-43` uploads the
 * mirrored catalogue, and three of the real photos are a permanent 403 at source, so this is not
 * a rare state — it is most of the menu today. A branded tile says "photo coming" without
 * looking broken.
 */
export function PatternTile({ style, testID }: { style?: ViewStyle; testID?: string }) {
  return (
    <ImageBackground
      source={PATTERN_GREEN}
      imageStyle={styles.tileImage}
      style={[styles.tile, style]}
      testID={testID}
    >
      <Image source={ICON_GREEN} style={styles.tileIcon} contentFit="contain" />
    </ImageBackground>
  );
}

/**
 * Veg / egg / non-veg, as an Indian audience expects to see it: a coloured dot inside a square
 * outline of the same colour.
 *
 * **This is the first thing a parent looks at**, and none of the nine reference screens has one —
 * they are a generic delivery template. Green for vegetarian, amber for egg, red for non-veg.
 *
 * The label is spelled out for a screen reader because the mark is pure colour, and §7 of the
 * design system says an icon carrying state must carry it in its label too.
 */
export function FoodTypeMark({
  foodType,
  testID,
}: {
  foodType: 'veg' | 'egg' | 'non_veg' | null;
  testID?: string;
}) {
  if (foodType === null) return null;
  const tone =
    foodType === 'veg' ? styles.markVeg : foodType === 'egg' ? styles.markEgg : styles.markNonVeg;
  const dot =
    foodType === 'veg' ? styles.dotVeg : foodType === 'egg' ? styles.dotEgg : styles.dotNonVeg;
  const label =
    foodType === 'veg' ? 'Pure vegetarian' : foodType === 'egg' ? 'Contains egg' : 'Non-vegetarian';

  return (
    <View
      style={[styles.mark, tone]}
      accessibilityLabel={label}
      accessibilityRole="image"
      testID={testID}
    >
      <View style={[styles.dot, dot]} />
    </View>
  );
}

/**
 * "Contains Peanuts" over a dish photo.
 *
 * Amber rather than red: it is a warning that needs a decision, not an error that blocks one.
 * A parent may have entirely good reasons to order it (ux-spec §5.6).
 */
export function AllergenFlag({ allergens, testID }: { allergens: string[]; testID?: string }) {
  if (allergens.length === 0) return null;
  return (
    <View style={styles.flag} testID={testID}>
      <Text style={styles.flagText} numberOfLines={1}>
        Contains {allergens[0]}
        {allergens.length > 1 ? ` +${allergens.length - 1}` : ''}
      </Text>
    </View>
  );
}

/** A section rule with a green title, as the prototype's "Popular this week" uses. */
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.sectionHeading}>
      <View style={styles.rule} />
      <Text style={styles.sectionTitle}>{children}</Text>
      <View style={styles.rule} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[3],
    backgroundColor: bg.surface,
  },
  headerRight: { minWidth: space[6], alignItems: 'flex-end' },

  panel: { backgroundColor: bg.surfaceBrand, overflow: 'hidden' },
  // Low enough to read as texture rather than as content, high enough to survive a phone in
  // sunlight, which is where a school gate is.
  patternImage: { opacity: 0.28 },

  tile: {
    flex: 1,
    backgroundColor: bg.surfaceAccent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tileImage: { opacity: 0.35 },
  tileIcon: { width: space[8], height: space[8], opacity: 0.55 },

  mark: {
    width: space[4],
    height: space[4],
    borderRadius: radius.xs,
    borderWidth: borderWidth.emphasis,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: bg.surface,
  },
  markVeg: { borderColor: foodType.veg },
  markEgg: { borderColor: foodType.egg },
  markNonVeg: { borderColor: foodType.nonVeg },
  dot: { width: space[2], height: space[2], borderRadius: radius.full },
  dotVeg: { backgroundColor: foodType.veg },
  dotEgg: { backgroundColor: foodType.egg },
  dotNonVeg: { backgroundColor: foodType.nonVeg },

  flag: {
    backgroundColor: bg.surfaceWarning,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radius.sm,
  },
  flagText: { color: text.warning, fontSize: scale.overline.size, fontWeight: scale.label.weight },

  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[3] },
  rule: { flex: 1, height: borderWidth.emphasis, backgroundColor: border.accent },
  sectionTitle: { color: text.link, fontSize: scale.h3.size, fontWeight: scale.h3.weight },
});
