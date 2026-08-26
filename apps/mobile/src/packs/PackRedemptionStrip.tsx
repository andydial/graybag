import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { design } from '@graybag/shared';

import { useMealPackSurface } from './MealPackSurfaceContext';

const { bg, text, border, space, radius, borderWidth, scale, layout } = design;

export const PACK_STRIP_TEST_ID = 'cart-pack-strip';

/**
 * Why this cart cannot be paid with a meal, if it cannot. `E21-39`.
 *
 * Mirrors the server's reasons — `meal_pack_ineligibility_reason` returns exactly these — so the
 * app never invents an explanation the server would not give. It is a **display** of the rule, not
 * a second copy of it: the server decides, and the redemption is refused there whatever this says.
 */
export type PackIneligibility = 'wrong_item_count' | 'missing_required_category' | null;

/**
 * The redemption offer in the cart. `E21-39`, prototype `packStrip`.
 *
 * ## Nothing is spent without an explicit tap
 *
 * The switch is off until the parent turns it on, every time. There is no remembered preference
 * and no default-on: a meal is money, and the prototype is explicit that *"nothing is spent
 * without you tapping it."*
 *
 * ## A cart that does not qualify says why, and what would fix it
 *
 * The refusal names the rule and the gap — "you have three items and no drink" — rather than
 * greying out a control and leaving the parent to guess. A disabled switch with no sentence is
 * the same failure as an empty state with no reason.
 *
 * ## The strip renders on `hasBalance`, never `canBuy`
 *
 * A parent whose school stopped selling packs still holds meals and must still be able to spend
 * them (`E21-31`). The one variant gated on `canBuy` is the *advertisement* — the "order like this
 * often?" prompt — because that one is genuinely trying to sell something.
 */
export function PackRedemptionStrip({
  mealsLeft = 0,
  mealsTotal = 0,
  expiresLabel = null,
  expired = false,
  ineligible = null,
  using = false,
  onToggle,
  onSeeOffers,
  testID = PACK_STRIP_TEST_ID,
}: {
  mealsLeft?: number;
  mealsTotal?: number;
  expiresLabel?: string | null;
  expired?: boolean;
  ineligible?: PackIneligibility;
  using?: boolean;
  onToggle?: ((next: boolean) => void) | undefined;
  onSeeOffers?: (() => void) | undefined;
  testID?: string;
} = {}) {
  const surface = useMealPackSurface();

  // No balance and nothing to sell: the parent sees no pack concept at all, in the cart as
  // everywhere else.
  if (!surface.hasBalance && !surface.canBuy) return null;

  if (!surface.hasBalance) {
    // The advertisement. Only when we actually sell packs here.
    return (
      <Pressable
        style={styles.strip}
        testID={`${testID}-promo`}
        accessibilityRole="button"
        onPress={onSeeOffers}
      >
        <Text style={styles.title}>Order like this often?</Text>
        <Text style={styles.body}>
          A meal pack works out cheaper per meal. See the packs.
        </Text>
      </Pressable>
    );
  }

  if (expired) {
    return (
      <View style={[styles.strip, styles.stripMuted]} testID={`${testID}-expired`}>
        <Text style={styles.title}>
          Your pack expired{expiresLabel === null ? '' : ` on ${expiresLabel}`}
        </Text>
        <Text style={styles.body}>Unused meals are gone and can’t be refunded.</Text>
      </View>
    );
  }

  if (mealsLeft <= 0) {
    return (
      <View style={[styles.strip, styles.stripMuted]} testID={`${testID}-empty`}>
        <Text style={styles.title}>No meals left in your pack</Text>
        <Text style={styles.body}>This order will be charged as usual.</Text>
      </View>
    );
  }

  if (ineligible !== null) {
    return (
      <View style={[styles.strip, styles.stripMuted]} testID={`${testID}-ineligible`}>
        <Text style={styles.title}>This order can’t use a pack meal</Text>
        <Text style={styles.body}>
          {ineligible === 'wrong_item_count'
            ? 'A pack meal is exactly two items, one of them a drink. Adjust the order, or pay for it as usual — '
            : 'A pack meal needs one of the two items to be a drink. Add one, or pay for this order as usual — '}
          your {mealsLeft} {mealsLeft === 1 ? 'meal stays' : 'meals stay'} where they are.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.strip} testID={testID}>
      <View style={styles.row}>
        <View style={styles.grow}>
          <Text style={styles.title}>Pay with a meal from your pack</Text>
          <Text style={styles.body}>
            {mealsLeft} of {mealsTotal} left
            {expiresLabel === null ? '' : ` · expires ${expiresLabel}`}
            {using ? ' · this order uses one' : ''}
          </Text>
        </View>
        <Switch
          testID={`${testID}-switch`}
          value={using}
          onValueChange={(next) => onToggle?.(next)}
          accessibilityLabel="Use a pack meal"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    marginHorizontal: layout.gutter,
    marginBottom: space[3],
    padding: layout.cardPadding,
    borderRadius: radius.lg,
    borderWidth: borderWidth.hairline,
    borderColor: border.subtle,
    backgroundColor: bg.surfaceAccent,
  },
  stripMuted: { backgroundColor: bg.surfaceMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  grow: { flex: 1 },
  title: {
    fontSize: scale.label.size,
    lineHeight: scale.label.lineHeight,
    fontWeight: '700',
    color: text.primary,
  },
  body: {
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
    color: text.secondary,
    marginTop: space[1],
  },
});
