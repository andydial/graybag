import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { design, money, packEligibility } from '@graybag/shared';

import { Button } from '../components';

const { bg, text, border, space, radius, borderWidth, scale, layout } = design;

export const PLAN_DAY_TEST_ID = 'screen-plan-day';

/** A dish as the picker needs it. Allergen clash is decided by the caller, not here. */
export interface PickableDish {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  pricePaise: number;
  /** Allergens this dish contains that the chosen child reacts to. Empty when there are none. */
  clashes: readonly string[];
}

/**
 * Choosing the items for one day of a plan. `E21-44`, prototype `V.planday`.
 *
 * ## The rule is enforced here, in front of the parent
 *
 * The prototype says it plainly: *"a refusal that arrives after the work is a refusal that wastes
 * it."* So the footer states what is still needed at every tap, and the confirm is disabled until
 * the selection is a valid meal. Nothing is spent on this screen — it hands a selection back to
 * the planner — but a parent who cannot see why they are stuck is a parent who gives up.
 *
 * ## The required category is named, not assumed
 *
 * The heading for the required category says "one is required", read from the offer. A screen
 * that hardcoded "Drinks" would be silently wrong the day a pack requires fruit, and it would be
 * wrong in the most expensive place — the one where a parent is deciding.
 *
 * ## Allergens are shown, never used to hide a dish
 *
 * `F5`/`F6`: a clash is a **warning** on the row, in the child's name, and the dish stays
 * choosable. Hiding it would leave a parent unable to find something they can see on the menu
 * elsewhere, and would quietly make the allergen list a filter rather than an alert.
 */
export function PlanDayScreen({
  dayLabel = '',
  breakLabel = '',
  childName = '',
  dishes = [],
  selected = [],
  itemsPerMeal = 2,
  requiredCategoryId = '',
  requiredCategoryLabel = 'a drink',
  onToggleDish,
  onUseDay,
  testID = PLAN_DAY_TEST_ID,
}: {
  dayLabel?: string;
  breakLabel?: string;
  childName?: string;
  dishes?: readonly PickableDish[];
  /** Dish ids currently chosen for this day. */
  selected?: readonly string[];
  itemsPerMeal?: number;
  requiredCategoryId?: string;
  requiredCategoryLabel?: string;
  onToggleDish?: ((dishId: string) => void) | undefined;
  onUseDay?: (() => void) | undefined;
  testID?: string;
} = {}) {
  const chosen = useMemo(
    () => dishes.filter((dish) => selected.includes(dish.id)),
    [dishes, selected],
  );

  const problem = useMemo(
    () =>
      packEligibility.checkPackMeal(
        chosen.map((dish) => ({ categoryId: dish.categoryId, quantity: 1 })),
        { itemsPerMeal, requiredCategoryId },
      ),
    [chosen, itemsPerMeal, requiredCategoryId],
  );

  const byCategory = useMemo(() => {
    const groups = new Map<string, { name: string; dishes: PickableDish[] }>();
    for (const dish of dishes) {
      const group = groups.get(dish.categoryId) ?? { name: dish.categoryName, dishes: [] };
      group.dishes.push(dish);
      groups.set(dish.categoryId, group);
    }
    return [...groups.entries()];
  }, [dishes]);

  return (
    <View style={styles.screen} testID={testID}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.pad}>
          <Text style={styles.sectionHead}>
            {breakLabel}
            {childName === '' ? '' : ` · for ${childName}`}
          </Text>
          <Text style={styles.lead}>
            {itemsPerMeal} items, one of them {requiredCategoryLabel}. That’s what one meal from
            your pack covers.
          </Text>
        </View>

        {byCategory.map(([categoryId, group]) => (
          <View key={categoryId}>
            <View style={styles.pad}>
              <Text style={styles.sectionHead}>
                {group.name}
                {categoryId === requiredCategoryId ? ' — one is required' : ''}
              </Text>
            </View>
            {group.dishes.map((dish) => {
              const on = selected.includes(dish.id);
              return (
                <Pressable
                  key={dish.id}
                  testID={`${testID}-dish-${dish.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={styles.row}
                  onPress={() => onToggleDish?.(dish.id)}
                >
                  <View style={[styles.tick, on ? styles.tickOn : null]}>
                    <Text style={styles.tickMark}>{on ? '✓' : ''}</Text>
                  </View>
                  <View style={styles.grow}>
                    <Text style={styles.dishName}>{dish.name}</Text>
                    <Text style={styles.dishMeta}>
                      {money.formatPaise(dish.pricePaise)} à la carte
                    </Text>
                    {dish.clashes.length === 0 ? null : (
                      <Text style={styles.clash} testID={`${testID}-clash-${dish.id}`}>
                        Contains {dish.clashes.join(', ')}
                        {childName === '' ? '' : ` — ${childName} is allergic`}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer} testID={`${testID}-footer`}>
        <Text
          style={[styles.footerText, problem === null ? null : styles.footerBad]}
          testID={`${testID}-status`}
        >
          {problem === null
            ? chosen.map((dish) => dish.name).join(' + ')
            : packEligibility.packMealMessage(problem, requiredCategoryLabel)}
        </Text>
        <Button
          label={
            problem === null
              ? `Use this for ${dayLabel}`
              : `Pick ${itemsPerMeal} items, one ${requiredCategoryLabel}`
          }
          testID={`${testID}-use`}
          disabled={problem !== null}
          onPress={() => onUseDay?.()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  content: { paddingBottom: space[8] },
  pad: { paddingHorizontal: layout.gutter, paddingTop: space[4] },
  sectionHead: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.secondary,
    textTransform: 'uppercase', letterSpacing: scale.caption.tracking,
  },
  lead: {
    fontSize: scale.body.size, lineHeight: scale.body.lineHeight, color: text.secondary,
    marginTop: space[2],
  },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space[3],
    paddingHorizontal: layout.gutter, paddingVertical: layout.listRowPaddingY,
    borderBottomWidth: borderWidth.hairline, borderBottomColor: border.subtle,
  },
  grow: { flex: 1 },
  tick: {
    width: 22, height: 22, borderRadius: radius.full, borderWidth: borderWidth.emphasis,
    borderColor: border.subtle, alignItems: 'center', justifyContent: 'center',
    marginTop: space[0.5],
  },
  tickOn: { backgroundColor: bg.surfaceAccent, borderColor: text.link },
  tickMark: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.primary,
  },
  dishName: {
    fontSize: scale.label.size, lineHeight: scale.label.lineHeight, fontWeight: '700',
    color: text.primary,
  },
  dishMeta: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.secondary,
  },
  clash: {
    fontSize: scale.caption.size, lineHeight: scale.caption.lineHeight, color: text.danger,
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
