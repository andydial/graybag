import { Pressable, StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

const { bg, text, border, space, radius, borderWidth, scale, touchTarget } = design;

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
  onChange,
  testID = 'cart-order-for',
}: {
  orderFor: OrderFor | null;
  /**
   * The "Change" affordance in the card's top-right (§5.7: the For block is *editable*).
   *
   * Absent when there is nothing to change — signed out, or no child yet. A button offering
   * to change a child we could not name is a dead end, and the null block's own copy already
   * says the choice happens at the gate.
   */
  onChange?: () => void;
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
  const who = klass === '' ? orderFor.childName : `${orderFor.childName} · Class ${klass}`;

  return (
    <View style={styles.block} testID={testID}>
      <View style={styles.blockRow}>
        <View style={styles.blockText}>
          <Text style={styles.label}>For</Text>
          <Text style={styles.who} testID={`${testID}-child`}>
            {who}
          </Text>
          <Text style={styles.meta} testID={`${testID}-where`}>
            {orderFor.schoolName}
          </Text>
          <Text style={styles.meta} testID={`${testID}-when`}>
            {orderFor.breakLabel
              ? `${orderFor.breakLabel} · ${orderFor.serviceDate}`
              : orderFor.serviceDate}
          </Text>
        </View>

        {onChange === undefined ? null : (
          <Pressable
            onPress={onChange}
            testID={`${testID}-change`}
            accessibilityRole="button"
            // Named, not "Change". A screen-reader user arriving at a bare "Change" has no way
            // to know what it changes — and this one changes whose lunch is being bought.
            accessibilityLabel={`Change who this order is for. Currently ${who}`}
            style={styles.change}
          >
            <Text style={styles.changeLabel}>Change</Text>
          </Pressable>
        )}
      </View>

      {/*
        The "Break time is confirmed with the kitchen" line lived here and is **gone** (`P19`,
        Andy 2026-08-11). It described a manual step nobody can perform at volume: orders
        arrive until midnight for the next day, and no one agrees a window per order overnight.
        The break is now chosen by the parent, in `BreakTimePicker` further down this screen, so
        an unknown break is no longer a thing to explain away — it is a thing to ask.
      */}
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
  meta: { color: text.secondary, fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight },
  pending: { color: text.secondary, fontSize: scale.caption.size, marginTop: space[1] },

  blockRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  blockText: { flex: 1, gap: space[1] },
  // `minHeight` rather than a padded box: the label sits on the card's first line, and a 48pt
  // target that pushed the card taller would move the child's name off the top edge.
  change: { minHeight: touchTarget.min, justifyContent: 'center' },
  changeLabel: { color: text.link, fontSize: scale.label.size, fontWeight: scale.label.weight },
});
