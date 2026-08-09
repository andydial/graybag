import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { design, menu as menuDomain } from '@graybag/shared';

import { EmptyState, ErrorState } from '../components/Surfaces';
import { TextField } from '../components/TextField';
import { Tabs, type TabItem } from '../components/Tabs';
import { MenuList, type MenuListItem } from './MenuList';
import { useCachedMenu, type CachedMenuPayload } from './useCachedMenu';

const { bg, text, scale, space, layout } = design;
const { ALL_CATEGORIES, filterMenu } = menuDomain;

/**
 * The menu screen (`E04-12`), and the screen that makes Block 5's "done when" true: the app
 * opens, loads a cached menu offline-fast, and refetches only on a version change.
 *
 * **Reachable with no session** (`AR7`, `NV1`). Nothing on this screen asks who you are. The
 * only gate in the product is at checkout, and it is reached by intent.
 *
 * Category tabs **and** search, both, because `E04-12` is explicit that 50 items needs both —
 * tabs are how you browse when you do not know what you want, search is how you find "cold
 * coffee" when you do. They compose as AND (`filterMenu`), so searching inside a category
 * searches that category rather than silently leaving it.
 */
export function MenuScreen({
  schoolId,
  onSelectDish,
  testID = 'screen-menu',
}: {
  schoolId: string | null;
  onSelectDish: (dishId: string) => void;
  testID?: string;
}) {
  const [categoryId, setCategoryId] = useState<string>(ALL_CATEGORIES);
  const [query, setQuery] = useState('');
  const { state, payload, stale, retry } = useCachedMenu(schoolId);

  const tabs = useMemo<TabItem[]>(
    () => [{ id: ALL_CATEGORIES, label: 'All' }, ...(payload?.categories ?? [])],
    [payload],
  );

  const visible = useMemo<MenuListItem[]>(() => {
    if (!payload) return [];
    return filterMenu(payload.dishes, { categoryId, query }).map(toListItem);
  }, [payload, categoryId, query]);

  if (state === 'error') {
    return (
      <View style={styles.screen} testID={testID}>
        <ErrorState
          body="We could not load the menu. Check your connection and try again."
          onRetry={retry}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen} testID={testID}>
      {/* The stale notice is a quiet line, never a blocking banner. We are holding a real
          menu; saying so is honest, and refusing to show it would be worse than showing it
          (P8, MC3). */}
      {stale ? (
        <Text style={styles.stale} accessibilityLiveRegion="polite">
          Offline — showing the menu you last loaded.
        </Text>
      ) : null}

      <View style={styles.search}>
        <TextField
          label="Search the menu"
          value={query}
          onChangeText={setQuery}
          placeholder="Cold coffee, paneer, sandwich…"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          testID={`${testID}-search`}
        />
      </View>

      <Tabs items={tabs} activeId={categoryId} onChange={setCategoryId} testID={`${testID}-tabs`} />

      <MenuList
        items={visible}
        onSelect={onSelectDish}
        loading={state === 'loading'}
        testID={`${testID}-list`}
        ListEmptyComponent={
          query.trim() === '' ? (
            <EmptyState
              title="Nothing on the menu yet"
              body="This school's menu has not been published. It will appear here once it is."
            />
          ) : (
            <EmptyState
              title={`No dishes match "${query.trim()}"`}
              body="Try a shorter word, or clear the category filter."
              actionLabel="Clear search"
              onAction={() => {
                setQuery('');
                setCategoryId(ALL_CATEGORIES);
              }}
            />
          )
        }
      />
    </View>
  );
}

/**
 * Map a cached dish onto what the list draws.
 *
 * The allergen state comes through `allergenDisclosure`, so `unknown` reaches the row as
 * `unknown` — the one mapping in this file that must not be simplified. Collapsing it to a
 * boolean here is the same defect `MI7` and `0006` exist to prevent, reintroduced two layers
 * up where no migration would catch it.
 */
function toListItem(dish: CachedMenuPayload['dishes'][number]): MenuListItem {
  return {
    id: dish.id,
    name: dish.name,
    description: dish.description,
    pricePaise: dish.pricePaise,
    imageUri: dish.imageUri,
    allergens: menuDomain.allergenDisclosure({
      allergens: dish.allergens,
      allergensDeclaredNone: dish.allergensDeclaredNone,
    }).state,
  };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  search: { paddingHorizontal: layout.gutter, paddingTop: space[3] },
  stale: {
    color: text.secondary,
    backgroundColor: bg.surfaceMuted,
    paddingHorizontal: layout.gutter,
    paddingVertical: space[2],
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
  },
});
