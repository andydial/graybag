import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, design, money } from '@graybag/shared';

import { EmptyState, ErrorState, Skeleton } from '../components';
import { useMealPackSurface } from './MealPackSurfaceContext';
import { useSelectedSchool } from '../session/SelectedSchoolContext';
import { track } from '../analytics/analytics';

const { bg, text, border, space, radius, borderWidth, scale, layout } = design;

export const PACKS_TEST_ID = 'screen-packs';

type PacksState = 'loading' | 'ready' | 'error' | 'not_offered';

/**
 * Buying a pack — the offers. `E21-34`, prototype `V.packs`.
 *
 * ## This screen is a fallback as often as it is a destination
 *
 * Nothing navigates here unless `canBuy` is true (`D3`). A parent who arrives anyway — a stale
 * link, a bookmark, packs switched off since they last looked — gets the prototype's designed
 * refusal rather than an empty list or a crash. Andy, 2026-08-26: *"It's a fallback for a route
 * nobody is given, not an entry point."*
 *
 * That is why `not_offered` is a first-class state here and not an `offers.length === 0` check.
 * "We do not sell packs at your school" and "the read failed" and "there are none configured" are
 * three different sentences, and collapsing them is the defect §5.21 exists to stop.
 *
 * ## Prices are GST-exclusive, like every menu price
 *
 * The card shows the pack price against what the same meals cost singly. `alacarteReferencePaise`
 * is display only and never enters a calculation — the saving is drawn from it, the charge is not.
 */
export function PacksScreen({
  onOpenOffer,
  onBackToMenu,
  onSeeBalance,
  testID = PACKS_TEST_ID,
}: {
  onOpenOffer?: ((offerId: string) => void) | undefined;
  onBackToMenu?: (() => void) | undefined;
  onSeeBalance?: (() => void) | undefined;
  testID?: string;
} = {}) {
  const surface = useMealPackSurface();
  const { schoolId, schoolName } = useSelectedSchool();
  const [state, setState] = useState<PacksState>('loading');
  const [offers, setOffers] = useState<api.MealPackOffer[]>([]);

  const load = useCallback(async () => {
    if (schoolId === null) {
      setState('not_offered');
      return;
    }
    setState('loading');
    try {
      const list = await api.fetchMealPackOffers(schoolId);
      // An empty list from a successful read still means "not offered here" to a parent — the
      // distinction that matters is that we ASKED and got nothing, versus never having asked.
      setOffers(list);
      setState(list.length === 0 ? 'not_offered' : 'ready');
    } catch {
      setState('error');
    }
  }, [schoolId]);

  useEffect(() => {
    // `canBuy` false means this is the fallback case: show the refusal without a network call,
    // because there is nothing to ask for and a spinner would promise something.
    if (surface.loading) return;
    if (!surface.canBuy) {
      setState('not_offered');
      return;
    }
    void load();
  }, [surface.loading, surface.canBuy, load]);

  if (state === 'loading') {
    return (
      <View style={styles.screen} testID={testID}>
        <View style={styles.pad}>
          <Skeleton width="100%" height={150} />
          <View style={{ height: space[2] }} />
          <Skeleton width="100%" height={150} />
        </View>
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={styles.screen} testID={testID}>
        <ErrorState
          testID={`${testID}-error`}
          title="We couldn’t load meal packs"
          body="Your existing packs are safe. Try again in a moment."
          onRetry={() => void load()}
        />
      </View>
    );
  }

  if (state === 'not_offered') {
    return (
      <View style={styles.screen} testID={testID}>
        <EmptyState
          testID={`${testID}-not-offered`}
          title="Meal packs aren’t offered at this school"
          body={`${schoolName ?? 'This school'} takes single orders only. Nothing is wrong — packs are something we agree school by school.`}
          {...(onBackToMenu === undefined
            ? {}
            : { actionLabel: 'Back to the menu', onAction: onBackToMenu })}
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} testID={testID} contentContainerStyle={styles.content}>
      <View style={styles.pad}>
        <Text style={styles.eyebrow}>Pay once, order all term</Text>
        <Text style={styles.title}>Buy meals in advance</Text>
        <Text style={styles.lead}>
          Each meal in a pack is any two items, one of them a drink, on any day a participating
          school serves.
        </Text>

        {offers.map((offer) => (
          <Pressable
            key={offer.id}
            testID={`${testID}-offer-${offer.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${offer.name}, ${money.formatPaise(offer.netPricePaise)}`}
            style={styles.card}
            onPress={() => {
              // No amount and no offer id on the event — see `D4`. Which offers are opened is
              // answerable from our own database.
              track('pack_offer_opened');
              onOpenOffer?.(offer.id);
            }}
          >
            <Text style={styles.cardName}>{offer.name}</Text>
            <Text style={styles.cardRule}>
              {offer.mealsCount} meals · {offer.itemsPerMeal} items each, one a drink · valid{' '}
              {offer.validityDays} days
            </Text>
            <View style={styles.priceRow}>
              <Text style={styles.price}>{money.formatPaise(offer.netPricePaise)}</Text>
              <Text style={styles.was}>{money.formatPaise(offer.alacarteReferencePaise)}</Text>
              <Text style={styles.save}>
                save {money.formatPaise(offer.alacarteReferencePaise - offer.netPricePaise)}
              </Text>
            </View>
          </Pressable>
        ))}

        {/*
          Shown only when they already hold meals. A parent with a balance arriving on the offers
          screen is usually looking for the balance, and the prototype puts this here for exactly
          that reason.
        */}
        {surface.hasBalance ? (
          <Pressable
            testID={`${testID}-see-balance`}
            accessibilityRole="button"
            onPress={onSeeBalance}
          >
            <Text style={styles.balanceHint}>
              You already have a pack — see what’s left.
            </Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  content: { paddingBottom: space[8] },
  pad: { paddingHorizontal: layout.gutter, paddingTop: space[4] },
  eyebrow: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.secondary,
    textTransform: 'uppercase', letterSpacing: scale.caption.tracking, marginBottom: space[1],
  },
  title: {
    fontSize: scale.h2.size, lineHeight: scale.h2.lineHeight, fontWeight: '700',
    color: text.primary, marginBottom: space[1],
  },
  lead: {
    fontSize: scale.body.size, lineHeight: scale.body.lineHeight, color: text.secondary,
    marginBottom: space[5],
  },
  card: {
    borderWidth: borderWidth.hairline, borderColor: border.subtle, borderRadius: radius.lg,
    padding: layout.cardPadding, marginBottom: space[2], backgroundColor: bg.surface,
  },
  cardName: {
    fontSize: scale.h3.size, lineHeight: scale.h3.lineHeight, fontWeight: '700',
    color: text.primary,
  },
  cardRule: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.secondary,
    marginTop: space[1],
  },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: space[2], marginTop: space[3] },
  price: {
    fontSize: scale.h2.size, lineHeight: scale.h2.lineHeight, fontWeight: '700',
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
  balanceHint: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.link,
    fontWeight: '700', marginTop: space[2],
  },
});
