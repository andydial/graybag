import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { design, menu as menuDomain, money } from '@graybag/shared';

import { Button } from '../components/Button';
import { DishImage, IMAGE_SIZES } from '../components/DishImage';
import { EmptyState, ErrorState, Skeleton } from '../components/Surfaces';
import { Sheet } from '../components/Tabs';
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
  testID = 'screen-dish-detail',
}: {
  dishId: string;
  schoolId: string | null;
  /** Who this lunch is for and when. `null` until something can name a child (`E05-16`). */
  target?: OrderTarget | null;
  /**
   * REMOVED with `E05-32`. There is no longer anywhere for this screen to send someone before
   * they can add: adding always works, and who the order is for is chosen at the gate. The prop
   * existed to support "Add a child", which was the wall.
   */
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

        {/* `onNeedsTarget` is no longer passed: adding never routes away (`E05-32`). The prop
            stays on this screen for the navigator that supplies it, and for `AddChild` reached
            from elsewhere. */}
        <AddToCart dish={dish} target={target} testID={`${testID}-add`} />
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
  testID,
}: {
  dish: CachedDish;
  target: OrderTarget | null;
  testID: string;
}) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);
  const [conflict, setConflict] = useState<string[] | null>(null);

  const commit = useCallback(() => {
    // No target is not a refusal any more (`E05-32`). `R1`/`AR7`: the cart fills signed out and
    // the recipient is chosen at the gate, so a line with no recipient is an honest line —
    // not a reason to stop someone browsing from ordering.
    add({
      recipientId: target?.recipientId ?? null,
      serviceDate: target?.serviceDate ?? null,
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
    setConflict(null);
  }, [add, dish, target]);

  /**
   * `D7` / `E05-05`, and the reason this screen exists in the shape it does.
   *
   * `allergenWarning` is the domain's answer, not this component's — it is tested without a
   * renderer and it is the same function the checkout preflight uses, so the sale cannot be
   * stopped in one place and allowed in the other.
   *
   * **A declared conflict blocks.** The add does not happen on this tap; it happens on a
   * second, deliberate one inside the sheet, after the parent has been told which allergen
   * and for which dish. That is the whole point of putting the warning at add-to-cart rather
   * than at checkout, where it would arrive after the decision was made.
   *
   * **`unknown` does not block, and is not silent either.** A dish nobody has described
   * warns for every child, allergies or not (`MI7`), and blocking every undescribed dish for
   * every parent would train the sheet to be dismissed unread — which would then also
   * dismiss the one that mattered. So it stays where it is: an inline notice above, on the
   * screen, all the time, saying "not stated" rather than nothing.
   */
  const attempt = useCallback(() => {
    // With no recipient there is nobody to check against, so there is no warning to raise —
    // and manufacturing one would be the §5.21 defect in its most dangerous form. The dish's
    // own declared allergens are still shown above, by the inline notice.
    if (target === null) {
      commit();
      return;
    }
    const warning = menuDomain.allergenWarning(dish, target.allergenIds);
    if (warning.warn && warning.reason === 'match') {
      setConflict(warning.allergenIds);
      return;
    }
    commit();
  }, [commit, dish, target]);

  return (
    <View style={styles.footer} testID={testID}>
      {/*
        `E05-32`. This screen used to render "Add a child" INSTEAD OF "Add to cart" whenever
        there was no recipient — which is the wall `R1` and `AR7` exist to prevent, and it had a
        second effect nobody noticed: the only `navigate('SignIn')` in the app is the cart's
        Place order button, so a visitor who could not fill a cart could not reach sign-in at
        all. A screen with one door, behind a wall.

        Adding always works. Who it is for is chosen at the gate, which is where the spec has
        always put it (§5.6).
      */}
      <Button label="Add to cart" onPress={attempt} testID={`${testID}-button`} />
      {target === null ? (
        <Text style={styles.footerNote} testID={`${testID}-no-target`}>
          You&rsquo;ll choose who this is for when you place the order.
        </Text>
      ) : null}
      {added ? (
        // A live region rather than a toast: the confirmation has to reach someone who is
        // not watching the button, and it stays on screen rather than expiring unseen.
        <Text style={styles.footerNote} accessibilityLiveRegion="polite" testID={`${testID}-added`}>
          Added to your cart.
        </Text>
      ) : null}

      <AllergenWarningSheet
        dishName={dish.name}
        allergenIds={conflict}
        onCancel={() => setConflict(null)}
        onConfirm={commit}
        testID={`${testID}-warning`}
      />
    </View>
  );
}

/**
 * The blocking allergen warning (`D7`, `E05-05`).
 *
 * **It names the dish and the allergen, and never the child.** The parent knows who they are
 * ordering for; repeating a child's name and their allergy back at them on a screen that may
 * be held up in a school corridor adds nothing and puts regulated data (non-negotiable #4)
 * somewhere it does not need to be. Nothing here is logged for the same reason.
 *
 * **Both ways out are explicit and neither is the default.** "Not this one" is listed first
 * and dismissing the sheet is the same as choosing it, so the accident-shaped outcome — a
 * stray tap on the scrim, a back gesture — is the safe one. Adding anyway needs a deliberate
 * press on a destructive control, and it stays available: a parent may know perfectly well
 * that their child's mild lactose intolerance is fine with this, and an app that refuses
 * outright gets worked around by not recording the allergy at all.
 */
export function AllergenWarningSheet({
  dishName,
  allergenIds,
  onCancel,
  onConfirm,
  testID,
}: {
  dishName: string;
  /** The intersection from `allergenWarning`. `null` means there is nothing to warn about. */
  allergenIds: string[] | null;
  onCancel: () => void;
  onConfirm: () => void;
  testID: string;
}) {
  const names = (allergenIds ?? []).map((id) => allergenLabel({ allergenId: id, presence: 'contains' }));

  return (
    <Sheet
      visible={allergenIds !== null}
      onDismiss={onCancel}
      title="Check this one before you add it"
      testID={testID}
    >
      <Text style={styles.sheetBody} testID={`${testID}-body`}>
        {`${dishName} contains ${joinNames(names)}, which you have told us to watch for.`}
      </Text>
      <Text style={styles.sheetBody}>
        Adding it is your choice. We will still show this warning at checkout.
      </Text>
      <Button label="Not this one" onPress={onCancel} testID={`${testID}-cancel`} />
      <Button
        label="Add anyway"
        variant="destructive"
        onPress={onConfirm}
        testID={`${testID}-confirm`}
      />
    </Sheet>
  );
}

/** "milk", "milk and eggs", "milk, eggs and peanuts" — a sentence, not a comma-joined list. */
function joinNames(names: string[]): string {
  const lower = names.map((n) => n.toLowerCase());
  if (lower.length <= 1) return lower[0] ?? 'an allergen you told us about';
  return `${lower.slice(0, -1).join(', ')} and ${lower[lower.length - 1]}`;
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
  sheetBody: {
    color: text.primary,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
  },
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
