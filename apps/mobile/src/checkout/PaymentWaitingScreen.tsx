import { Pressable, StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

import { BrandPanel, Lockup, Skeleton } from '../components';
import { Button } from '../components/Button';

const { bg, text, scale, space, radius, layout, touchTarget, opacity } = design;

export const PAYMENT_WAITING_TEST_ID = 'screen-payment-waiting';

/**
 * When "confirming" becomes "still confirming" — `docs/ux-spec.md` §5.12 ("after 10 s").
 *
 * Exported because the caller owns the clock. This component takes `elapsedMs` and derives a
 * state from it; it starts no timer of its own, so it renders the same way twice for the same
 * props and a test never has to advance a fake clock to see the state it is asserting about.
 */
export const PENDING_AFTER_MS = 10_000;

/**
 * The four things this screen can be, and **none of them is "confirmed"**.
 *
 * `R8` / `docs/order-lifecycle.md` §13: "payment succeeded" in the Razorpay sheet is not a
 * confirmed order. Settlement is confirmed server-side, and until it is, this screen is where
 * the user stands. `payment_pending` lives here — it is `pending` below — and it deliberately
 * has no representation on `OrderPlacedScreen`.
 */
export type PaymentWaitingState = 'confirming' | 'pending' | 'failed' | 'dismissed';

export interface PaymentWaitingScreenProps {
  /**
   * The server answered `payment_pending` (202) — capture is not yet confirmed. Forces the
   * "still confirming" copy regardless of how long we have been on screen.
   */
  pending?: boolean;
  /** How long the wait has lasted. At `PENDING_AFTER_MS` the copy changes on its own. */
  elapsedMs?: number;
  /** `§10.1` — the provider reported a failed payment. The order stays unpaid; retry is a new attempt. */
  failed?: boolean;
  /** `§10.2` — the user closed the sheet. The order stays unpaid and the cart is intact. */
  dismissed?: boolean;
  onSeeOrders?: () => void;
  onRetry?: () => void;
  testID?: string;
}

/**
 * Which of the four states the props describe.
 *
 * **Precedence: dismissed, then failed, then pending, then confirming.** A dismissal is
 * something the user did and we were told about directly, so it outranks the provider's
 * verdict — §10.2 notes the two are indistinguishable from the outside anyway, and of the two
 * sentences, "you cancelled" is the one that is never wrong in a way that matters.
 *
 * Exported so the navigator can reason about the same state this screen renders, rather than
 * re-deriving it slightly differently one file away.
 */
export function paymentWaitingState({
  pending = false,
  elapsedMs = 0,
  failed = false,
  dismissed = false,
}: Pick<
  PaymentWaitingScreenProps,
  'pending' | 'elapsedMs' | 'failed' | 'dismissed'
>): PaymentWaitingState {
  if (dismissed) return 'dismissed';
  if (failed) return 'failed';
  if (pending || elapsedMs >= PENDING_AFTER_MS) return 'pending';
  return 'confirming';
}

/**
 * Every word this screen can say, in one place, because the words *are* the screen.
 *
 * Two rules are load-bearing rather than editorial:
 *
 * **Nothing here claims anything about money we have not confirmed.** `failed` and `dismissed`
 * say the order is not placed — which we know, because settlement is what places it — and say
 * nothing about whether a charge exists, which we do not know. §10.6 (duplicate payment) and
 * §10.3 (a webhook arriving while the app was dead) are both live at this moment, so "nothing
 * has been charged" is a sentence we are not entitled to.
 *
 * **`pending` says the money is safe and the order is not lost, because both are true** — the
 * webhook is a second, independent path to settlement (§10.3) and the sweeper is the backstop
 * (§10.4). This is the one moment where reassurance is a statement of fact.
 */
const COPY: Record<PaymentWaitingState, { title: string; lead: string }> = {
  confirming: {
    title: 'Confirming your payment',
    lead: 'Hold on a moment — please don’t close the app.',
  },
  pending: {
    title: 'Still confirming',
    lead:
      'This is taking longer than usual. Your money is safe and your order is not lost — ' +
      'we’ll email you the moment it’s confirmed.',
  },
  failed: {
    title: 'That payment didn’t go through',
    lead: 'Your order isn’t placed. Your cart is still here, so you can try again whenever you’re ready.',
  },
  dismissed: {
    title: 'Payment cancelled',
    lead: 'Your order isn’t placed. Your cart is still here, so you can pick up where you left off.',
  },
};

/**
 * "Confirming your payment" — `docs/ux-spec.md` §5.12, `docs/order-lifecycle.md` §13, `E13`.
 *
 * ## The rule this screen exists to enforce
 *
 * `R8`: **a successful Razorpay sheet is not a placed order.** Settlement is confirmed on the
 * server, by capture, and the app is not entitled to an opinion about it. So the handoff back
 * from Razorpay lands *here*, never on a tick — and the `payment_pending` state (§13, HTTP 202)
 * is a variant of this screen rather than a caveat on the confirmation screen. There is no
 * "probably placed". `OrderPlacedScreen` cannot even be constructed without a settled order.
 *
 * ## Why a skeleton and never a spinner
 *
 * `S5`. A spinner reads as a stall on the connections this product targets; a skeleton shows
 * the shape of what is coming and reads as progress. It also happens to be the honest shape
 * here — two bars where the confirmation's copy will be — because the thing we are waiting for
 * really is text we do not have yet. **The skeleton is never a tick**, in `pending` least of
 * all: §13 says so in as many words.
 *
 * ## Why the fill is `surfaceBrandStrong`
 *
 * `bg.surfaceBrand` is 3.85:1 against white — legal for large text and control boundaries and
 * illegal for body copy, and `text.onBrand`'s own contract names `surfaceBrandStrong` as the
 * shallowest green white may sit on. This screen's most important sentence is 25 words long
 * (`pending`), and 25 words set at `scale.h3` to dodge a contrast rule is a wall, not a screen.
 * `surfaceBrandStrong` is the same green as `action.primaryBg`, introduces no new colour, and
 * white on it is 5.19 — so `scale.body` is legal here. Same reasoning, same token, same
 * decision as `SchoolPicker`'s welcome panel.
 */
export function PaymentWaitingScreen({
  pending = false,
  elapsedMs = 0,
  failed = false,
  dismissed = false,
  onSeeOrders,
  onRetry,
  testID = PAYMENT_WAITING_TEST_ID,
}: PaymentWaitingScreenProps) {
  const state = paymentWaitingState({ pending, elapsedMs, failed, dismissed });
  const copy = COPY[state];

  // Still waiting on the server. `failed` and `dismissed` are answers, and a skeleton under an
  // answer would imply something is still on its way.
  const waiting = state === 'confirming' || state === 'pending';

  // Never during `confirming`: the screen has just asked the user not to close the app, and a
  // button that leaves is the opposite instruction one line below it.
  const canLeave = state !== 'confirming';

  return (
    <BrandPanel radius={radius.none} style={styles.panel} testID={testID}>
      <View style={styles.body}>
        <Lockup height={space[10]} white />

        {/*
          The copy changes underneath a user who is being asked to stand still and not look
          away, so the change is announced rather than merely rendered.
        */}
        <View style={styles.copy} accessibilityLiveRegion="polite">
          <Text style={styles.title} accessibilityRole="header" testID={`${testID}-title`}>
            {copy.title}
          </Text>
          <Text style={styles.lead} testID={`${testID}-lead`}>
            {copy.lead}
          </Text>
        </View>

        {waiting ? (
          <View style={styles.skeleton} testID={`${testID}-skeleton`}>
            <Skeleton width="100%" height={space[3]} />
            <Skeleton width="62%" height={space[3]} />
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        {!canLeave || onRetry === undefined ? null : (
          <Button
            label="Try again"
            variant="secondary"
            onPress={onRetry}
            testID={`${testID}-retry`}
          />
        )}
        {!canLeave || onSeeOrders === undefined ? null : (
          <BrandAction
            label="See my orders"
            onPress={onSeeOrders}
            testID={`${testID}-see-orders`}
          />
        )}
      </View>
    </BrandPanel>
  );
}

/**
 * A lower-emphasis action **on a green screen**.
 *
 * It exists because the component library has no on-brand variant and cannot grow one from
 * here: `Button`'s primary fill is `action.primaryBg` = `primary[700]`, which is exactly the
 * fill of the screen it would be sitting on, so a primary button on this ground is an
 * invisible button. `variant="secondary"` (the light tonal chip) carries the *primary* action
 * on green — that is what `CantConnectScreen` already does — which leaves nothing for the
 * second action, and both these screens have two.
 *
 * `bg.surfaceInverse` is forest-500, the palette's "dark band" surface, and white on it is
 * 7.61. It is the same relationship the prototype draws: a deeper green block under a lighter
 * one. No new colour, no literal.
 *
 * **This belongs in `components/` the moment a third screen wants it.** It is exported from a
 * screen file only because these two screens are being built as a pair and the alternative was
 * the same thirty lines twice.
 */
export function BrandAction({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.brandAction, pressed && styles.brandActionPressed]}
    >
      <Text style={styles.brandActionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    justifyContent: 'space-between',
    padding: layout.gutter,
    // Not the `BrandPanel` default green. White body copy is illegal on `bg.surfaceBrand`
    // (3.85) and legal on this one (5.19) — see the note at the top of the file.
    backgroundColor: bg.surfaceBrandStrong,
  },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[5] },
  copy: { alignItems: 'center', gap: space[2] },
  title: {
    color: text.onBrand,
    fontSize: scale.h1.size,
    lineHeight: scale.h1.lineHeight,
    fontWeight: scale.h1.weight,
    letterSpacing: scale.h1.size * scale.h1.tracking,
    textAlign: 'center',
  },
  lead: {
    color: text.onBrand,
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
    textAlign: 'center',
  },
  // The width is the prototype's, and the two bars are the shape of the confirmation's own
  // two lines of copy — a skeleton that is roughly the right size is worse than none.
  skeleton: { width: '74%', gap: space[2] },
  actions: { gap: space[3] },

  brandAction: {
    minHeight: touchTarget.min,
    paddingHorizontal: space[5],
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: bg.surfaceInverse,
  },
  brandActionPressed: { opacity: opacity.pressed },
  brandActionLabel: {
    color: text.onBrand,
    fontSize: scale.button.size,
    lineHeight: scale.button.lineHeight,
    fontWeight: scale.button.weight,
  },
});
