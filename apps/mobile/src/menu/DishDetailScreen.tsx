import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { design, menu as menuDomain, money } from '@graybag/shared';

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FoodTypeMark,
  PatternTile,
  Sheet,
  Skeleton,
} from '../components';
import { DishImage, IMAGE_SIZES } from '../components/DishImage';
import { useCart } from '../cart/CartContext';
// The one formatter for a service date (`R7`: full weekday and month, parsed and formatted in
// UTC so the rendered day cannot slide). Imported rather than copied — two date formatters is
// how "Tuesday 12 August" and "12/08" end up on two screens describing the same lunch.
import { formatServiceDate } from '../cart/CartScreen';
import type { OrderTarget } from '../session/OrderTargetContext';
import { useCachedMenu, type CachedDish } from './useCachedMenu';

const { bg, text, border, borderWidth, scale, space, layout, radius } = design;

/**
 * Who the lunch is for, as this screen has to **say** it.
 *
 * `OrderTarget` carries the ids the domain needs. A screen has to name a person and know
 * whether it is allowed to check allergens at all, and neither of those is on `OrderTarget`
 * yet — see the note at `recipientName`. They are optional here so the navigator (which
 * supplies a plain `OrderTarget`) keeps typechecking, and so that the honest rendering when
 * they are missing is the one the spec asks for rather than a guess.
 */
export interface DishDetailTarget extends OrderTarget {
  /**
   * How to name them on screen.
   *
   * `null` means **the account holder** — "For you". A string is anybody else — "For Aarav".
   * `undefined` means we hold an id and no name, which is the state the app is in until
   * `OrderTargetContext` carries a display name; it renders neutrally rather than guessing
   * that the account holder is a parent.
   */
  recipientName?: string | null;
  /** "Class 5-A". */
  className?: string | null;
  schoolName?: string | null;
  /** "Morning break · 10:40". */
  breakLabel?: string | null;
  /**
   * The separate DPDP purpose for health data about a minor (`api/recipients.ts`).
   *
   * **`false` means we may not check**, so the allergen block says so plainly instead of
   * rendering the silence that reads as reassurance. `undefined` is treated as given, which
   * is what holding `allergenIds` at all implies today.
   */
  allergenConsent?: boolean;
}

/** The ordering window for the selected day. Absent means "open", which is the ordinary case. */
export interface DishOrderingWindow {
  closed: boolean;
  /** The next day this dish can be ordered for, when one is known. */
  nextOpenDate?: menuDomain.ServiceDate | null;
}

/**
 * The dish detail screen (`E04-12`, `E14-14`, `docs/ux-spec.md` §5.6).
 *
 * **It reads the cached menu rather than fetching a dish.** The menu is already in memory or
 * on disk by the time a row can be tapped (`E04-10`, `MC3`), so a per-dish request would add
 * a round trip on the slowest link in the product to show something the app already holds —
 * and it would fail offline on a screen that has no reason to.
 *
 * **The allergen block is the point of the screen** (`D7`, §5.6). Four renderings, and the
 * difference between them is a safety property rather than a wording preference:
 *
 * 1. it clashes with the selected recipient's declared allergens — amber, names them and the
 *    allergen, and the add takes a second deliberate tap in its own surface;
 * 2. **we cannot check** — no recipient, or no allergen consent — neutral and explicit, plus
 *    the kitchen's own declaration if there is one. Never silence, never reassurance;
 * 3. the kitchen declared none — the one state that earns a reassurance;
 * 4. the kitchen declared nothing either way — "Allergen information not provided", which is
 *    **not** the same fact as (3) and is never rendered as if it were.
 *
 * **With no recipient, nothing on this screen may name a person or claim a clash.** A warning
 * is a claim about data we hold; manufacturing one from data we do not hold is the same class
 * of failure as swallowing a failed allergen fetch into an empty list (§5.21). The prototype
 * shipped that defect once.
 */
export function DishDetailScreen({
  dishId,
  schoolId,
  target = null,
  ordering = null,
  onChangeTarget,
  onBackToMenu,
  testID = 'screen-dish-detail',
}: {
  dishId: string;
  schoolId: string | null;
  /** Who this lunch is for and when. `null` until something can name a recipient (`E05-16`). */
  target?: DishDetailTarget | null;
  /** `null` — the default — is an open ordering window. */
  ordering?: DishOrderingWindow | null;
  /** Opens the recipient / date switcher. The "Change" control is hidden without it. */
  onChangeTarget?: () => void;
  /** Offered when the dish has left the menu. Without it the state still explains itself. */
  onBackToMenu?: () => void;
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

  const categoryLabel = useMemo(() => {
    if (dish === null) return null;
    return payload?.categories.find((c) => c.id === dish.categoryId)?.label ?? null;
  }, [payload, dish]);

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
    // to do. Saying so is more use than a retry button that would fetch the same answer, and
    // the add is gone with it rather than disabled, because there is nothing to add.
    return (
      <View style={styles.screen} testID={testID}>
        <EmptyState
          title="This dish is not on the menu"
          body="It may have been taken off since you last loaded the menu."
          actionLabel={onBackToMenu === undefined ? undefined : 'Back to the menu'}
          onAction={onBackToMenu}
        />
      </View>
    );
  }

  const closed = ordering?.closed === true;

  return (
    <View style={styles.screen} testID={testID}>
      <ScrollView contentContainerStyle={styles.content}>
        {stale ? (
          <Text style={styles.stale} accessibilityLiveRegion="polite" testID={`${testID}-stale`}>
            Offline — showing the menu you last loaded. We&rsquo;ll reconfirm the price when you
            check out.
          </Text>
        ) : null}

        <DishHero dish={dish} testID={`${testID}-image`} />

        <View style={styles.body}>
          {/* Name and price on one row: the two things being decided between, side by side. */}
          <View style={styles.headline}>
            <Text style={styles.name} accessibilityRole="header">
              {dish.name}
            </Text>
            {/*
              `money.formatPaise` and nothing else. The price travels as integer paise and is
              divided here, at the edge, for display only (non-negotiable #3) — and the symbol
              is never hand-assembled in a component (`design/type.ts`).
            */}
            <Text style={styles.price} testID={`${testID}-price`}>
              {money.formatPaise(dish.pricePaise)}
            </Text>
          </View>

          <FoodTypeLine dish={dish} categoryLabel={categoryLabel} testID={`${testID}-food-type`} />

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

          <AllergenBlock dish={dish} target={target} testID={`${testID}-allergens`} />

          <ForBlock target={target} onChange={onChangeTarget} testID={`${testID}-for`} />

          {closed ? (
            <View style={styles.neutralNotice} testID={`${testID}-cutoff`}>
              <Text style={styles.noticeTitle} accessibilityRole="header">
                Ordering for this day has closed
              </Text>
              <Text style={styles.noticeBody}>
                {ordering?.nextOpenDate == null
                  ? 'Pick another day to add this.'
                  : `The next day you can order for is ${formatServiceDate(ordering.nextOpenDate)}.`}
              </Text>
            </View>
          ) : null}

          {/* `SC2`: menu prices are GST-exclusive and the 5% is added at checkout. Saying it
              here is what stops the sticky button reading as the amount that will be charged. */}
          <Text style={styles.fineprint} testID={`${testID}-tax-note`}>
            Price excludes GST. 5% is added at checkout.
          </Text>
        </View>
      </ScrollView>

      {/* `onNeedsTarget` is no longer passed: adding never routes away (`E05-32`). */}
      <AddToCart dish={dish} target={target} closed={closed} testID={`${testID}-add`} />
    </View>
  );
}

/**
 * Add to cart (`E05-04`, `E05-05`) — the sticky footer.
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
 *
 * **The label stays neutral even when the dish clashes** — "Add to cart · ₹95", never "Add
 * anyway" (§5.6). "Anyway" is one tap doing a confirmation's job, and it is a reprimand: a
 * parent may have entirely good reasons — a mild intolerance, a dish the kitchen prepares
 * differently for them. The product's job is to make sure they know, not to disapprove.
 */
function AddToCart({
  dish,
  target,
  closed,
  testID,
}: {
  dish: CachedDish;
  target: DishDetailTarget | null;
  closed: boolean;
  testID: string;
}) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);
  const [conflict, setConflict] = useState<string[] | null>(null);

  const commit = useCallback(() => {
    // No target is not a refusal (`E05-32`). `R1`/`AR7`: the cart fills signed out and the
    // recipient is chosen at the gate, so a line with no recipient is an honest line — not a
    // reason to stop someone browsing from ordering.
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
   * second, deliberate one inside the confirmation, after the parent has been told which
   * allergen, for which dish, and for whom.
   *
   * **`unknown` does not block, and is not silent either.** A dish nobody has described
   * warns for every recipient, allergies or not (`MI7`), and blocking every undescribed dish
   * for everyone would train the confirmation to be dismissed unread — which would then also
   * dismiss the one that mattered. So it stays where it is: an inline block on the screen,
   * all the time, saying "not provided" rather than nothing.
   */
  const attempt = useCallback(() => {
    const view = dishAllergenView(dish, target);
    if (view.kind === 'clash') {
      setConflict(view.allergenIds);
      return;
    }
    commit();
  }, [commit, dish, target]);

  const voice = recipientVoice(target);

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
      <Button
        label={closed ? 'Ordering has closed' : `Add to cart · ${money.formatPaise(dish.pricePaise)}`}
        onPress={attempt}
        disabled={closed}
        testID={`${testID}-button`}
      />
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

      <AllergenConfirmation
        dishName={dish.name}
        allergenIds={conflict}
        voice={voice}
        onCancel={() => setConflict(null)}
        onConfirm={commit}
        testID={`${testID}-warning`}
      />
    </View>
  );
}

/**
 * The second, deliberate tap (§5.6, `D7`, `E05-05`).
 *
 * **A confirmation is a surface, not a word in a button label.** It names the dish, the
 * allergen and the person — "Mix Veg Poha contains Peanuts. Aarav is allergic to Peanuts. Add
 * it anyway?" — because a decision about someone's allergy is worth the second tap and worth
 * being told what it is about. The recipient's *name* appears; their **id and their allergy
 * list never do**, and nothing here is logged (non-negotiable #4).
 *
 * **Dismissing is the safe outcome.** The scrim, the back gesture and "Don't add it" all do
 * the same thing, so the accident-shaped exit is the one that adds nothing. Adding needs a
 * deliberate press on a control that says whose lunch it is going into.
 */
export function AllergenConfirmation({
  dishName,
  allergenIds,
  voice,
  onCancel,
  onConfirm,
  testID,
}: {
  dishName: string;
  /** The intersection from `allergenWarning`. `null` means there is nothing to confirm. */
  allergenIds: string[] | null;
  voice: RecipientVoice;
  onCancel: () => void;
  onConfirm: () => void;
  testID: string;
}) {
  const names = joinLabels((allergenIds ?? []).map((id) => allergenLabel({ allergenId: id, presence: 'contains' })));

  return (
    <Sheet
      visible={allergenIds !== null}
      onDismiss={onCancel}
      title={`${dishName} contains ${names}`}
      testID={testID}
    >
      <Text style={styles.sheetBody} testID={`${testID}-body`}>
        {`${dishName} contains ${names}. ${voice.subject} ${voice.verb} allergic to ${names}. Add it to this order anyway?`}
      </Text>
      <Text style={styles.sheetNote}>We will show this warning again at checkout.</Text>
      <Button label={voice.confirmLabel} onPress={onConfirm} testID={`${testID}-confirm`} />
      <Button
        label="Don't add it"
        variant="secondary"
        onPress={onCancel}
        testID={`${testID}-cancel`}
      />
    </Sheet>
  );
}

/**
 * What this screen is entitled to say about this dish's allergens, as one value.
 *
 * Exported and pure so the rule can be asserted without a renderer — and so the ordering of
 * the branches, which is the whole safety property, is readable in one place:
 *
 * - a clash is only reachable when there **is** a recipient and consent to check them;
 * - "cannot check" is second, so an unchecked dish can never fall through to a reassurance;
 * - `declaredNone` and `declared` come from `allergenDisclosure`, which is the authority on
 *   the difference between "the kitchen said none" and "nobody said" (`MI1`, `0006`);
 * - "not provided" is last and is its own rendering, never an absence.
 *
 * `allergenWarning` decides the clash. It is the same function the checkout preflight uses,
 * so the sale cannot be stopped in one place and allowed in the other — and a second copy of
 * the rule in a component is exactly how that happens.
 */
export type DishAllergenView =
  | { kind: 'clash'; allergenIds: string[] }
  | { kind: 'cannotCheck'; why: 'no-recipient' | 'no-consent'; disclosure: menuDomain.AllergenDisclosure }
  | { kind: 'declaredNone' }
  | { kind: 'declared'; allergenIds: string[] }
  | { kind: 'notProvided' };

export function dishAllergenView(
  dish: Pick<CachedDish, 'allergens' | 'allergensDeclaredNone'>,
  target: DishDetailTarget | null,
): DishAllergenView {
  const disclosure = menuDomain.allergenDisclosure(dish);

  // With no recipient there is nobody to check against, and with no consent there is nothing
  // to check with. Either way the only honest thing on screen is "we cannot check" — never a
  // warning naming a person we do not have, and never the silence that reads as safety.
  if (target === null) return { kind: 'cannotCheck', why: 'no-recipient', disclosure };
  if (target.allergenConsent === false) {
    return { kind: 'cannotCheck', why: 'no-consent', disclosure };
  }

  const warning = menuDomain.allergenWarning(dish, target.allergenIds);
  if (warning.warn && warning.reason === 'match') {
    return { kind: 'clash', allergenIds: warning.allergenIds };
  }

  if (disclosure.state === 'declaredNone') return { kind: 'declaredNone' };
  if (disclosure.state === 'declared') return { kind: 'declared', allergenIds: disclosure.allergenIds };
  return { kind: 'notProvided' };
}

/** The four renderings. Each is a different claim about what we know. */
export function AllergenBlock({
  dish,
  target,
  testID,
}: {
  dish: CachedDish;
  target: DishDetailTarget | null;
  testID?: string;
}) {
  const view = dishAllergenView(dish, target);
  const voice = recipientVoice(target);

  if (view.kind === 'clash') {
    const names = joinLabels(
      view.allergenIds.map((id) => allergenLabel({ allergenId: id, presence: 'contains' })),
    );
    return (
      <View style={styles.warningNotice} testID={testID}>
        <Text style={styles.warningTitle} accessibilityRole="header">
          Contains {names}
        </Text>
        <Text style={styles.warningBody} testID={`${testID}-clash`}>
          {`${voice.subject} ${voice.verb} allergic to ${names}. You can still order it — we'll ask you to confirm first.`}
        </Text>
      </View>
    );
  }

  if (view.kind === 'cannotCheck') {
    return (
      <View style={styles.neutralNotice} testID={testID}>
        <Text style={styles.noticeTitle} accessibilityRole="header">
          {view.why === 'no-recipient'
            ? "We can't check this for anyone yet"
            : `We can't check this against ${voice.possessive} allergies`}
        </Text>
        <Text style={styles.noticeBody} testID={`${testID}-cannot-check`}>
          {view.why === 'no-recipient'
            ? "Choose who this is for and we'll warn you about anything they're allergic to."
            : "You haven't shared allergy details, so we can't warn you about ingredients."}
        </Text>
        {/* The kitchen's own declaration, if there is one. It is a fact about the dish and it
            does not depend on knowing anything about the person eating it. */}
        <Text style={styles.noticeBody} testID={`${testID}-declaration`}>
          {kitchenDeclaration(view.disclosure)}
        </Text>
      </View>
    );
  }

  if (view.kind === 'declaredNone') {
    return (
      <View style={styles.accentNotice} testID={testID}>
        <Text style={styles.accentTitle} accessibilityRole="header">
          No allergens
        </Text>
        {/* The only state that earns a reassurance — `mayStateNoAllergens` is the predicate
            and this is the one place in the app allowed to render its `true`. */}
        <Text style={styles.accentBody} testID={`${testID}-none`}>
          The kitchen has declared this dish free of the allergens we track.
        </Text>
      </View>
    );
  }

  if (view.kind === 'declared') {
    const names = joinLabels(
      view.allergenIds.map((id) => allergenLabel({ allergenId: id, presence: 'contains' })),
    );
    return (
      <View style={styles.accentNotice} testID={testID}>
        <Text style={styles.accentTitle} accessibilityRole="header">
          Contains {names}
        </Text>
        <Text style={styles.accentBody} testID={`${testID}-declared`}>
          {voice.name === undefined
            ? 'Declared by the kitchen. None of these is one they told us to watch for.'
            : `Declared by the kitchen. None of these is one of ${voice.possessive}.`}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.neutralNotice} testID={testID}>
      <Text style={styles.noticeTitle} accessibilityRole="header">
        Allergen information not provided
      </Text>
      <Text style={styles.noticeBody} testID={`${testID}-not-provided`}>
        The kitchen hasn&rsquo;t told us about this dish either way. That is not the same as
        &ldquo;no allergens&rdquo; — ask before ordering it for someone with an allergy.
      </Text>
    </View>
  );
}

/** The kitchen's declaration as one sentence, including when there isn't one. */
function kitchenDeclaration(disclosure: menuDomain.AllergenDisclosure): string {
  if (disclosure.state === 'declaredNone') {
    return 'The kitchen has declared this dish free of the allergens we track.';
  }
  if (disclosure.state === 'declared') {
    const names = joinLabels(
      disclosure.allergenIds.map((id) => allergenLabel({ allergenId: id, presence: 'contains' })),
    );
    return `The kitchen declares this dish contains ${names}.`;
  }
  return 'The kitchen has not told us what is in this dish either way.';
}

/**
 * Whose lunch this is and when it is handed over (§5.6).
 *
 * **Not optional furniture.** It appears here as well as in the cart because a parent must
 * never be one tap from paying without seeing whose lunch this is and on which day. Signed
 * out it says exactly that rather than showing a name that does not exist.
 */
export function ForBlock({
  target,
  onChange,
  testID,
}: {
  target: DishDetailTarget | null;
  onChange?: () => void;
  testID?: string;
}) {
  const voice = recipientVoice(target);
  const who = target === null ? [] : [target.className, target.schoolName].filter(isText);
  const when =
    target === null
      ? []
      : [target.breakLabel, formatServiceDate(target.serviceDate)].filter(isText);

  return (
    <Card testID={testID}>
      <View style={styles.forRow}>
        <View style={styles.forText}>
          <Text style={styles.forTitle} accessibilityRole="header">
            {voice.forLabel}
          </Text>
          {target === null ? (
            <Text style={styles.forMeta} testID={`${testID}-none`}>
              Adding to your cart works without this.
            </Text>
          ) : null}
          {who.length > 0 ? <Text style={styles.forMeta}>{who.join(' · ')}</Text> : null}
          {when.length > 0 ? (
            <Text style={styles.forMeta} testID={`${testID}-when`}>
              {when.join(' · ')}
            </Text>
          ) : null}
        </View>
        {onChange === undefined ? null : (
          <View style={styles.forAction}>
            <Button
              label={target === null ? 'Choose' : 'Change'}
              variant="secondary"
              onPress={onChange}
              testID={`${testID}-change`}
            />
          </View>
        )}
      </View>
    </Card>
  );
}

/**
 * How to talk about the recipient, in one place.
 *
 * **Never assume a parent.** The account holder may be ordering for themselves, so "For you"
 * and "You are allergic to…" are as ordinary as "For Aarav". And when we hold an id but no
 * name — the state the app is in until `OrderTargetContext` carries one — the copy stays
 * neutral rather than inventing a relationship.
 */
export interface RecipientVoice {
  /** `null` = the account holder. `undefined` = we have no name for them. */
  name: string | null | undefined;
  /** Sentence subject: "Aarav", "You", "The person you've chosen". */
  subject: string;
  verb: 'is' | 'are';
  /** "Aarav's", "yours", "theirs". */
  possessive: string;
  /** The heading on the For block: "For Aarav", "For you", "Nobody chosen yet". */
  forLabel: string;
  /** The confirming control: "Yes, add it for Aarav". */
  confirmLabel: string;
}

export function recipientVoice(target: DishDetailTarget | null): RecipientVoice {
  if (target === null) {
    return {
      name: undefined,
      subject: 'Nobody',
      verb: 'is',
      possessive: 'theirs',
      forLabel: 'Nobody chosen yet',
      confirmLabel: 'Yes, add it',
    };
  }
  const name = target.recipientName;
  if (name === null) {
    return {
      name: null,
      subject: 'You',
      verb: 'are',
      possessive: 'yours',
      forLabel: 'For you',
      confirmLabel: 'Yes, add it',
    };
  }
  if (name === undefined) {
    return {
      name: undefined,
      subject: "The person you've chosen",
      verb: 'is',
      possessive: 'theirs',
      forLabel: "For the person you've chosen",
      confirmLabel: 'Yes, add it',
    };
  }
  return {
    name,
    subject: name,
    verb: 'is',
    possessive: `${name}'s`,
    forLabel: `For ${name}`,
    confirmLabel: `Yes, add it for ${name}`,
  };
}

/**
 * Veg / egg / non-veg and the category, on one line under the name.
 *
 * **The mark is the first thing an Indian parent looks at on a menu**, so it leads. The label
 * beside it is not decoration: the mark is pure colour, and colour alone is never allowed to
 * carry meaning (§2.10 of the token document).
 *
 * `foodType` is read defensively because `CachedDish` does not carry it yet — see the report
 * note. When the cache starts carrying it this line lights up with no further change; until
 * then the row degrades to the category alone rather than to a mark with no meaning.
 */
export function FoodTypeLine({
  dish,
  categoryLabel,
  testID,
}: {
  dish: CachedDish;
  categoryLabel: string | null;
  testID?: string;
}) {
  const foodType = readFoodType(dish);
  const parts = [foodTypeLabel(foodType), categoryLabel].filter(isText);
  if (parts.length === 0) return null;

  return (
    <View style={styles.typeRow} testID={testID}>
      <FoodTypeMark foodType={foodType} />
      <Text style={styles.typeLabel}>{parts.join(' · ')}</Text>
    </View>
  );
}

/** `null` for anything the cache has not (yet) told us. Never guessed — `DM-17`, `MI2`. */
function readFoodType(dish: CachedDish): menuDomain.FoodType | null {
  const value = (dish as CachedDish & { foodType?: unknown }).foodType;
  return value === 'veg' || value === 'egg' || value === 'non_veg' ? value : null;
}

function foodTypeLabel(foodType: menuDomain.FoodType | null): string | null {
  if (foodType === 'veg') return 'Pure vegetarian';
  if (foodType === 'egg') return 'Contains egg';
  if (foodType === 'non_veg') return 'Non-vegetarian';
  return null;
}

/** "Milk", "Milk and eggs", "Milk, eggs and peanuts" — a sentence, not a comma-joined list. */
function joinLabels(names: string[]): string {
  if (names.length === 0) return 'an allergen you told us about';
  if (names.length === 1) return names[0] as string;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function isText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * The hero image.
 *
 * **A dish with no photograph is a pattern tile, never a grey box** (`E21`). That is not a
 * rare state: every dish in staging has no image until the mirrored catalogue is uploaded,
 * and three of the real photos are a permanent 403 at source.
 *
 * `IMAGE_SIZES.hero` is the largest rendered width the pipeline produces (`E04-07`), so it is
 * the **ceiling** rather than the number: the image is as wide as the screen, and on a tablet
 * it stops at the width that was actually rendered instead of upscaling a 640 asset into a
 * 900pt band. The frame is a 16:10 band that centre-crops the square `DishImage` returns —
 * see the report note; a `DishImage` that took a height would not need the crop.
 */
function DishHero({ dish, testID }: { dish: CachedDish; testID: string }) {
  const { width } = useWindowDimensions();
  return (
    <View style={styles.hero}>
      {dish.imageUri === null ? (
        <PatternTile testID={testID} />
      ) : (
        <DishImage
          uri={dish.imageUri}
          recyclingKey={dish.id}
          size={Math.min(width, IMAGE_SIZES.hero)}
          testID={testID}
        />
      )}
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
      <View style={styles.hero}>
        <Skeleton width="100%" height="100%" />
      </View>
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
  content: { paddingBottom: layout.stickyCtaGap },
  /**
   * A 16:10 band, inset and rounded, as the prototype draws it. `overflow: 'hidden'` plus
   * centring is what turns the square `DishImage` into a centre crop rather than a photo with
   * its bottom third missing.
   */
  hero: {
    aspectRatio: 16 / 10,
    marginHorizontal: layout.gutter,
    marginTop: layout.gutter,
    borderRadius: radius.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: bg.surfaceMuted,
  },
  stale: {
    color: text.secondary,
    backgroundColor: bg.surfaceMuted,
    paddingHorizontal: layout.gutter,
    paddingVertical: space[2],
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
  },
  body: { padding: layout.gutter, gap: layout.blockGap },

  headline: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  name: {
    flex: 1,
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

  typeRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  typeLabel: {
    flex: 1,
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },

  description: {
    color: text.secondary,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
  },
  section: { gap: space[1] },
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
  warningNotice: {
    backgroundColor: bg.surfaceWarning,
    padding: layout.cardPadding,
    borderRadius: radius.lg,
    gap: space[1],
  },
  warningTitle: {
    color: text.warning,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  warningBody: {
    color: text.warning,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
  /**
   * "We cannot check" and "not provided" are the same *kind* of statement — an absence of
   * knowledge — so they look the same and neither looks like a warning or a reassurance.
   * `border.default` is decorative weight, which is all this is: the block is not a control.
   */
  neutralNotice: {
    backgroundColor: bg.surfaceMuted,
    borderWidth: borderWidth.hairline,
    borderColor: border.default,
    padding: layout.cardPadding,
    borderRadius: radius.lg,
    gap: space[1],
  },
  noticeTitle: {
    color: text.primary,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  noticeBody: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
  // The lime card. `text.onAccent` is the substitute the contrast list requires there —
  // `text.price`/`text.link` are 4.09 on this fill and fail.
  accentNotice: {
    backgroundColor: bg.surfaceAccent,
    padding: layout.cardPadding,
    borderRadius: radius.lg,
    gap: space[1],
  },
  accentTitle: {
    color: text.onAccent,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  accentBody: {
    color: text.primary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },

  forRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  forText: { flex: 1, gap: space[1] },
  forAction: { minWidth: space[16] },
  forTitle: {
    color: text.primary,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  forMeta: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },

  fineprint: {
    color: text.tertiary,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
  },

  // Sticky: the price and the decision stay reachable however long the description is. The
  // safe-area inset below it is paid by the screen frame (`STACK_SCREEN_EDGES`).
  footer: {
    gap: space[2],
    padding: layout.gutter,
    backgroundColor: bg.surface,
    borderTopWidth: borderWidth.hairline,
    borderTopColor: border.subtle,
  },
  footerNote: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
  sheetBody: {
    color: text.primary,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
  },
  sheetNote: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
});
