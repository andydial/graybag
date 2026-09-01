import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { design, ordering } from '@graybag/shared';

const { bg, text, border, space, radius, borderWidth, scale, touchTarget } = design;

export const DAY_PICKER_TEST_ID = 'cart-day-picker';

/**
 * Choosing the day the lunch is delivered — `E05-52`.
 *
 * ## Why this exists, in one paragraph
 *
 * The cart had **no date control at all**. It stated a day as a fact — "Wednesday 2 September" —
 * and the only Change affordance on the screen changed *who* the order was for. Andy, 2026-09-01:
 * *"A parent cannot choose the day, full stop."*
 *
 * That is the reason nine checkouts were refused on production and none succeeded. The date was
 * pinned; the pinned date was closed, because the cutoff for tomorrow was midnight at the start
 * of today; the refusal blamed a dish (`E05-55`); and there was no control that could have fixed
 * it. One parent pressed Place order **five times in 65 seconds**. That is not impatience — it is
 * someone with no other option.
 *
 * ## Only days the server will accept
 *
 * Every row here comes from `ordering.offerableDays`, which keeps only `isOrderable` days. A
 * closed day is not shown greyed out and a Sunday is not shown at all, because "offered then
 * refused" is the trap this screen was built to remove. If that leaves nothing, the picker says
 * so in words rather than rendering an empty strip — §5.21, and the distinction that this whole
 * area keeps getting wrong: *nothing to offer* and *we could not ask* are different sentences.
 *
 * ## It lives with the delivery details
 *
 * Andy: *"Sits with the delivery details, where 'when should we deliver?' already is, not hidden
 * behind a person picker."* So `CartScreen` renders it directly under the For block, not inside
 * it, and not behind a tap.
 */
export function DayPicker({
  days = [],
  selected = null,
  unavailable = false,
  onSelect,
  testID = DAY_PICKER_TEST_ID,
}: {
  /** The calendar as read from the server. Filtered here, never by the caller. */
  days?: readonly ordering.OrderableDayView[];
  selected?: string | null;
  /**
   * The calendar could not be read — **not** the same as it having no days.
   *
   * `E05-52` made the calendar readable; before it, this state was every parent, all the time.
   * It is kept because a network failure still produces it, and because a screen that renders
   * "no days" when it means "we could not ask" is the defect that started all of this.
   */
  unavailable?: boolean;
  onSelect?: ((serviceDate: string) => void) | undefined;
  testID?: string;
} = {}) {
  const offerable = ordering.offerableDays(days);

  return (
    <View style={styles.block} testID={testID}>
      <Text style={styles.label}>When should we deliver?</Text>

      {unavailable ? (
        <Text style={styles.note} testID={`${testID}-unavailable`}>
          We couldn&rsquo;t load the days we can deliver on. Your cart is safe — try again in a
          moment.
        </Text>
      ) : offerable.length === 0 ? (
        // Distinct from the line above, deliberately. This one is a fact about the school; that
        // one is a fact about us, and a parent can act on only one of them.
        <Text style={styles.note} testID={`${testID}-none`}>
          There are no days we can deliver on just now. Ordering opens again once the kitchen has
          the next day&rsquo;s list.
        </Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          {offerable.map((day) => {
            const on = day.serviceDate === selected;
            return (
              <Pressable
                key={day.serviceDate}
                testID={`${testID}-day-${day.serviceDate}`}
                accessibilityRole="button"
                // The date is in the label, not only in the visible text: §7 says a control that
                // conveys state carries the state in its label, and "Wed 2" alone is not a date
                // a screen-reader user can act on.
                accessibilityLabel={longLabel(day.serviceDate)}
                accessibilityState={{ selected: on }}
                style={[styles.day, on ? styles.dayOn : null]}
                onPress={() => onSelect?.(day.serviceDate)}
              >
                <Text style={[styles.dayName, on ? styles.dayTextOn : null]}>
                  {weekday(day.serviceDate)}
                </Text>
                <Text style={[styles.dayNum, on ? styles.dayTextOn : null]}>
                  {dayOfMonth(day.serviceDate)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * `YYYY-MM-DD` is parsed as UTC midnight and formatted in UTC, on purpose.
 *
 * A service date is a **calendar day**, not an instant. Formatting it in the device's zone is how
 * `defaultServiceDate` shipped a UTC bug that moved every date by one for anyone west of
 * Greenwich (`docs/learnings.md`), and a lunch on the wrong day is not a rounding error.
 */
function parts(serviceDate: string): { weekday: string; day: string; long: string } {
  const d = new Date(`${serviceDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return { weekday: serviceDate, day: '', long: serviceDate };
  return {
    weekday: d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
    day: d.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'UTC' }),
    long: d.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }),
  };
}
const weekday = (s: string): string => parts(s).weekday;
const dayOfMonth = (s: string): string => parts(s).day;
const longLabel = (s: string): string => parts(s).long;

const styles = StyleSheet.create({
  block: {
    backgroundColor: bg.surface,
    borderWidth: borderWidth.hairline,
    borderColor: border.subtle,
    borderRadius: radius.lg,
    padding: space[4],
    gap: space[3],
  },
  label: {
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
    color: text.secondary,
  },
  note: {
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
    color: text.secondary,
  },
  strip: { gap: space[2], paddingRight: space[2] },
  day: {
    minWidth: touchTarget.min,
    minHeight: touchTarget.min,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    borderWidth: borderWidth.hairline,
    borderColor: border.subtle,
    backgroundColor: bg.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayOn: { backgroundColor: bg.surfaceBrand, borderColor: bg.surfaceBrand },
  dayName: {
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
    color: text.secondary,
  },
  dayNum: {
    fontSize: scale.body.size,
    lineHeight: scale.body.lineHeight,
    color: text.primary,
  },
  dayTextOn: { color: text.onBrand },
});
