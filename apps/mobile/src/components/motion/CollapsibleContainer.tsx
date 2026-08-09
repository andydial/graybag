import { type ReactNode, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useReducedMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { design } from '@graybag/shared';

import { easingFor } from '../../motion/easing';

const { resolveDuration } = design;


/**
 * `M04`'s height half — a region whose content changes size.
 *
 * **One of exactly three files allowed to animate a property other than `transform` and
 * `opacity`** (`config/eslint-design-system.js`). Everywhere else that is a build failure,
 * because animating height forces layout on every frame and the frame budget on a mid-range
 * Android is what `P11` says we actually care about. Three files, named, and a fourth is a
 * decision-log line rather than an edit.
 *
 * `E13-19` found the gate originally exempted two files when `M04` was the third height
 * animation — which would have failed the catalogue's most-used pattern. This is that file.
 *
 * The height is measured rather than guessed. `height: auto` cannot be animated, so the
 * content is laid out once, its height recorded, and the container animated to that number.
 * A hard-coded estimate is the alternative and it is wrong the first time a translation is
 * longer than English.
 */
export function CollapsibleContainer({
  expanded,
  children,
  testID,
}: {
  expanded: boolean;
  children: ReactNode;
  testID?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const measured = useSharedValue(0);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    if (next > 0 && next !== contentHeight) {
      setContentHeight(next);
      measured.value = next;
    }
  };

  const animatedStyle = useAnimatedStyle(() => {
    const target = expanded ? measured.value : 0;
    return {
      // resolveDuration returns duration.instant rather than skipping the animation (`S27`)
      // — a zero-duration transition still fires its completion callback, and a component
      // whose state advance hangs off that callback breaks silently if it never runs.
      height: withTiming(target, {
        duration: resolveDuration('base', reduceMotion),
        easing: easingFor('standard'),
      }),
      opacity: withTiming(expanded ? 1 : 0, {
        duration: resolveDuration(expanded ? 'base' : 'fast', reduceMotion),
        easing: easingFor(expanded ? 'enter' : 'exit'),
      }),
    };
  });

  return (
    <Animated.View style={[styles.clip, animatedStyle]} testID={testID}>
      {/* Measured off-flow so the parent's animated height is the only thing driving layout. */}
      <View onLayout={onLayout} style={contentHeight === null ? undefined : styles.measured}>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  measured: { position: 'absolute', left: 0, right: 0, top: 0 },
});
