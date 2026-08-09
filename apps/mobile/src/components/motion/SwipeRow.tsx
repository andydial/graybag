import { type ReactNode, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useReducedMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { design } from '@graybag/shared';

import { easingFor } from '../../motion/easing';

const { bg, text, scale, space, resolveDuration } = design;


/** `M14`: past 40% of the row width the action arms. */
export const ARM_THRESHOLD = 0.4;

/**
 * `M14` — swipe to act on a list row.
 *
 * **One of exactly three files allowed to animate height.** The row follows the finger
 * (direct manipulation, §5); past 40% of its width the action arms and a selection haptic
 * fires once. Released below the threshold it snaps back over `base` with `ease.standard`.
 * Released above, it translates fully out over `base` with `ease.exit`, **then its height
 * collapses to 0** over `base` with `ease.standard` — that collapse is why this file has the
 * exemption — and the caller is expected to offer Undo via an `M13` toast.
 *
 * **Not on order history.** A swipe gesture on a paid financial record looks destructive even
 * when it is not, and the recovery cost of a mistake there is a support conversation about
 * money.
 *
 * Under reduce motion (§10) the gesture is unchanged and the row cross-fades and collapses
 * instead of translating out — a substitute, not an absence (`S26`).
 */
export function SwipeRow({
  children,
  actionLabel,
  onAction,
  onHaptic,
  testID = 'swipe-row',
}: {
  children: ReactNode;
  actionLabel: string;
  onAction: () => void;
  /** Injected so the component stays testable and Expo Haptics is the caller's dependency. */
  onHaptic?: () => void;
  testID?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const translateX = useSharedValue(0);
  const rowHeight = useSharedValue(0);
  const armed = useSharedValue(false);
  const collapsing = useSharedValue(false);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0 && (width !== size.width || height !== size.height)) {
      setSize({ width, height });
      rowHeight.value = height;
    }
  };

  const fireHaptic = () => onHaptic?.();

  const pan = Gesture.Pan()
    .onUpdate((event) => {
      // Left-swipe only. Following the finger the other way would reveal nothing and read
      // as a broken gesture.
      translateX.value = Math.min(0, event.translationX);
      const past = size.width > 0 && Math.abs(translateX.value) > size.width * ARM_THRESHOLD;
      if (past !== armed.value) {
        armed.value = past;
        // Once, on the transition — not on every frame past the threshold.
        if (past) runOnJS(fireHaptic)();
      }
    })
    .onEnd(() => {
      if (!armed.value) {
        translateX.value = withTiming(0, {
          duration: resolveDuration('base', reduceMotion),
          easing: easingFor('standard'),
        });
        return;
      }
      collapsing.value = true;
      translateX.value = withTiming(-size.width, {
        duration: resolveDuration('base', reduceMotion),
        easing: easingFor('exit'),
      });
      rowHeight.value = withTiming(
        0,
        {
          duration: resolveDuration('base', reduceMotion),
          easing: easingFor('standard'),
        },
        // The completion callback the whole of `S27` is about: `resolveDuration` returns
        // `duration.instant` rather than skipping, so under reduce motion this still fires
        // and the row is still removed. Skipping the animation would strand the list.
        (finished) => {
          if (finished) runOnJS(onAction)();
        },
      );
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: collapsing.value && reduceMotion ? 0 : 1,
  }));

  const containerStyle = useAnimatedStyle(() => ({
    height: collapsing.value ? rowHeight.value : undefined,
  }));

  return (
    <Animated.View style={[styles.container, containerStyle]} testID={testID}>
      <View style={styles.actionBackground} pointerEvents="none">
        <Text style={styles.actionLabel}>{actionLabel}</Text>
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[styles.row, rowStyle]}
          onLayout={onLayout}
          accessibilityActions={[{ name: 'delete', label: actionLabel }]}
          onAccessibilityAction={(event) => {
            // A swipe is not reachable by a switch or a screen reader, so the same action
            // exists as an accessibility action. Gesture-only affordances are the commonest
            // way a list becomes unusable without touch (`E13-08`).
            if (event.nativeEvent.actionName === 'delete') onAction();
          }}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  row: { backgroundColor: bg.surface },
  actionBackground: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: bg.surfaceDanger,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: space[4],
  },
  actionLabel: {
    color: text.danger,
    fontSize: scale.label.size,
    lineHeight: scale.label.lineHeight,
    fontWeight: scale.label.weight,
  },
});
