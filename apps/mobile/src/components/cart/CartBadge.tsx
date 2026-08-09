import { useEffect, useRef } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  useReducedMotion,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { design } from '@graybag/shared';

import { easingFor } from '../../motion/easing';

const { badge, scale, space, radius, duration, spring } = design;


/**
 * `M06` — the cart badge. **The only spring in the product** (`S4`).
 *
 * `config/eslint-api-module.js`'s sibling, `config/eslint-design-system.js`, names this exact
 * path as the one file permitted to call `withSpring`. Everywhere else it is a build failure.
 * That is `S4` as a mechanism: a spring is a fourth *kind* of motion — no fixed duration, it
 * overshoots, and it composes badly with the three curves — and it exists here because adding
 * to cart is the one action whose confirmation appears somewhere other than where the user is
 * looking. Their finger is on a dish card; the badge is on the tab bar. Everywhere else,
 * attracting the eye is a bug.
 *
 * The count cross-fades (`M04`, `fast`) at the peak of the overshoot, so the number changes
 * when the badge is largest.
 *
 * **Not on cart hydration at launch, and not on quantity changes made inside the cart screen**
 * — in both cases the user is already looking at the number, so a pop is noise. `animate` is
 * what the caller uses to say which kind of change this is; the default is not to animate,
 * because the failure mode of the opposite default is a badge that pops on every app open.
 */
export function CartBadge({
  count,
  animate = false,
  testID = 'cart-badge',
}: {
  count: number;
  animate?: boolean;
  testID?: string;
}) {
  const reduceMotion = useReducedMotion();
  const scaleValue = useSharedValue(1);
  const previous = useRef(count);

  useEffect(() => {
    const grew = count > previous.current;
    previous.current = count;

    // §10's substitute for M06 is "count changes with M04 at fast; no scale, no spring".
    // A reduce-motion user still gets the state change — a substitute is a *different*
    // animation, never the absence of one (`S26`).
    if (!animate || !grew || reduceMotion) return;

    scaleValue.value = withSequence(
      withSpring(1.28, spring.pop),
      withSpring(1, spring.pop),
    );
  }, [count, animate, reduceMotion, scaleValue]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleValue.value }],
  }));

  if (count <= 0) return null;

  return (
    <Animated.View style={[styles.badge, animatedStyle]} testID={testID}>
      <Text
        style={styles.count}
        // §2.10 and the badge token's own note: amber on white is 1.69, so the badge is a
        // shape with content in it and never an outline. A bare dot would convey meaning by
        // colour alone, so it always carries a number and an accessible label.
        accessibilityLabel={`${count} ${count === 1 ? 'item' : 'items'} in cart`}
      >
        {count > 99 ? '99+' : count}
      </Text>
    </Animated.View>
  );
}

/**
 * The count's own cross-fade (`M04` at `fast`). Separated so the spring above stays a
 * three-line effect rather than growing a second concern inside it.
 */
export function useCountCrossFade(count: number) {
  const opacity = useSharedValue(1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    opacity.value = withSequence(
      withTiming(0, { duration: duration.fast, easing: easingFor('exit') }),
      withTiming(1, { duration: duration.fast, easing: easingFor('enter') }),
    );
  }, [count, opacity, reduceMotion]);

  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}

const styles = StyleSheet.create({
  badge: {
    minWidth: space[5],
    height: space[5],
    paddingHorizontal: space[1],
    borderRadius: radius.full,
    backgroundColor: badge.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    color: badge.fg,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
    fontWeight: scale.label.weight,
  },
});

/** Re-exported so a consumer never reaches into the design package for the badge's own shape. */
export const CART_BADGE_MIN_SIZE = space[5];
