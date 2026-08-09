import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useReducedMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { design } from '@graybag/shared';

import { easingFor } from '../../motion/easing';

const { bg, text, border, scale, space, radius, borderWidth, resolveDuration } = design;


/**
 * `M10` — inline error and validation.
 *
 * **One of exactly three files allowed to animate height.** Expands `0 → auto` and
 * `opacity 0 → 1` over `base` with `ease.enter`; collapses at `fast` with `ease.exit`.
 * Content below moves with the same timing, not separately — which is what animating the
 * container's height buys, and the reason this file has the exemption.
 *
 * **There is no shake, and that is a decision rather than an omission.** A shake costs
 * ~300ms, moves the thing the user is trying to read, and reads as scolding. The colour, the
 * icon and the words carry the message.
 *
 * Not for anything that must interrupt: an allergen conflict that *blocks* an add is a sheet
 * (`M07`), not this. This is for a conflict that is informational.
 */
export function InlineError({
  message,
  testID = 'inline-error',
}: {
  message: string | null;
  testID?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [height, setHeight] = useState(0);
  const measured = useSharedValue(0);
  const visible = message !== null && message !== '';

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    if (next > 0 && next !== height) {
      setHeight(next);
      measured.value = next;
    }
  };

  const animatedStyle = useAnimatedStyle(() => ({
    height: withTiming(visible ? measured.value : 0, {
      duration: resolveDuration(visible ? 'base' : 'fast', reduceMotion),
      easing: easingFor(visible ? 'enter' : 'exit'),
    }),
    opacity: withTiming(visible ? 1 : 0, {
      duration: resolveDuration(visible ? 'base' : 'fast', reduceMotion),
      easing: easingFor(visible ? 'enter' : 'exit'),
    }),
  }));

  return (
    <Animated.View style={[styles.clip, animatedStyle]} testID={testID}>
      <View onLayout={onLayout} style={styles.measured}>
        <Text
          style={styles.message}
          // Announced when it appears rather than waiting for focus to reach it. An error a
          // sighted user sees immediately and a screen-reader user finds three fields later
          // is not the same error (`E13-08`).
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  measured: { position: 'absolute', left: 0, right: 0, top: 0 },
  message: {
    // `text.danger` is `danger-700`, moved there by E13-17 because `danger-600` was chosen
    // against white and this banner — its actual home — is `danger-50`, where it measured
    // 4.4441 and failed (`S16`).
    color: text.danger,
    backgroundColor: bg.surfaceDanger,
    borderColor: border.danger,
    borderWidth: borderWidth.hairline,
    borderRadius: radius.sm,
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    marginTop: space[2],
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
    fontWeight: scale.bodySm.weight,
  },
});
