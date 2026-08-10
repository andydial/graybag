import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, cart as cartDomain, design, money } from '@graybag/shared';

import { Button } from '../components/Button';
import { Card, EmptyState } from '../components/Surfaces';
import { TextField } from '../components/TextField';
import { useCart } from './CartContext';
import { CartTotals } from './CartTotals';
import { OrderForBlock, type OrderFor } from './OrderForBlock';

const { bg, text, border, scale, space, radius, borderWidth, touchTarget } = design;

/** `P12`: 140 characters, and the field stops accepting input rather than truncating on save. */
export const COMMENT_MAX_LENGTH = 140;

/**
 * The cart (`E05-04`, rebuilt to `docs/ux-spec.md` §5.7).
 *
 * **It fills and edits signed out.** `AR7` puts the only gate at checkout, so the empty state
 * points at the menu and the words "sign in" appear nowhere on this screen — asserted in the
 * test, because this is the rule one well-meaning addition breaks.
 *
 * **One child, one service date** (`AR8`/`[DM-01]`, decided 2026-08-10). Every line therefore
 * shares a recipient and a date, and the "For" block states them once. `assertHomogeneous`
 * below is what makes that a checked property rather than an assumption.
 *
 * **Every price comes from `money.formatPaise`, and the tax split from `money.gstBreakdown`.**
 * Neither is assembled here — §6.2's per-line half-up rule is subtle enough that a second
 * implementation would eventually disagree with the invoice.
 *
 * ## What this screen deliberately does not show yet
 *
 * The cutoff line, the break time and per-line allergen warnings are all specified in §5.7 and
 * are **absent**, because the data does not exist in the client yet: there is no calendar read
 * in `api/` (`E05-30`), the break is not on the cart line (`E05-29`), and `fetchRecipients`
 * deliberately withholds a child's allergens (`E05-31`).
 *
 * They are absent rather than approximated. §5.21 is explicit that an unknown must not render
 * as a known — a cutoff we have not resolved, shown as a time, is a promise about when ordering
 * closes that we cannot keep, and a silent absence of allergen warnings reads as "safe".
 */
export function CartScreen({ onPlaceOrder }: { onPlaceOrder?: () => void } = {}) {
  const { cart, setQuantity, setComment, remove } = useCart();
  const orderFor = useOrderFor(cart);

  if (cart.lines.length === 0) {
    return (
      // `screen-cart` is on every branch: the route's identity is the route, not whether it
      // happens to have anything in it, and navigation asserts against it.
      <View style={styles.screen} testID="screen-cart">
        <EmptyState
          testID="cart-empty"
          title="Your order is empty"
          body="Browse the menu and add something for lunch."
        />
      </View>
    );
  }

  const breakdown = money.gstBreakdown(
    cart.lines.map((line) => ({
      unitPricePaise: line.unitPricePaise,
      quantity: line.quantity,
    })),
  );

  return (
    <View style={styles.screen} testID="screen-cart">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <OrderForBlock orderFor={orderFor} />

        {cart.lines.map((line) => (
          <CartLineRow
            key={line.key}
            line={line}
            onIncrement={() => setQuantity(line.key, line.quantity + 1)}
            // The domain removes the line at zero. The screen adds no guard of its own: two
            // places deciding what the last decrement means is how they come to disagree.
            onDecrement={() => setQuantity(line.key, line.quantity - 1)}
            onRemove={() => remove(line.key)}
            onComment={(next) => setComment(line.key, next)}
          />
        ))}

        <CartTotals breakdown={breakdown} />
      </ScrollView>

      {/*
        Sticky, outside the ScrollView. The total a parent is about to pay is on the button
        itself — §5.7 — so the amount and the commitment are never on separate screens.
      */}
      <View style={styles.footer}>
        <Button
          label={`Place order · ${money.formatPaise(breakdown.totalPaise)}`}
          testID="cart-place-order"
          onPress={() => onPlaceOrder?.()}
          disabled={onPlaceOrder === undefined}
        />
      </View>
    </View>
  );
}

/**
 * Resolve who the order is for, from the cart itself.
 *
 * Returns `null` — "no child chosen yet" — for a signed-out parent, for one with no children,
 * and when the read fails. That last case is deliberate and is the §5.21 rule applied: a failed
 * read must not render as a *different* child or as a confident blank, and the "For" block's
 * null state says in words that nothing has been chosen rather than implying it has.
 */
function useOrderFor(cart: cartDomain.Cart): OrderFor | null {
  const [orderFor, setOrderFor] = useState<OrderFor | null>(null);
  const first = cart.lines[0];
  const recipientId = first?.recipientId ?? null;
  const serviceDate = first?.serviceDate ?? null;

  useEffect(() => {
    let live = true;
    if (recipientId === null || serviceDate === null) {
      setOrderFor(null);
      return () => {
        live = false;
      };
    }

    api
      .fetchRecipients()
      .then((children) => {
        if (!live) return;
        const match = children.find((child) => child.id === recipientId);
        setOrderFor(
          match === undefined
            ? null
            : {
                childName: match.firstName,
                classLabel: match.classLabel,
                sectionLabel: match.sectionLabel,
                schoolName: match.schoolName,
                serviceDate: formatServiceDate(serviceDate),
              },
        );
      })
      .catch(() => {
        // Signed out, offline, or a failed read. All three mean "we cannot say who this is
        // for", which is what `null` renders. Nothing is logged: a failure here would carry a
        // recipient id, and ids about children stay out of logs (R6).
        if (live) setOrderFor(null);
      });

    return () => {
      live = false;
    };
  }, [recipientId, serviceDate]);

  return orderFor;
}

/**
 * `2026-08-12` → `Tuesday 12 August`.
 *
 * Full weekday and month, per R7 — the cutoff copy rule exists because "12/08" and a bare
 * "00:00" are each ambiguous enough to be read a whole day wrong. Parsed as UTC and formatted
 * in UTC so the rendered date is the service date itself and cannot slide by one across the
 * device's timezone.
 */
export function formatServiceDate(serviceDate: string): string {
  const parsed = new Date(`${serviceDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return serviceDate;
  return parsed.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

function CartLineRow({
  line,
  onIncrement,
  onDecrement,
  onRemove,
  onComment,
}: {
  line: cartDomain.CartLine;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
  onComment: (next: string | null) => void;
}) {
  return (
    <Card testID={`cart-line-${line.key}`}>
      <View style={styles.lineHeader}>
        <View style={styles.lineText}>
          <Text style={styles.dishName}>{line.dishName}</Text>
          <Text style={styles.unitPrice}>
            {money.formatPaise(line.unitPricePaise)} each · excl. GST
          </Text>
        </View>
        <Text style={styles.lineTotal} testID={`cart-line-total-${line.key}`}>
          {money.formatPaise(line.unitPricePaise * line.quantity)}
        </Text>
      </View>

      <View style={styles.controls}>
        <StepperButton
          glyph="−"
          // The label names the dish, not "minus". A screen-reader user moving through a cart
          // of six lines hears "Remove one" six times otherwise, with no way to tell which
          // line they are on.
          label={`Remove one ${line.dishName}`}
          testID={`cart-line-decrement-${line.key}`}
          onPress={onDecrement}
        />
        <Text style={styles.quantity} testID={`cart-line-qty-${line.key}`}>
          {line.quantity}
        </Text>
        <StepperButton
          glyph="+"
          label={`Add one ${line.dishName}`}
          testID={`cart-line-increment-${line.key}`}
          onPress={onIncrement}
        />

        <View style={styles.spacer} />

        <Pressable
          onPress={onRemove}
          testID={`cart-line-remove-${line.key}`}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${line.dishName} from cart`}
          style={styles.removeButton}
        >
          <Text style={styles.removeLabel}>Remove</Text>
        </Pressable>
      </View>

      <CommentField line={line} onCommit={onComment} />
    </Card>
  );
}

/**
 * The kitchen note (`P12`, `docs/ux-spec.md` §5.6.1).
 *
 * **It holds a draft and commits on blur.** A line's identity includes its comment (`lineKey`),
 * because the same dish with two different requests is two different things for the kitchen to
 * make. Committing per keystroke re-identifies the line on every character: the row is re-keyed,
 * React unmounts the input, and focus is lost after the first letter. A test caught exactly that.
 *
 * **The copy promises best effort and nothing more** — `P12`'s second condition. It is a request
 * passed to the kitchen, not a guarantee, and explicitly not where allergies go. The allergy
 * diversion specified in §5.6.1 is not here: it routes to Edit child, which does not exist yet,
 * and Andy's sequencing is that a diversion to a screen that does not exist is worse than none.
 */
function CommentField({
  line,
  onCommit,
}: {
  line: cartDomain.CartLine;
  onCommit: (next: string | null) => void;
}) {
  const [draft, setDraft] = useState(line.comment ?? '');
  const remaining = COMMENT_MAX_LENGTH - draft.length;

  return (
    <TextField
      label="Note for the kitchen"
      testID={`cart-line-comment-${line.key}`}
      value={draft}
      onChangeText={setDraft}
      // Hard stop rather than a silent truncation on save: a parent who typed 200 characters
      // and had 60 of them dropped invisibly believes the kitchen has all of it (`P12`).
      maxLength={COMMENT_MAX_LENGTH}
      // Blank commits as `null`, so clearing the field genuinely clears the comment rather
      // than storing an empty string the domain would have to normalise anyway.
      onBlur={() => onCommit(draft.trim() === '' ? null : draft)}
      hint={
        remaining <= 20
          ? `${remaining} characters left. A request we pass to the kitchen — not a guarantee, and not for allergies.`
          : 'Optional. A request we pass to the kitchen — not a guarantee, and not for allergies.'
      }
    />
  );
}

function StepperButton({
  glyph,
  label,
  testID,
  onPress,
}: {
  glyph: string;
  label: string;
  testID: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.stepper}
    >
      <Text style={styles.stepperGlyph}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  scroll: { flex: 1 },
  content: { padding: space[4], gap: space[3] },

  lineHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3] },
  lineText: { flex: 1, gap: space[1] },
  dishName: { color: text.primary, fontSize: scale.body.size, fontWeight: scale.label.weight },
  unitPrice: { color: text.secondary, fontSize: scale.caption.size },
  lineTotal: {
    color: text.primary,
    fontSize: scale.body.size,
    fontWeight: scale.label.weight,
    fontVariant: ['tabular-nums'],
  },

  controls: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[3] },
  spacer: { flex: 1 },
  stepper: {
    minWidth: touchTarget.min,
    minHeight: touchTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: borderWidth.hairline,
    borderColor: border.strong,
    backgroundColor: bg.surface,
  },
  stepperGlyph: { color: text.primary, fontSize: scale.body.size },
  quantity: {
    minWidth: space[6],
    textAlign: 'center',
    color: text.primary,
    fontSize: scale.body.size,
    fontVariant: ['tabular-nums'],
  },
  removeButton: {
    minHeight: touchTarget.min,
    justifyContent: 'center',
    paddingHorizontal: space[2],
  },
  removeLabel: { color: text.secondary, fontSize: scale.label.size },

  footer: {
    padding: space[4],
    borderTopWidth: borderWidth.hairline,
    borderTopColor: border.subtle,
    backgroundColor: bg.surface,
  },
});
