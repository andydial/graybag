import { StyleSheet, Text, View } from 'react-native';
import { design, money } from '@graybag/shared';

const { text, border, space, borderWidth, scale } = design;

/**
 * Subtotal · CGST 2.5% · SGST 2.5% · Total — `docs/ux-spec.md` §5.7, `M2`, `SC2`.
 *
 * **The arithmetic is not here.** It is `money.gstBreakdown`, which computes each component from
 * each line's taxable value and rounds half-up per `docs/gst-invoicing.md` §6.2. Taxing the
 * subtotal instead is a paise adrift on a two-line cart, and a cart that disagrees with its own
 * invoice by a paise is a support ticket. This component only renders what that returns.
 *
 * **Every amount comes from `money.formatPaise`.** `design/type.ts` forbids hand-assembling a
 * formatted amount or a currency symbol, and a totals block is where the temptation is highest.
 */
export function CartTotals({
  breakdown,
  testID = 'cart-totals',
}: {
  breakdown: money.GstBreakdown;
  testID?: string;
}) {
  return (
    <View style={styles.totals} testID={testID}>
      <Row label="Subtotal" value={breakdown.taxablePaise} testID="cart-subtotal" />
      {/*
        The rate is named here, unlike in the old cart, because the parent is being shown the
        split rather than told tax exists. `M2` fixes it at CGST 2.5% + SGST 2.5% for Mohali,
        and R11 forbids an IGST line — there is no second state to need one.
      */}
      <Row label="CGST 2.5%" value={breakdown.cgstPaise} testID="cart-cgst" />
      <Row label="SGST 2.5%" value={breakdown.sgstPaise} testID="cart-sgst" />
      <Row label="Total" value={breakdown.totalPaise} testID="cart-total" emphasis />
      <Text style={styles.note} testID="cart-tax-note">
        Menu prices exclude GST. 5% is added here as CGST 2.5% + SGST 2.5%.
      </Text>
    </View>
  );
}

function Row({
  label,
  value,
  testID,
  emphasis = false,
}: {
  label: string;
  value: number;
  testID: string;
  emphasis?: boolean;
}) {
  return (
    <View style={[styles.row, emphasis && styles.grandRow]}>
      <Text style={emphasis ? styles.grandLabel : styles.label}>{label}</Text>
      <Text style={emphasis ? styles.grandValue : styles.value} testID={testID}>
        {money.formatPaise(value)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  totals: { gap: space[1] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  grandRow: {
    borderTopWidth: borderWidth.hairline,
    borderTopColor: border.subtle,
    paddingTop: space[3],
    marginTop: space[2],
  },
  label: { color: text.secondary, fontSize: scale.body.size },
  // Tabular figures so the column of amounts lines up rather than shimmering as digits change.
  value: { color: text.secondary, fontSize: scale.body.size, fontVariant: ['tabular-nums'] },
  grandLabel: { color: text.primary, fontSize: scale.h3.size, fontWeight: scale.h3.weight },
  grandValue: {
    color: text.primary,
    fontSize: scale.h3.size,
    fontWeight: scale.h3.weight,
    fontVariant: ['tabular-nums'],
  },
  note: { color: text.secondary, fontSize: scale.caption.size, marginTop: space[2] },
});
