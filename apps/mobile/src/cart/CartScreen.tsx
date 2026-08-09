import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { cart as cartDomain, design, money } from '@graybag/shared';

import { Card, EmptyState } from '../components/Surfaces';
import { TextField } from '../components/TextField';
import { useCart } from './CartContext';

const { bg, text, border, scale, space, radius, borderWidth, touchTarget } = design;

/**
 * The cart screen (`E05-04`).
 *
 * **It fills and edits signed out.** `AR7` makes signup-to-first-order a primary v1 goal and
 * says adding a child must not be a wall in front of browsing; the same reasoning puts the
 * only gate at checkout. So the empty state points at the menu, and the word "sign in"
 * appears nowhere on this screen — asserted in the test, because this is the kind of rule
 * that gets broken by one well-meaning addition.
 *
 * **Every price on screen comes from `money.formatPaise`.** `design/type.ts` states that
 * neither the formatted output nor the symbol is ever hand-assembled in a component, and a
 * cart is where the temptation is highest.
 */
export function CartScreen() {
  const { cart, setQuantity, setComment, remove, subtotalPaise } = useCart();

  if (cart.lines.length === 0) {
    return (
      // `screen-cart` is on both branches: the route's identity is the route, not whether it
      // happens to have anything in it, and navigation asserts against it.
      <View style={styles.screen} testID="screen-cart">
        <EmptyState
          testID="cart-empty"
          title="Your cart is empty"
          body="Browse the menu and add something for lunch."
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="screen-cart">
      {cart.lines.map((line) => (
        <CartLineRow
          key={line.key}
          line={line}
          onIncrement={() => setQuantity(line.key, line.quantity + 1)}
          // The domain removes the line at zero. The screen does not add a guard of its own:
          // two places deciding what the last decrement means is how they come to disagree.
          onDecrement={() => setQuantity(line.key, line.quantity - 1)}
          onRemove={() => remove(line.key)}
          onComment={(next) => setComment(line.key, next)}
        />
      ))}

      <View style={styles.totals}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Subtotal</Text>
          <Text style={styles.totalValue} testID="cart-subtotal">
            {money.formatPaise(subtotalPaise)}
          </Text>
        </View>
        {/*
          SC2: menu prices are GST-exclusive and 5% is added at checkout. Saying so here is
          not a disclaimer — a subtotal presented as the amount payable becomes a different
          number on the next screen, and a payment flow where the total moves is one nobody
          trusts twice. The rate is not named, because E07 owns the tax rule and a second
          copy of "5%" in the client is a second thing to get wrong.
        */}
        <Text style={styles.taxNote} testID="cart-tax-note">
          GST is added at checkout.
        </Text>
      </View>
    </ScrollView>
  );
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
          <Text style={styles.unitPrice}>{money.formatPaise(line.unitPricePaise)} each</Text>
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
 * The comment field holds a **draft**, and commits it when the field loses focus.
 *
 * This is not a style preference. A line's identity includes its comment (`lineKey`), because
 * the same dish with two different requests is two different things for the kitchen to make.
 * Committing on every keystroke therefore re-identifies the line on every character: the row
 * is re-keyed, React unmounts and remounts the input, and the field loses focus after the
 * first letter. The test caught exactly that.
 *
 * So the domain keeps its content-derived identity — which is right, and is what makes the
 * merge in `setLineComment` correct — and the screen absorbs the difference between "what is
 * being typed" and "what has been asked for".
 */
function CommentField({
  line,
  onCommit,
}: {
  line: cartDomain.CartLine;
  onCommit: (next: string | null) => void;
}) {
  const [draft, setDraft] = useState(line.comment ?? '');

  return (
    <TextField
      label="Special request"
      testID={`cart-line-comment-${line.key}`}
      value={draft}
      onChangeText={setDraft}
      // Blank commits as `null`, so clearing the field genuinely clears the comment rather
      // than storing an empty string that the domain would have to normalise anyway.
      onBlur={() => onCommit(draft.trim() === '' ? null : draft)}
      hint="Optional. The kitchen sees this with the order."
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

  totals: { marginTop: space[2], gap: space[1] },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  totalLabel: { color: text.primary, fontSize: scale.body.size, fontWeight: scale.label.weight },
  totalValue: {
    color: text.primary,
    fontSize: scale.body.size,
    fontWeight: scale.label.weight,
    fontVariant: ['tabular-nums'],
  },
  taxNote: { color: text.secondary, fontSize: scale.caption.size },
});
