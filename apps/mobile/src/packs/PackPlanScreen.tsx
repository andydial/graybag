import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { design, packEligibility, packPlan } from '@graybag/shared';

import { Button } from '../components';
import { useMealPackSurface } from './MealPackSurfaceContext';

const { bg, text, border, space, radius, borderWidth, scale, layout } = design;

export const PACK_PLAN_TEST_ID = 'screen-pack-plan';

/** A day the planner offers, with everything needed to decide whether it can be planned. */
export interface PlannableDay {
  /** `YYYY-MM-DD`, in the kitchen's timezone. */
  date: string;
  /** "Wed 27 Aug" — formatted by the caller, so this screen holds no date logic. */
  label: string;
  /** "Morning break", or the reason there is no service. */
  breakLabel: string;
  cutoffPassed: boolean;
  serves: boolean;
}

/** Someone a parent orders for. First names only reach the screen; nothing else is needed. */
export interface PlannerRecipient {
  id: string;
  firstName: string;
}

const BLOCK_COPY: Record<NonNullable<packPlan.DayBlock>, string> = {
  cutoff_passed: 'Ordering for this day closed last night',
  no_service: 'The school doesn’t serve on this day',
  after_expiry: 'After your pack expires',
};

/**
 * Planning several days from a pack. `E21-41`, prototype `V.packplan`.
 *
 * ## Why this is a planner and not ten trips to the cart
 *
 * Buying a pack is one screen. **Spending ten meals across a fortnight is where a parent either
 * gets value or gives up.** The prototype is explicit about it, and so is the shape here: every
 * day is on one screen, with its state visible, and the count against the balance is in the
 * footer at all times.
 *
 * ## Every refusal is stated on the day it applies to
 *
 * A day past its cutoff, a day the school does not serve, and a day after the pack expires are
 * all *shown*, greyed, with the reason — never filtered out. *"A planner that only shows bookable
 * days teaches nobody why the others are missing."* A parent who cannot find Sunday assumes the
 * app is broken; one who reads "the school doesn't serve on this day" has learned the rule.
 *
 * ## A pack is the parent's, so days may name different children
 *
 * The child picker is per-screen and the choice is stored per day, which is what lets one plan
 * cover two children across a fortnight. Andy: *"usable for anyone you order for at any
 * participating school, including mixed within one plan."*
 *
 * ## Nothing here spends a meal
 *
 * The confirm hands the plan up; `spend_meal_pack_meals` decides, atomically and all-or-nothing.
 * What this screen owes a parent is that the refusal never arrives *after* the work — which is
 * why the footer counts chosen days, not finished ones.
 *
 * ## `confirming` is a belt to the server's braces
 *
 * The double tap it guards is the exact input plan-level idempotency exists for, and the server
 * would handle it correctly anyway — `confirm_meal_pack_plan` replays rather than spending twice.
 * This is not therefore load-bearing for correctness; it is load-bearing for what the parent
 * SEES, which is a button that stops responding rather than one that looks ignored.
 *
 * It was withdrawn for several hours rather than shipped ahead of its wire (`D8`), because
 * `orphans.test.ts` keeps a hard count of declared exemptions and going up is meant to be
 * uncomfortable. `E21-47` brought both back together.
 */
export function PackPlanScreen({
  days = [],
  recipients = [],
  selectedRecipientId = null,
  plan = [],
  confirming = false,
  daysUnavailable = false,
  onRetryDays,
  onSelectRecipient,
  onOpenDay,
  onConfirm,
  testID = PACK_PLAN_TEST_ID,
}: {
  days?: readonly PlannableDay[];
  recipients?: readonly PlannerRecipient[];
  selectedRecipientId?: string | null;
  plan?: readonly packPlan.PlannedDay[];
  /** True while the confirm is in flight. Disables the button so a double tap cannot fire it twice. */
  confirming?: boolean;
  /**
   * The calendar read FAILED, which is not the same as there being no days (§5.21). Shown as its
   * own state with a retry, because "no days to plan" would be a lie about the school.
   */
  daysUnavailable?: boolean;
  onRetryDays?: (() => void) | undefined;
  onSelectRecipient?: ((recipientId: string) => void) | undefined;
  onOpenDay?: ((date: string) => void) | undefined;
  onConfirm?: (() => void) | undefined;
  testID?: string;
} = {}) {
  const surface = useMealPackSurface();
  const balance = surface.balance;

  const mealsLeft = balance?.mealsRemaining ?? 0;
  const rule = useMemo(
    () => ({
      itemsPerMeal: balance?.itemsPerMeal ?? 2,
      requiredCategoryId: balance?.requiredCategoryId ?? '',
    }),
    [balance],
  );

  const summary = useMemo(
    () => packPlan.summarisePlan(plan, mealsLeft, rule),
    [plan, mealsLeft, rule],
  );
  const byDate = useMemo(() => new Map(plan.map((d) => [d.date, d])), [plan]);

  const expiresOn = balance?.expiresAt?.slice(0, 10) ?? '9999-12-31';

  return (
    <View style={styles.screen} testID={testID}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.pad}>
          <Text style={styles.lead}>
            Pick the days you want covered, then choose two items for each — one of them a drink.
            Meals come out of your pack when you confirm, not before.
          </Text>
        </View>

        {recipients.length > 1 ? (
          <>
            <View style={styles.pad}>
              <Text style={styles.sectionHead}>Who’s eating</Text>
            </View>
            <ScrollView horizontal style={styles.strip} showsHorizontalScrollIndicator={false}>
              {recipients.map((person) => (
                <Pressable
                  key={person.id}
                  testID={`${testID}-recipient-${person.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: person.id === selectedRecipientId }}
                  style={[
                    styles.chip,
                    person.id === selectedRecipientId ? styles.chipOn : null,
                  ]}
                  onPress={() => onSelectRecipient?.(person.id)}
                >
                  <Text style={styles.chipText}>{person.firstName}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.tiny}>
              A pack belongs to you — use it for anyone you order for, at any participating school,
              and mix them across days.
            </Text>
          </>
        ) : null}

        {daysUnavailable ? (
          <View style={styles.pad} testID={`${testID}-days-unavailable`}>
            <Text style={styles.rowDate}>We couldn’t load the days</Text>
            <Text style={styles.rowWhy}>
              Your meals are safe — nothing has been spent. Try again in a moment.
            </Text>
            {onRetryDays === undefined ? null : (
              <>
                <View style={{ height: space[3] }} />
                <Button label="Try again" onPress={onRetryDays} variant="secondary" />
              </>
            )}
          </View>
        ) : null}

        {days.map((day) => {
          const block = packPlan.blockReason(day.date, {
            cutoffPassed: day.cutoffPassed,
            serves: day.serves,
            expiresOn,
          });
          const planned = byDate.get(day.date);
          const problem =
            planned === undefined ? null : packEligibility.checkPackMeal(planned.items, rule);
          const chosenFor = recipients.find((r) => r.id === planned?.recipientId);

          if (block !== null) {
            return (
              <View key={day.date} style={[styles.row, styles.rowOff]} testID={`${testID}-blocked-${day.date}`}>
                <View style={[styles.tick, styles.tickDashed]} />
                <View style={styles.grow}>
                  <Text style={styles.rowDate}>{day.label}</Text>
                  <Text style={styles.rowWhy}>{BLOCK_COPY[block]}</Text>
                </View>
              </View>
            );
          }

          return (
            <Pressable
              key={day.date}
              testID={`${testID}-day-${day.date}`}
              accessibilityRole="button"
              style={styles.row}
              onPress={() => onOpenDay?.(day.date)}
            >
              <View
                style={[
                  styles.tick,
                  planned === undefined ? null : problem === null ? styles.tickOn : styles.tickBad,
                ]}
              >
                <Text style={styles.tickMark}>
                  {planned === undefined ? '' : problem === null ? '✓' : '!'}
                </Text>
              </View>
              <View style={styles.grow}>
                <Text style={styles.rowDate}>{day.label}</Text>
                <Text style={styles.rowMeta}>
                  {day.breakLabel}
                  {chosenFor === undefined ? '' : ` · for ${chosenFor.firstName}`}
                </Text>
                {planned === undefined ? (
                  <Text style={styles.rowPrompt}>Choose two items</Text>
                ) : problem === null ? null : (
                  <Text style={styles.rowWhy}>
                    {packEligibility.packMealMessage(problem, 'a drink')}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/*
        Sticky, and it states the count at all times. The whole point of the footer is that a
        parent learns the plan is too big when they choose the eighth day, not after they have
        finished items for five of them.
      */}
      <View style={styles.footer} testID={`${testID}-footer`}>
        <Text
          style={[
            styles.footerText,
            summary.overBy > 0 || summary.incomplete > 0 ? styles.footerBad : null,
          ]}
          testID={`${testID}-count`}
        >
          {packPlan.planMessage(summary, mealsLeft)}
        </Text>
        <Button
          label={confirming ? 'Confirming…' : packPlan.planActionLabel(summary)}
          testID={`${testID}-confirm`}
          disabled={!summary.canConfirm || confirming}
          onPress={() => onConfirm?.()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  content: { paddingBottom: space[8] },
  pad: { paddingHorizontal: layout.gutter, paddingTop: space[4] },
  lead: {
    fontSize: scale.body.size, lineHeight: scale.body.lineHeight, color: text.secondary,
  },
  sectionHead: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.secondary,
    textTransform: 'uppercase', letterSpacing: scale.caption.tracking, marginTop: space[4],
  },
  strip: { paddingHorizontal: layout.gutter, paddingVertical: space[2] },
  chip: {
    paddingHorizontal: space[4], paddingVertical: space[2], marginRight: space[2],
    borderRadius: radius.full, borderWidth: borderWidth.hairline, borderColor: border.subtle,
    backgroundColor: bg.surface,
  },
  chipOn: { backgroundColor: bg.surfaceAccent, borderColor: text.link },
  chipText: {
    fontSize: scale.label.size, lineHeight: scale.label.lineHeight, color: text.primary,
  },
  tiny: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.secondary,
    paddingHorizontal: layout.gutter, marginBottom: space[3],
  },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space[3],
    paddingHorizontal: layout.gutter, paddingVertical: layout.listRowPaddingY,
    borderBottomWidth: borderWidth.hairline, borderBottomColor: border.subtle,
  },
  rowOff: { opacity: 0.55 },
  grow: { flex: 1 },
  tick: {
    width: 22, height: 22, borderRadius: radius.full, borderWidth: borderWidth.emphasis,
    borderColor: border.subtle, alignItems: 'center', justifyContent: 'center', marginTop: space[0.5],
  },
  tickDashed: { borderStyle: 'dashed' },
  tickOn: { backgroundColor: bg.surfaceAccent, borderColor: text.link },
  tickBad: { borderColor: text.danger },
  tickMark: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.primary,
  },
  rowDate: {
    fontSize: scale.label.size, lineHeight: scale.label.lineHeight, fontWeight: '700',
    color: text.primary,
  },
  rowMeta: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.secondary,
  },
  rowPrompt: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.link,
    fontWeight: '700', marginTop: space[1],
  },
  rowWhy: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.secondary,
    marginTop: space[1],
  },
  footer: {
    paddingHorizontal: layout.gutter, paddingTop: space[3], paddingBottom: space[4],
    borderTopWidth: borderWidth.hairline, borderTopColor: border.subtle,
    backgroundColor: bg.surface, gap: space[3],
  },
  footerText: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.secondary,
  },
  footerBad: { color: text.danger },
});
