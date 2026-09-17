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
  error = null,
  onBuy,
  testID = PACK_DETAIL_TEST_ID,
}: {
  offer?: api.MealPackOffer | null;
  /** True while the purchase is being started. Disables the button so a double tap cannot buy twice. */
  buying?: boolean;
  /**
   * Why the last attempt failed, in words a parent can act on. `null` when nothing has failed.
   *
   * `E21-91`. This screen had **no error state at all**: the handler's `.catch` was empty, so a
   * server refusal produced a button that did nothing, forever, with no spinner and no message.
   * Andy tapped it several times and the app told him nothing while the server refused every
   * attempt with a 400. **A visible error beats silence** — his words, and the reason this prop
   * exists rather than a log line.
   */
  error?: string | null;
  onBuy?: (() => void) | undefined;
  testID?: string;
} = {}) {
  if (offer === null) {
    return <View style={styles.screen} testID={testID} />;
  }

  // 5% on top, as CGST 2.5% + SGST 2.5%. The server computes the authoritative figure from
  // `platform_config`; this is what the parent is told, and the two are asserted equal by
  // `meal_pack_ledger.test.sql` rather than assumed.
  // Per component, half-up, from the shared identity — never `× 0.05`, which is a float touching
  // money (non-negotiable #3) and disagrees with the server at the half-paise boundary.
  const cgstPaise = money.halfUp(offer.netPricePaise * money.CGST_RATE_BPS, 10_000);
  const sgstPaise = money.halfUp(offer.netPricePaise * money.SGST_RATE_BPS, 10_000);
  const taxPaise = cgstPaise + sgstPaise;
  const payablePaise = offer.netPricePaise + taxPaise;

  return (
    <View style={styles.screen} testID={testID}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.pad}>
          {/*
            The payable figure, alone. The old design showed it against an "à la carte reference"
            and a saving; both are gone with `alacarteReferencePaise`, and deliberately not
            replaced. With no price cap a pack's worth depends entirely on what the parent spends
            it on — a ₹3,000 pack buys 20 drinks or 20 mains — so any headline saving would be a
            claim we cannot stand behind. `check:claims` exists for exactly this class of number.
          */}
          <View style={styles.priceRow}>
            <Text style={styles.price}>{money.formatPaise(payablePaise)}</Text>
          </View>
          <Text style={styles.priceNote} testID={`${testID}-gst`}>
            {money.formatPaise(offer.netPricePaise)} + {money.formatPaise(taxPaise)} GST
            (CGST 2.5% + SGST 2.5%)
          </Text>

          <Text style={styles.sectionHead}>What you get</Text>
          <Text style={styles.bullet} testID={`${testID}-items`}>
            • {offer.itemsCount} items. Anything on the menu counts as one item — a drink, a
            main, a side.
          </Text>
          <Text style={styles.bullet}>
            • Order on any day the school serves, up to the usual cutoff.
          </Text>
          <Text style={styles.bullet}>
            • Use it for any of your children at this school.
          </Text>
          {offer.bonusItemsCount > 0 ? (
            // The bonus rule in plain words, as Andy asked: one sentence a parent reads once.
            // Both numbers come from the offer, so an admin changing either cannot leave the copy
            // describing a promise we no longer make.
            <Text style={styles.bullet} testID={`${testID}-bonus`}>
              • Use all {offer.itemsCount} within {offer.bonusWindowDays} days and we’ll add{' '}
              {offer.bonusItemsCount} more, free. The extra items expire with the pack — they
              don’t extend it.
            </Text>
          ) : null}

          <Text style={styles.sectionHead}>Before you buy</Text>
          <View style={styles.warn} testID={`${testID}-expiry`}>
            <Text style={styles.warnTitle}>
              Items expire {offer.validityDays} days after purchase
            </Text>
            <Text style={styles.warnBody}>
              Anything unused after that is gone. We’ll remind you when a week is left.
            </Text>
          </View>
          <View style={styles.warn} testID={`${testID}-no-refund`}>
            <Text style={styles.warnTitle}>Packs aren’t refundable</Text>
            <Text style={styles.warnBody}>
              Once bought, a pack can only be used as items on the menu. Single orders can still be
              cancelled before the cutoff as usual.
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {error === null ? null : (
          <Text style={styles.error} testID={`${testID}-error`} accessibilityRole="alert">
            {error}
          </Text>
        )}
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
  error: {
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
    fontWeight: '700',
    color: text.danger,
    marginBottom: space[2],
  },
  footerNote: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.secondary,
    textAlign: 'center',
  },
});
