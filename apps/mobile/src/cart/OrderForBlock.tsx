import { StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

const { bg, text, border, space, radius, borderWidth, scale } = design;

/**
 * "For \<child\> · \<school\> · \<break\> · \<date\>" — `docs/ux-spec.md` §5.7, and the rule
 * behind it: **a parent must never be one tap from paying without seeing whose lunch this is
 * and when it is handed over.**
 *
 * ## Why the break time can be absent, and why that is not a placeholder
 *
 * The break is not on the cart line and is not returned by `fetchRecipients`, so today the cart
 * cannot resolve it (`E05-29`). §5.21 forbids rendering an unknown as a known: showing a
 * plausible break we have not resolved would be worse than showing none, because the parent
 * would believe the lunch is going to that break. So an unresolved break is **omitted with a
 * line saying it is not confirmed yet**, never filled in with a guess.
 *
 * The same reasoning applies to a missing child: signed out, or signed in with none added,
 * this block says so in words rather than rendering a name that does not exist.
 */
export interface OrderFor {
  childName: string;
  classLabel: string | null;
  sectionLabel: string | null;
  schoolName: string;
  /** Human service date, already formatted by the caller. */
  serviceDate: string;
  /** Absent until `E05-29` puts the break on the line. Never invented. */
  breakLabel?: string | null;
}

export function OrderForBlock({
  orderFor,
  testID = 'cart-order-for',
}: {
  orderFor: OrderFor | null;
  testID?: string;
}) {
  if (orderFor === null) {
    return (
      <View style={styles.block} testID={`${testID}-unknown`}>
        <Text style={styles.label}>For</Text>
        <Text style={styles.who}>No child chosen yet</Text>
        <Text style={styles.meta}>
          You&rsquo;ll choose the child and the day when you place this order.
        </Text>
      </View>
    );
  }

  const klass = [orderFor.classLabel, orderFor.sectionLabel].filter(Boolean).join('-');

  return (
    <View style={styles.block} testID={testID}>
      <Text style={styles.label}>For</Text>
      <Text style={styles.who} testID={`${testID}-child`}>
        {klass === '' ? orderFor.childName : `${orderFor.childName} · Class ${klass}`}
      </Text>
      <Text style={styles.meta} testID={`${testID}-where`}>
        {orderFor.schoolName}
      </Text>
      <Text style={styles.meta} testID={`${testID}-when`}>
        {orderFor.breakLabel
          ? `${orderFor.breakLabel} · ${orderFor.serviceDate}`
          : orderFor.serviceDate}
      </Text>
      {orderFor.breakLabel ? null : (
        // Explicitly unknown, never a guess. See the note above.
        <Text style={styles.pending} testID={`${testID}-break-unknown`}>
          Break time is confirmed with the kitchen.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    borderWidth: borderWidth.hairline,
    borderColor: border.subtle,
    borderRadius: radius.lg,
    backgroundColor: bg.surface,
    padding: space[4],
    gap: space[1],
  },
  label: {
    color: text.secondary,
    fontSize: scale.overline.size,
    fontWeight: scale.overline.weight,
    // `tracking` is expressed in **em** (see `design/css.ts`), and React Native's
    // `letterSpacing` is in **points** — so passing it raw sets 0.08pt, which is no tracking at
    // all on an uppercase label that needs it most. Multiply by the size.
    letterSpacing: scale.overline.size * scale.overline.tracking,
    textTransform: 'uppercase',
  },
  who: { color: text.primary, fontSize: scale.h3.size, fontWeight: scale.h3.weight },
  meta: { color: text.secondary, fontSize: scale.caption.size },
  pending: { color: text.secondary, fontSize: scale.caption.size, marginTop: space[1] },
});
