import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { design, menu as menuDomain, money } from '@graybag/shared';

import { Button } from '../components/Button';
import { DishImage, IMAGE_SIZES } from '../components/DishImage';
import { EmptyState, ErrorState, Skeleton } from '../components/Surfaces';
import { useCart } from '../cart/CartContext';
import type { OrderTarget } from '../session/OrderTargetContext';
import { useCachedMenu, type CachedDish } from './useCachedMenu';

const { bg, text, scale, space, layout, radius } = design;

/**
 * The dish detail screen (`E04-12`, `E14-14`).
 *
 * **It reads the cached menu rather than fetching a dish.** The menu is already in memory or
 * on disk by the time a row can be tapped (`E04-10`, `MC3`), so a per-dish request would add
 * a round trip on the slowest link in the product to show something the app already holds —
 * and it would fail offline on a screen that has no reason to.
 *
 * **The allergen block is the point of the screen** (`D7`). Three states reach it from
 * `allergenDisclosure`, and they stay three: `unknown` is rendered as an explicit "not
 * stated", never as blank space, because blank space reads as "nothing to worry about" to
 * everyone who has not read `MI1`. Only `declaredNone` earns a reassurance.
 */
export function DishDetailScreen({
  dishId,
  schoolId,
  target = null,
  onNeedsTarget,
  testID = 'screen-dish-detail',
}: {
  dishId: string;
  schoolId: string | null;
  /** Who this lunch is for and when. `null` until something can name a child (`E05-16`). */
  target?: OrderTarget | null;
  /** Where a parent goes when there is nobody to order for yet. */
  onNeedsTarget?: (() => void) | undefined;
  testID?: string;
}) {
  const { state, payload, stale, retry } = useCachedMenu(schoolId);

  const dish = useMemo(
    () => payload?.dishes.find((d) => d.id === dishId) ?? null,
    [payload, dishId],
  );

  if (state === 'loading') return <DishDetailSkeleton testID={`${testID}-skeleton`} />;

  if (state === 'error') {
    return (
      <View style={styles.screen} testID={testID}>
        <ErrorState
          body="We could not load this dish. Check your connection and try again."
          onRetry={retry}
        />
      </View>
    );
  }

  if (dish === null) {
    // A dish that has left the menu is not an error — the menu changed, which it is allowed
    // to do. Saying so is more use than a retry button that would fetch the same answer.
    return (
      <View style={styles.screen} testID={testID}>
        <EmptyState
          title="This dish is not on the menu"
          body="It may have been taken off since you last loaded the menu."
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID={testID}>
      {stale ? (
        <Text style={styles.stale} accessibilityLiveRegion="polite">
          Offline — showing the menu you last loaded.
        </Text>
      ) : null}

      <DishHero dish={dish} testID={`${testID}-image`} />

      <View style={styles.body}>
        <Text style={styles.name} accessibilityRole="header">
          {dish.name}
        </Text>
        {/*
          `money.formatPaise` and nothing else. The price travels as integer paise and is
          divided here, at the edge, for display only (non-negotiable #3) — and the symbol is
          never hand-assembled in a component (`design/type.ts`).
        */}
        <Text style={styles.price} testID={`${testID}-price`}>
          {money.formatPaise(dish.pricePaise)}
        </Text>

        {dish.description !== null ? (
          <Text style={styles.description} testID={`${testID}-description`}>
            {dish.description}
          </Text>
        ) : null}

        {dish.ingredientsText !== null ? (
          <View style={styles.section} testID={`${testID}-ingredients`}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              What is in it
            </Text>
            <Text style={styles.sectionBody}>{dish.ingredientsText}</Text>
          </View>
        ) : null}

        <AllergenDisclosure dish={dish} testID={`${testID}-allergens`} />

        <AddToCart
          dish={dish}
          target={target}
          onNeedsTarget={onNeedsTarget}
          testID={`${testID}-add`}
        />
      </View>
    </ScrollView>
  );
}

/**
 * Add to cart (`E05-04`, `E05-05`).
 *
 * **The line is identified by `menuItemId`, never `dishId`.** The dish is what the food is;
 * the menu item is what is being offered, at a price, on a menu — and `lineKey` is built
 * from the menu item because two menus can offer the same dish for different money. The dish
 * id travels alongside it for display and for the order snapshot, and getting these the wrong
 * way round is `E05-16` again.
 *
 * **The price snapshot is the price on screen.** `L7`: checkout compares this against the
 * price the server resolves and aborts on a mismatch, so this field is evidence rather than
 * convenience — it has to be the number the parent was looking at when they tapped.
 */
function AddToCart({
  dish,
  target,
  onNeedsTarget,
  testID,
}: {
  dish: CachedDish;
  target: OrderTarget | null;
  onNeedsTarget?: (() => void) | undefined;
  testID: string;
}) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);

  const commit = useCallback(() => {
    if (target === null) return;
    add({
      recipientId: target.recipientId,
      serviceDate: target.serviceDate,
      menuItemId: dish.menuItemId,
      dishId: dish.id,
      dishName: dish.name,
      unitPricePaise: dish.pricePaise,
      // One. The stepper lives in the cart, where the quantity can be seen next to the total
      // it produces — a counter here would be a second place to change the same number.
      quantity: 1,
      comment: null,
    });
    setAdded(true);
  }, [add, dish, target]);

  if (target === null) {
    return (
      <View style={styles.footer} testID={testID}>
        {/* Not a wall in front of the menu (`AR7`) — the dish is fully readable above this,
            and this is the last thing on the screen rather than the first. */}
        <Text style={styles.footerNote}>
          Lunch is delivered to a child at school, so we need to know who this one is for.
        </Text>
        <Button
          label="Add a child"
          variant="secondary"
          onPress={() => onNeedsTarget?.()}
          testID={`${testID}-needs-target`}
        />
      </View>
    );
  }

  return (
    <View style={styles.footer} testID={testID}>
      <Button label="Add to cart" onPress={commit} testID={`${testID}-button`} />
      {added ? (
        // A live region rather than a toast: the confirmation has to reach someone who is
        // not watching the button, and it stays on screen rather than expiring unseen.
        <Text style={styles.footerNote} accessibilityLiveRegion="polite" testID={`${testID}-added`}>
          Added to your cart.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The hero image.
 *
 * `IMAGE_SIZES.hero` is the largest rendered width the pipeline produces (`E04-07`), so it is
 * the **ceiling** rather than the number: the image is as wide as the screen, and on a tablet
 * it stops at the width that was actually rendered instead of upscaling a 640 asset into a
 * 900pt band. On every phone in the audience the minimum is the window.
 */
function DishHero({ dish, testID }: { dish: CachedDish; testID: string }) {
  const { width } = useWindowDimensions();
  return (
    <View style={styles.hero}>
      <DishImage
        uri={dish.imageUri}
        recyclingKey={dish.id}
        size={Math.min(width, IMAGE_SIZES.hero)}
        testID={testID}
      />
    </View>
  );
}

/**
 * What we are entitled to say about this dish's allergens (`D7`, `MI1`, `MI7`).
 *
 * The three states are rendered as three different things, and the wrong simplification is
 * one line long in every direction: an empty tag list is not "no allergens", and an absent
 * block is not "nothing to worry about".
 */
export function AllergenDisclosure({ dish, testID }: { dish: CachedDish; testID?: string }) {
  const disclosure = menuDomain.allergenDisclosure(dish);

  if (disclosure.state === 'declaredNone') {
    return (
      <View style={styles.section} testID={testID}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Allergens
        </Text>
        {/* The only state that earns a reassurance — `mayStateNoAllergens` is the predicate
            and this is the one place in the app allowed to render its `true`. */}
        <Text style={styles.sectionBody} testID={`${testID}-none`}>
          The kitchen has told us this dish contains none of the tracked allergens.
        </Text>
      </View>
    );
  }

  if (disclosure.state === 'unknown') {
    return (
      <View style={[styles.section, styles.notice]} testID={testID}>
        <Text style={styles.noticeTitle} accessibilityRole="header">
          Allergens not stated
        </Text>
        <Text style={styles.noticeBody} testID={`${testID}-unknown`}>
          Nobody has told us what is in this dish. That is not the same as it having none —
          ask the kitchen before ordering it for someone with an allergy.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.section, styles.notice]} testID={testID}>
      <Text style={styles.noticeTitle} accessibilityRole="header">
        Contains allergens
      </Text>
      {dish.allergens.map((allergen) => (
        <Text
          key={allergen.allergenId}
          style={styles.noticeBody}
          testID={`${testID}-${allergen.allergenId}`}
        >
          {allergenLabel(allergen)}
        </Text>
      ))}
    </View>
  );
}

/**
 * An allergen as a line a parent can read.
 *
 * `may_contain` is spelled out rather than folded into "contains". The importer only ever
 * emits `contains` today, but the enum exists because a kitchen will need the distinction —
 * and when it does, "may contain peanuts" has to stop the sale as loudly as "contains".
 *
 * The id is humanised here because the cached menu carries ids and not display names
 * (`E04-13`). It is a stopgap and it is honest for the ids we have (`tree_nuts` → "Tree
 * nuts"); the reference table's `display_name` is the real answer.
 */
export function allergenLabel(allergen: CachedDish['allergens'][number]): string {
  const name = allergen.allergenId.replace(/_/g, ' ');
  const humanised = name.charAt(0).toUpperCase() + name.slice(1);
  return allergen.presence === 'may_contain' ? `${humanised} — may contain` : humanised;
}

/** `S5`: the shape of what is coming, never a spinner. */
export function DishDetailSkeleton({ testID }: { testID?: string }) {
  return (
    <View style={styles.screen} testID={testID}>
      <Skeleton width="100%" height={IMAGE_SIZES.card} />
      <View style={styles.body}>
        <Skeleton width="60%" height={scale.h2.lineHeight} />
        <Skeleton width="25%" height={scale.bodyStrong.lineHeight} />
        <Skeleton width="90%" height={scale.body.lineHeight} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  content: { paddingBottom: space[6] },
  hero: { alignItems: 'center', overflow: 'hidden', backgroundColor: bg.surfaceMuted },
  body: { padding: layout.gutter, gap: space[3] },
  stale: {
    color: text.secondary,
    backgroundColor: bg.surfaceMuted,
    paddingHorizontal: layout.gutter,
    paddingVertical: space[2],
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
  },
  name: {
    color: text.primary,
    fontSize: scale.h2.size,
    lineHeight: scale.h2.lineHeight,
    fontWeight: scale.h2.weight,
  },
  // `text.price` is `primary-700`, legal on `bg.canvas` and `bg.surface` and NOT on the
  // tinted fills (`E13-13`). This screen is on the canvas.
  price: {
    color: text.price,
    fontSize: scale.h3.size,
    lineHeight: scale.h3.lineHeight,
    fontWeight: scale.h3.weight,
    fontVariant: ['tabular-nums'],
  },
  description: {
    color: text.secondary,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
  },
  section: { gap: space[1] },
  footer: { gap: space[2], marginTop: space[2] },
  footerNote: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
  sectionTitle: {
    color: text.primary,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  sectionBody: {
    color: text.secondary,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
  },
  // `bg.surfaceWarning` is the token whose stated role is "warning banner / allergen notice",
  // and `text.warning` is the only ink asserted legal on it (`E13-17`).
  notice: {
    backgroundColor: bg.surfaceWarning,
    padding: space[3],
    borderRadius: radius.md,
  },
  noticeTitle: {
    color: text.warning,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  noticeBody: {
    color: text.warning,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
  },
});
