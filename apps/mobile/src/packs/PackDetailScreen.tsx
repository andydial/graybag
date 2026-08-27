import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, design, money } from '@graybag/shared';

import { Button } from '../components';

const { bg, text, border, space, radius, borderWidth, scale, layout } = design;

export const PACK_DETAIL_TEST_ID = 'screen-pack-detail';

/**
 * One offer, and the decision to buy it. `E21-48`, prototype `V.packdetail`.
 *
 * ## The two terms a parent must read before paying, not after
 *
 * **Expiry** and **no refunds**. The prototype puts both above the button under a heading that
 * says "Before you buy", and repeats the expiry under the button itself. That is not
 * over-explaining: a pack is money handed over for food that has not been made yet, and the two
 * things a parent can be surprised by later are the date it stops working and the fact that they
 * cannot change their mind.
 *
 * `docs/legal` says the same, and the refund policy is a published document — but a term a
 * customer meets first in a policy they did not open is a term they meet after paying.
 *
 * ## GST is shown, because the price is exclusive
 *
 * Menu prices exclude GST and 5% is added at checkout (non-negotiable #7). A pack is no different,
 * so the button carries the **payable** figure rather than the headline price. A parent who reads
 * ₹3,000 and is charged ₹3,150 has been surprised at the last step, which is the one place §5.7
 * says the amount and the commitment must agree.
 */
export function PackDetailScreen({
  offer = null,
  buying = false,
  onBuy,
  testID = PACK_DETAIL_TEST_ID,
}: {
  offer?: api.MealPackOffer | null;
  /** True while the purchase is being started. Disables the button so a double tap cannot buy twice. */
  buying?: boolean;
  onBuy?: (() => void) | undefined;
  testID?: string;
} = {}) {
  if (offer === null) {
    return <View style={styles.screen} testID={testID} />;
  }

  // 5% on top, as CGST 2.5% + SGST 2.5%. The server computes the authoritative figure from
  // `platform_config`; this is what the parent is told, and the two are asserted equal by
  // `meal_pack_ledger.test.sql` rather than assumed.
  const taxPaise = Math.round(offer.netPricePaise * 0.05);
  const payablePaise = offer.netPricePaise + taxPaise;
  const savingPaise = offer.alacarteReferencePaise - offer.netPricePaise;

  return (
    <View style={styles.screen} testID={testID}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.pad}>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{money.formatPaise(payablePaise)}</Text>
            <Text style={styles.was}>{money.formatPaise(offer.alacarteReferencePaise)}</Text>
            <Text style={styles.save}>save {money.formatPaise(savingPaise)}</Text>
          </View>
          <Text style={styles.priceNote} testID={`${testID}-gst`}>
            {money.formatPaise(offer.netPricePaise)} + {money.formatPaise(taxPaise)} GST
            (CGST 2.5% + SGST 2.5%)
          </Text>

          <Text style={styles.sectionHead}>What you get</Text>
          <Text style={styles.bullet}>
            • {offer.mealsCount} meals. One meal covers one child on one day.
          </Text>
          <Text style={styles.bullet}>
            • {offer.itemsPerMeal} items per meal, one of them a drink.
          </Text>
          <Text style={styles.bullet}>
            • Order on any day the school serves, up to the usual cutoff.
          </Text>
          <Text style={styles.bullet}>
            • Use it for anyone you order for, at any participating school.
          </Text>

          <Text style={styles.sectionHead}>Before you buy</Text>
          <View style={styles.warn} testID={`${testID}-expiry`}>
            <Text style={styles.warnTitle}>
              Meals expire {offer.validityDays} days after purchase
            </Text>
            <Text style={styles.warnBody}>
              Anything unused after that is gone. We’ll remind you when a week is left.
            </Text>
          </View>
          <View style={styles.warn} testID={`${testID}-no-refund`}>
            <Text style={styles.warnTitle}>Packs aren’t refundable</Text>
            <Text style={styles.warnBody}>
              Once bought, a pack can only be used as meals. Single orders can still be cancelled
              before the cutoff as usual.
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={buying ? 'Starting…' : `Buy · ${money.formatPaise(payablePaise)}`}
          testID={`${testID}-buy`}
          disabled={buying}
          onPress={() => onBuy?.()}
        />
        <Text style={styles.footerNote}>
          Expires {offer.validityDays} days after purchase · no refunds
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  content: { paddingBottom: space[8] },
  pad: { paddingHorizontal: layout.gutter, paddingTop: space[4] },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
  price: {
    fontSize: scale.display.size, lineHeight: scale.display.lineHeight, fontWeight: '700',
    color: text.primary,
  },
  was: {
    fontSize: scale.body.size, lineHeight: scale.body.lineHeight, color: text.secondary,
    textDecorationLine: 'line-through',
  },
  save: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, fontWeight: '700',
    color: text.link,
  },
  priceNote: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.secondary,
    marginTop: space[1],
  },
  sectionHead: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.secondary,
    textTransform: 'uppercase', letterSpacing: scale.caption.tracking, marginTop: space[6],
    marginBottom: space[2],
  },
  bullet: {
    fontSize: scale.body.size, lineHeight: scale.body.lineHeight, color: text.primary,
    marginBottom: space[1],
  },
  warn: {
    borderWidth: borderWidth.hairline, borderColor: border.subtle, borderRadius: radius.md,
    backgroundColor: bg.surfaceMuted, padding: layout.cardPadding, marginBottom: space[2],
  },
  warnTitle: {
    fontSize: scale.label.size, lineHeight: scale.label.lineHeight, fontWeight: '700',
    color: text.primary,
  },
  warnBody: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.secondary,
    marginTop: space[1],
  },
  footer: {
    paddingHorizontal: layout.gutter, paddingTop: space[3], paddingBottom: space[4],
    borderTopWidth: borderWidth.hairline, borderTopColor: border.subtle,
    backgroundColor: bg.surface, gap: space[2],
  },
  footerNote: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.secondary,
    textAlign: 'center',
  },
});
