import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, design } from '@graybag/shared';

const { bg, text, border, space, scale, radius, borderWidth, touchTarget, clampRadius } = design;

/**
 * Which break the food is delivered at — `E05-30`, `P19`.
 *
 * ## What this replaces
 *
 * "Break time is confirmed with the kitchen." Andy, 2026-08-11: that describes a manual step
 * nobody can perform at volume. Orders arrive until midnight for the next day; no one is
 * agreeing a window per order overnight. The parent picks, from the windows the school actually
 * has, and the sentence goes.
 *
 * ## The label is the name, the time is underneath
 *
 * `break_time.label` is documented as "what the customer sees". Amity's currently hold the time
 * range itself, so a parent choosing between "10:40AM - 11:15AM" and "11:15AM - 11:40AM" is
 * reading raw data. The name goes on top and the window under it — and when the real labels
 * land with Gem's and Paragon's times, this screen improves without changing.
 *
 * ## Nothing is preselected
 *
 * Two windows an hour apart are a real choice about a child's day, and a default that happens
 * to be first in `sort_order` is a choice made for the parent by a database column. The caller
 * keeps Place order disabled until one is chosen, which is `P19`'s "required everywhere".
 */
export function BreakTimePicker({
  windows,
  selectedId,
  onSelect,
  testID = 'break-picker',
}: {
  windows: readonly api.BreakTime[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  testID?: string;
}) {
  return (
    <View style={styles.group} testID={testID}>
      <Text style={styles.heading} accessibilityRole="header">
        When should we deliver?
      </Text>
      {windows.map((window) => {
        const selected = window.id === selectedId;
        const time = api.formatBreakWindow(window.startsAt, window.endsAt);
        return (
          <Pressable
            key={window.id}
            onPress={() => onSelect(window.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            // The window is part of the label, not only visible text: a screen-reader user
            // choosing between two breaks needs the time as much as the name, and §7 says a
            // control that conveys state carries it in the label rather than in colour.
            accessibilityLabel={`${window.label}, ${time}`}
            style={[styles.option, selected && styles.optionSelected]}
            testID={`${testID}-${window.id}`}
          >
            <View style={styles.optionText}>
              <Text style={[styles.label, selected && styles.labelSelected]}>{window.label}</Text>
              <Text style={styles.time}>{time}</Text>
            </View>
            <View style={[styles.radio, selected && styles.radioSelected]}>
              {selected ? <View style={styles.radioDot} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space[2] },
  heading: {
    color: text.primary,
    fontSize: scale.label.size,
    fontWeight: scale.label.weight,
    marginBottom: space[1],
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: touchTarget.min,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    backgroundColor: bg.surface,
    borderWidth: borderWidth.hairline,
    borderColor: border.subtle,
    borderRadius: radius.lg,
    gap: space[3],
  },
  optionSelected: { borderColor: border.strong, borderWidth: borderWidth.emphasis },
  optionText: { flexShrink: 1, gap: space[1] },
  label: { color: text.primary, fontSize: scale.body.size, lineHeight: scale.body.lineHeight },
  labelSelected: { fontWeight: scale.label.weight },
  time: { color: text.secondary, fontSize: scale.caption.size },
  radio: {
    width: 22,
    height: 22,
    // `clampRadius` rather than `22 / 2`: the lint rule exists because a hand-computed corner
    // stops tracking its box the first time the box changes, and a radio that is subtly not a
    // circle is the kind of thing nobody reports and everybody notices.
    borderRadius: clampRadius(radius.full, 22),
    borderWidth: borderWidth.emphasis,
    borderColor: border.subtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: border.strong },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: clampRadius(radius.full, 10),
    backgroundColor: border.strong,
  },
});
