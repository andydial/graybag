import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

import { Button, EmptyState } from '../components';
import { useMealPackSurface } from './MealPackSurfaceContext';

const { bg, text, border, space, radius, borderWidth, scale, layout } = design;

export const MY_PACKS_TEST_ID = 'screen-my-packs';

/** What a parent's balance looks like. Shaped by `E21-35`; filled by the balance read. */
export interface PackBalance {
  packName: string;
  /** Named on every pack: a parent with children at two schools holds two balances (`P22`). */
  schoolName: string;
  /** Original items, plus the bonus once it is earned. */
  itemsTotal: number;
  itemsRemaining: number;
  /**
   * What a NEW cart may draw on — `itemsRemaining` less anything a checkout in flight has
   * already spoken for. The two differ only while a payment is pending, and showing the wrong
   * one would promise an item a second tab has already taken.
   */
  itemsSpendable: number;
  /** Rendered, never parsed. Formatted by the caller so this screen holds no date logic. */
  purchasedLabel: string;
  expiresLabel: string;
  expired: boolean;
  /** Earned / still possible / closed — the server's three-way answer, never re-derived here. */
  bonus?: PackBonusState;
  /** Which orders drew on this pack. Order references and dates only — never a child. */
  history?: readonly PackHistoryEntry[];
}

/** The bonus, as a parent is told it. */
export interface PackBonusState {
  items: number;
  granted: boolean;
  stillPossible: boolean;
  /** How many more items must be used to earn it. Zero once earned or once impossible. */
  itemsToGo: number;
  /** Rendered, never parsed. */
  windowEndsLabel: string;
}

/** One order that drew on this pack. Carries NO recipient (non-negotiable #4). */
export interface PackHistoryEntry {
  orderRef: string;
  dateLabel: string;
  itemsUsed: number;
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
  otherPacks = [],
  onSeeOffers,
  testID = MY_PACKS_TEST_ID,
}: {
  balance?: PackBalance | null;
  /**
   * Every OTHER live pack, in the order meals will be taken from them. `E21-49`.
   *
   * Andy, 2026-08-27: *"if a parent holds two packs, show both, each with its own expiry, and be
   * explicit that meals are spent oldest first. A single summed number can't answer 'when do I
   * lose these', but neither can showing only one pack when they own two."*
   *
   * `balance` is the one the next order draws from; these follow it. Rendering only the first
   * would hide a nearer expiry behind a later one, which is the failure the summed number had.
   */
  otherPacks?: readonly PackBalance[];
  onSeeOffers?: (() => void) | undefined;
  testID?: string;
} = {}) {
  const surface = useMealPackSurface();

  if (balance === null) {
    return (
      <View style={styles.screen} testID={testID}>
        <EmptyState
          testID={`${testID}-none`}
          title="You don’t have a meal pack"
          body="Packs let you pay for a run of items up front, and use them on anything on the menu."
          {...(surface.canBuy && onSeeOffers !== undefined
            ? { actionLabel: 'See the packs', onAction: onSeeOffers }
            : {})}
        />
      </View>
    );
  }

  const left = balance.itemsRemaining;
  const pct = balance.itemsTotal === 0 ? 0 : Math.round((left / balance.itemsTotal) * 100);

  return (
    <ScrollView style={styles.screen} testID={testID} contentContainerStyle={styles.content}>
      <View style={styles.balance} testID={`${testID}-balance`}>
        <Text style={styles.balanceLabel}>{balance.expired ? 'Expired' : 'Items left'}</Text>
        <Text style={styles.balanceBig}>
          {balance.expired ? '—' : `${left} of ${balance.itemsTotal}`}
        </Text>
        <Text style={styles.balanceSub}>
          {balance.packName} · {balance.schoolName} · bought {balance.purchasedLabel}
          {'\n'}
          {balance.expired
            ? `Expired ${balance.expiresLabel}. Unused items are gone.`
            : `Expires ${balance.expiresLabel}`}
        </Text>

        {/*
          The bonus, in the server's three-way answer and never re-derived here: earned, still
          possible with N items in the window, or the window has closed. A parent who cannot tell
          which of the three they are in is the reason this is a sentence rather than a badge.
        */}
        {balance.bonus === undefined || balance.bonus.items === 0 ? null : (
          <Text style={styles.balanceSub} testID={`${testID}-bonus`}>
            {balance.bonus.granted
              ? `Bonus earned — ${balance.bonus.items} extra items added. They expire with the pack.`
              : balance.bonus.stillPossible
                ? `Use ${balance.bonus.itemsToGo} more by ${balance.bonus.windowEndsLabel} for ${balance.bonus.items} extra items, free.`
                : `The bonus window closed on ${balance.bonus.windowEndsLabel}.`}
          </Text>
        )}
        {balance.expired ? null : (
          <View style={styles.meter} testID={`${testID}-meter`}>
            <View style={[styles.meterFill, { width: `${pct}%` }]} />
          </View>
        )}
      </View>

      {/*
        The other packs, in spend order. Each carries its own expiry, and the sentence above them
        says what the order means — a list without it would leave a parent to infer why one is
        first.
      */}
      {otherPacks.length === 0 ? null : (
        <View style={styles.pad} testID={`${testID}-other-packs`}>
          <Text style={styles.sectionHead}>Your other packs</Text>
          <Text style={styles.noticeBody}>
            Items are spent from the pack that expires soonest, so these come after the one above.
          </Text>
          {otherPacks.map((pack) => (
            <View key={pack.packName + pack.expiresLabel} style={styles.otherRow}>
              <Text style={styles.otherName}>
                {pack.expired ? '—' : `${pack.itemsRemaining} of ${pack.itemsTotal}`} ·{' '}
                {pack.packName}
              </Text>
              <Text style={styles.otherMeta}>
                {pack.schoolName} ·{' '}
                {pack.expired ? `Expired ${pack.expiresLabel}` : `Expires ${pack.expiresLabel}`}
              </Text>
            </View>
          ))}
        </View>
      )}

      {balance.expired ? (
        <View style={styles.pad}>
          <Text style={styles.noticeTitle}>This pack has expired</Text>
          <Text style={styles.noticeBody}>
            It ran out on {balance.expiresLabel}. Unused items are gone — packs can’t be extended
            or refunded — but you can buy a new one.
          </Text>
          {/* The one place `canBuy` matters on this screen: offering to sell. */}
          {surface.canBuy && onSeeOffers !== undefined ? (
            <Button label="See the packs" onPress={onSeeOffers} variant="secondary" />
          ) : null}
        </View>
      ) : left === 0 ? (
        <View style={styles.pad}>
          <Text style={styles.noticeTitle}>You’ve used every item in this pack</Text>
          <Text style={styles.noticeBody}>
            Buy another and it stacks on top — items are spent oldest first.
          </Text>
          {surface.canBuy && onSeeOffers !== undefined ? (
            <Button label="Buy another" onPress={onSeeOffers} variant="secondary" />
          ) : null}
        </View>
      ) : (
        <View style={styles.pad}>
          <Text style={styles.sectionHead}>How these get used</Text>
          {/*
            One way now, not two. The planner is gone (`E21-73`) and with it the sentence about
            "two items with a drink" — any menu item counts as one item, so there is no shape a
            cart has to be in. Coverage is automatic (`P25`) and the cart names every covered line
            before Place order, which is what the old "nothing is spent without you tapping it"
            was really protecting.
          */}
          <Text style={styles.noticeBody}>
            Just order as usual. Your pack covers what it can — cheapest items first — and you pay
            for anything left over. The cart shows exactly what it covers before you place the
            order.
          </Text>
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
  otherRow: {
    paddingVertical: layout.listRowPaddingY,
    borderTopWidth: borderWidth.hairline,
    borderTopColor: border.subtle,
  },
  otherName: {
    fontSize: scale.label.size, lineHeight: scale.label.lineHeight, fontWeight: '700',
    color: text.primary,
  },
  otherMeta: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.secondary,
  },
});
