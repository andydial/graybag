import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

import { Button, EmptyState } from '../components';
import { useMealPackSurface } from './MealPackSurfaceContext';

const { bg, text, border, space, radius, borderWidth, scale, layout } = design;

export const MY_PACKS_TEST_ID = 'screen-my-packs';

/** What a parent's balance looks like. Shaped by `E21-35`; filled by the balance read. */
export interface PackBalance {
  packName: string;
  mealsTotal: number;
  mealsRemaining: number;
  /** Rendered, never parsed. Formatted by the caller so this screen holds no date logic. */
  purchasedLabel: string;
  expiresLabel: string;
  expired: boolean;
}

/**
 * The balance. `E21-35`, prototype `V.mypacks`.
 *
 * ## This screen must survive its school being switched off
 *
 * Andy, 2026-08-26: *"a parent who already owns a pack at a school we then switch off… must keep
 * their balance and keep being able to spend it. Turning an offer off stops selling; it must never
 * strand meals somebody has already paid for."*
 *
 * So nothing here consults `canBuy`. The only gate is `hasBalance`, which the server answers from
 * the parent's own packs and no configuration change can turn off (`E21-31`). The one place
 * `canBuy` appears is the empty state's call to action — offering to *buy* a pack is the one
 * thing that genuinely depends on whether we sell here.
 *
 * ## Three empties, three sentences
 *
 * No pack, every meal spent, and expired are different facts with different next actions, and the
 * prototype writes all three. Collapsing them into "nothing to show" is the defect §5.21 exists
 * to stop — "you have used every meal" and "this expired and the meals are gone" are not the same
 * news.
 */
export function MyPacksScreen({
  balance = null,
  onSeeOffers,
  onPlanMeals,
  testID = MY_PACKS_TEST_ID,
}: {
  balance?: PackBalance | null;
  onSeeOffers?: (() => void) | undefined;
  onPlanMeals?: (() => void) | undefined;
  testID?: string;
} = {}) {
  const surface = useMealPackSurface();

  if (balance === null) {
    return (
      <View style={styles.screen} testID={testID}>
        <EmptyState
          testID={`${testID}-none`}
          title="You don’t have a meal pack"
          body="Packs let you pay once and order all term, at a lower price per meal."
          {...(surface.canBuy && onSeeOffers !== undefined
            ? { actionLabel: 'See the packs', onAction: onSeeOffers }
            : {})}
        />
      </View>
    );
  }

  const left = balance.mealsRemaining;
  const pct = balance.mealsTotal === 0 ? 0 : Math.round((left / balance.mealsTotal) * 100);

  return (
    <ScrollView style={styles.screen} testID={testID} contentContainerStyle={styles.content}>
      <View style={styles.balance} testID={`${testID}-balance`}>
        <Text style={styles.balanceLabel}>{balance.expired ? 'Expired' : 'Meals left'}</Text>
        <Text style={styles.balanceBig}>
          {balance.expired ? '—' : `${left} of ${balance.mealsTotal}`}
        </Text>
        <Text style={styles.balanceSub}>
          {balance.packName} · bought {balance.purchasedLabel}
          {'\n'}
          {balance.expired
            ? `Expired ${balance.expiresLabel}. Unused meals are gone.`
            : `Expires ${balance.expiresLabel}`}
        </Text>
        {balance.expired ? null : (
          <View style={styles.meter} testID={`${testID}-meter`}>
            <View style={[styles.meterFill, { width: `${pct}%` }]} />
          </View>
        )}
      </View>

      {balance.expired ? (
        <View style={styles.pad}>
          <Text style={styles.noticeTitle}>This pack has expired</Text>
          <Text style={styles.noticeBody}>
            It ran out on {balance.expiresLabel}. Packs can’t be extended or refunded, but you can
            buy a new one.
          </Text>
          {/* The one place `canBuy` matters on this screen: offering to sell. */}
          {surface.canBuy && onSeeOffers !== undefined ? (
            <Button label="See the packs" onPress={onSeeOffers} variant="secondary" />
          ) : null}
        </View>
      ) : left === 0 ? (
        <View style={styles.pad}>
          <Text style={styles.noticeTitle}>You’ve used every meal in this pack</Text>
          <Text style={styles.noticeBody}>
            Buy another and it stacks on top — meals are spent oldest first.
          </Text>
          {surface.canBuy && onSeeOffers !== undefined ? (
            <Button label="Buy another" onPress={onSeeOffers} variant="secondary" />
          ) : null}
        </View>
      ) : (
        <View style={styles.pad}>
          <Text style={styles.sectionHead}>How these get used</Text>
          <Text style={styles.noticeBody}>
            Two ways. Plan several days at once below — or just order normally, and when your cart
            is two items with a drink we’ll offer to pay with a meal instead of charging you.
            Either way nothing is spent without you tapping it.
          </Text>
          <View style={{ height: space[4] }} />
          {/*
            Planning is spending a balance, not buying, so it stays available at a school where we
            have stopped selling. This is the button that would have vanished if the whole screen
            were gated on `canBuy`.
          */}
          {onPlanMeals === undefined ? null : (
            <Button label="Plan meals from this pack" onPress={onPlanMeals} />
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  content: { paddingBottom: space[8] },
  pad: { paddingHorizontal: layout.gutter, paddingTop: space[4] },
  balance: {
    margin: layout.gutter, padding: space[5], borderRadius: radius.xl,
    backgroundColor: bg.surfaceAccent,
  },
  balanceLabel: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight,
    color: text.secondary, textTransform: 'uppercase', letterSpacing: scale.caption.tracking,
  },
  balanceBig: {
    fontSize: scale.display.size, lineHeight: scale.display.lineHeight,
    fontWeight: '700', color: text.primary, marginTop: space[1],
  },
  balanceSub: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight,
    color: text.secondary, marginTop: space[2],
  },
  meter: {
    height: 6, borderRadius: radius.full, backgroundColor: bg.surfaceMuted,
    marginTop: space[4], overflow: 'hidden',
  },
  meterFill: { height: 6, borderRadius: radius.full, backgroundColor: text.link },
  sectionHead: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.secondary,
    textTransform: 'uppercase', letterSpacing: scale.caption.tracking, marginBottom: space[2],
  },
  noticeTitle: {
    fontSize: scale.h3.size, lineHeight: scale.h3.lineHeight, fontWeight: '700',
    color: text.primary, marginBottom: space[1],
  },
  noticeBody: {
    fontSize: scale.body.size, lineHeight: scale.body.lineHeight, color: text.secondary,
    marginBottom: space[3],
  },
  divider: { height: borderWidth.hairline, backgroundColor: border.subtle },
});
