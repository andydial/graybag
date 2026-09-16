import { Pressable, StyleSheet, Text, View } from 'react-native';
import { design, money, type packCoverage } from '@graybag/shared';

import { useMealPackSurface } from './MealPackSurfaceContext';

const { bg, text, border, space, radius, borderWidth, scale, layout } = design;

export const PACK_STRIP_TEST_ID = 'cart-pack-strip';

/**
 * What the pack covers in this cart, and what is left to pay. `E21-76`, rebuilt from `E21-39`.
 *
 * Andy, 2026-09-16: *"Cart: show items covered by the pack and the cash amount due, clearly
 * separated. If the pack partly covers the cart, say so before checkout, not after."*
 *
 * ## The switch is gone, and coverage is automatic
 *
 * The old design had a toggle, on the principle that *"nothing is spent without you tapping it"* —
 * correct when a pack meal was an all-or-nothing unit a parent opted into. It does not survive
 * the rebuild: coverage is now **per item and partial**, so there is no single thing to opt into.
 * A cart of three items against a balance of two is not a yes/no question.
 *
 * **Recorded as a decision (`P25`) rather than slipped in**, because it changes what happens to a
 * parent's money without them tapping anything. The reasoning: items expire and are never
 * refunded, so spending them is always better for the parent than not spending them; the brief
 * describes display, not a control; and the strip below still shows exactly what will happen
 * before Place order, which is the protection the tap was really providing.
 *
 * The cost is real and worth stating: a parent cannot save pack items for a larger order, and
 * under cheapest-first (`P23`) the pack covers the ₹40 drink rather than the ₹250 main. Adding an
 * opt-out later needs no schema change — only a request field `checkout` passes through.
 *
 * ## Every covered line is named, never summarised as a count
 *
 * "1 item covered" beside a total the parent has not reconciled is the surprise this screen
 * exists to prevent. With cheapest-first the covered line is routinely the one they care least
 * about, so it has to be said out loud while the cart can still be changed.
 *
 * ## The strip renders on `hasBalance`, never `canBuy`
 *
 * A parent whose school stopped selling packs still holds items and must still be able to spend
 * them (`E21-31`). The one variant gated on `canBuy` is the *advertisement*, because that one is
 * genuinely trying to sell something.
 */
export function PackRedemptionStrip({
  coverage = null,
  itemsLeft = 0,
  itemsTotal = 0,
  expiresLabel = null,
  expired = false,
  onSeeOffers,
  testID = PACK_STRIP_TEST_ID,
}: {
  /** What the pack will cover. `null` renders the balance without a per-line breakdown. */
  coverage?: packCoverage.PackCoverage | null;
  itemsLeft?: number;
  itemsTotal?: number;
  expiresLabel?: string | null;
  expired?: boolean;
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
        <Text style={styles.body}>Buy a meal pack and pay for a run of items up front.</Text>
      </Pressable>
    );
  }

  if (expired) {
    return (
      <View style={[styles.strip, styles.stripMuted]} testID={`${testID}-expired`}>
        <Text style={styles.title}>
          Your pack expired{expiresLabel === null ? '' : ` on ${expiresLabel}`}
        </Text>
        <Text style={styles.body}>Unused items are gone and can’t be refunded.</Text>
      </View>
    );
  }

  if (itemsLeft <= 0) {
    return (
      <View style={[styles.strip, styles.stripMuted]} testID={`${testID}-empty`}>
        <Text style={styles.title}>No items left in your pack</Text>
        <Text style={styles.body}>This order will be charged as usual.</Text>
      </View>
    );
  }

  const covered = coverage?.covered ?? [];

  if (covered.length === 0) {
    // A balance, but nothing in the cart yet for it to cover.
    return (
      <View style={styles.strip} testID={`${testID}-idle`}>
        <Text style={styles.title}>Your pack will cover what it can</Text>
        <Text style={styles.body}>
          {itemsLeft} of {itemsTotal} items left
          {expiresLabel === null ? '' : ` · expires ${expiresLabel}`}
        </Text>
      </View>
    );
  }

  const leftAfter = Math.max(0, itemsLeft - (coverage?.itemsCovered ?? 0));

  return (
    <View style={styles.strip} testID={testID}>
      <Text style={styles.title} testID={`${testID}-heading`}>
        {coverage?.isPartial === true
          ? 'Your pack covers part of this order'
          : 'Your pack covers this order'}
      </Text>

      {/*
        Line by line, with the quantity when only some of a line is covered. This is the sentence
        Andy asked to be said before checkout — a parent who expected the main to be covered must
        see that it is not while they can still change the cart.
      */}
      {covered.map((line) => (
        <View key={line.key} style={styles.coveredRow} testID={`${testID}-line-${line.key}`}>
          <Text style={styles.coveredName} numberOfLines={1}>
            {line.dishName}
            {line.cashQuantity > 0 ? ` × ${line.coveredQuantity}` : ''}
          </Text>
          <Text style={styles.coveredTag}>covered</Text>
        </View>
      ))}

      <Text style={styles.body} testID={`${testID}-summary`}>
        {coverage?.itemsCovered} {coverage?.itemsCovered === 1 ? 'item' : 'items'} from your pack ·{' '}
        {leftAfter} left after this
        {expiresLabel === null ? '' : ` · expires ${expiresLabel}`}
      </Text>

      {coverage !== null && coverage.cashDuePaise > 0 ? (
        <Text style={styles.cash} testID={`${testID}-cash`}>
          {money.formatPaise(coverage.cashDuePaise)} to pay for the rest, including GST
        </Text>
      ) : (
        <Text style={styles.cash} testID={`${testID}-cash`}>
          Nothing to pay — GST was charged when you bought the pack
        </Text>
      )}
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
  coveredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginTop: space[2],
  },
  coveredName: {
    flex: 1,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
    color: text.primary,
  },
  coveredTag: {
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
    fontWeight: '700',
    color: text.secondary,
  },
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
    marginTop: space[2],
  },
  cash: {
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
    fontWeight: '700',
    color: text.primary,
    marginTop: space[1],
  },
});
