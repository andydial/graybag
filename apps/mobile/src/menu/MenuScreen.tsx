import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { design, menu as menuDomain } from '@graybag/shared';

import { BrandHeader, EmptyState, ErrorState, Tabs, TextField, type TabItem } from '../components';
import { EmptyStateDiagnostic } from '../components/EmptyStateDiagnostic';
import type { MenuDiagnostic } from './useCachedMenu';
import { MenuList, type MenuListItem } from './MenuList';
import { useCachedMenu, type CachedMenuPayload } from './useCachedMenu';

const { bg, text, scale, space, radius, layout } = design;
const { ALL_CATEGORIES, filterMenu } = menuDomain;

/**
 * What the screen knows about the allergens of whoever the order is for.
 *
 * Three states, and the middle one is the whole point (`docs/ux-spec.md` §5.21, N2). An
 * allergen read that failed must suppress every flag **and say so** — rendering cards with no
 * warnings after a failed fetch is a safety claim nobody verified, and it is the exact defect
 * `AddChildScreen`'s `catch { return [] }` shipped.
 */
export type AllergenWatchlist =
  /** Nobody is selected, so there is nothing to compare a dish against. Not a failure. */
  | { status: 'none' }
  /** The allergen list could not be read. Flags off, and the screen admits it. */
  | { status: 'unavailable' }
  /** Read, and these are the allergens to warn about, with the words to warn in. */
  | { status: 'ready'; avoid: { allergenId: string; label: string }[] };

/** Hoisted so the default prop keeps one identity and the mapping below is not redone per render. */
const NO_WATCHLIST: AllergenWatchlist = { status: 'none' };

/**
 * The menu screen — `docs/ux-spec.md` §5.5, drawn to `docs/prototype/graybag-prototype.html`.
 *
 * Brand header, eyebrow, green title, search, the category strip, then a two-column grid of
 * dish cards. Above `fontScale` 1.35 the grid becomes a single column (§3.5); `MenuList` owns
 * that switch, because it is a property of the cards and not of the screen.
 *
 * **Reachable with no session** (`AR7`, `NV1`). Nothing on this screen asks who you are. The
 * only gate in the product is at checkout, and it is reached by intent.
 *
 * Category tabs **and** search, both, because `E04-12` is explicit that 50 items needs both —
 * tabs are how you browse when you do not know what you want, search is how you find "cold
 * coffee" when you do. They compose as AND (`filterMenu`), so searching inside a category
 * searches that category rather than silently leaving it.
 *
 * **Four kinds of empty, never one** (§5.21). An unpublished menu, a search that matched
 * nothing, a category with nothing in it and a menu we could not fetch are four different
 * facts with four different recoveries, and the defect this screen is named in — one
 * `ListEmptyComponent` saying "not published" for all of them — cost three hours hunting a
 * data problem that did not exist.
 */
export function MenuScreen({
  schoolId,
  onSelectDish,
  allergens = NO_WATCHLIST,
  testID = 'screen-menu',
}: {
  schoolId: string | null;
  onSelectDish: (dishId: string) => void;
  /**
   * Defaults to `none` because nothing wires a recipient into this screen yet. When one does,
   * a failed read must arrive here as `unavailable` rather than as an empty `avoid` list.
   */
  allergens?: AllergenWatchlist;
  testID?: string;
}) {
  const [categoryId, setCategoryId] = useState<string>(ALL_CATEGORIES);
  const [query, setQuery] = useState('');
  const { state, payload, stale, retry, diagnostic } = useCachedMenu(schoolId);

  const tabs = useMemo<TabItem[]>(
    () => [{ id: ALL_CATEGORIES, label: 'All' }, ...(payload?.categories ?? [])],
    [payload],
  );

  const visible = useMemo<MenuListItem[]>(() => {
    if (!payload) return [];
    return filterMenu(payload.dishes, { categoryId, query }).map((dish) =>
      toListItem(dish, allergens),
    );
  }, [payload, categoryId, query, allergens]);

  const intro = (
    <MenuIntro
      query={query}
      onQueryChange={setQuery}
      tabs={tabs}
      categoryId={categoryId}
      onCategoryChange={setCategoryId}
      allergensUnavailable={allergens.status === 'unavailable'}
      testID={testID}
    />
  );

  /**
   * N2, and it is not an empty menu. The cache only rejects when there is nothing stored *and*
   * the fetch failed, so reaching here really does mean we could not ask — which is our fault,
   * is retryable, and must never render as a statement about the school's data.
   */
  if (state === 'error') {
    return (
      <View style={styles.screen} testID={testID}>
        <BrandHeader />
        <ErrorState
          title="We couldn't load the menu"
          body="Check your connection and try again. Nothing in your cart is lost."
          onRetry={retry}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen} testID={testID}>
      <BrandHeader />

      {/* N4. The stale notice is a quiet line, never a blocking banner. We are holding a real
          menu; saying so is honest, and refusing to show it would be worse than showing it
          (P8, MC3). */}
      {stale ? (
        <Text style={styles.stale} accessibilityLiveRegion="polite">
          Offline — showing the menu you last loaded.
        </Text>
      ) : null}

      <MenuList
        items={visible}
        onSelect={onSelectDish}
        loading={state === 'loading'}
        testID={`${testID}-list`}
        ListHeaderComponent={intro}
        ListEmptyComponent={
          <MenuEmpty
            diagnostic={diagnostic}
            query={query}
            menuHasDishes={(payload?.dishes.length ?? 0) > 0}
            onClearSearch={() => {
              setQuery('');
              setCategoryId(ALL_CATEGORIES);
            }}
            onShowEverything={() => setCategoryId(ALL_CATEGORIES)}
          />
        }
      />
    </View>
  );
}

/**
 * Eyebrow, title, search and the category strip — the header of the scroll rather than a fixed
 * band, so a small screen at a large text size spends its height on food.
 *
 * It is a component and not an inline fragment on purpose: `FlatList` re-renders its header on
 * every keystroke, and a header whose *type* changes each render would remount the search field
 * and drop the keyboard on the first character.
 */
function MenuIntro({
  query,
  onQueryChange,
  tabs,
  categoryId,
  onCategoryChange,
  allergensUnavailable,
  testID,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  tabs: TabItem[];
  categoryId: string;
  onCategoryChange: (next: string) => void;
  allergensUnavailable: boolean;
  testID: string;
}) {
  return (
    <View style={styles.intro}>
      <Text style={styles.eyebrow}>Our food</Text>
      <Text style={styles.title} accessibilityRole="header">
        Made specially for your child
      </Text>

      {/*
        The partial state (§5.5). The menu is real, the allergen list is not — so every flag is
        suppressed and this line says why. **Never** render the absence of a flag as reassurance:
        "no warning shown" and "we could not check" look identical and mean opposite things.
      */}
      {allergensUnavailable ? (
        <Text
          style={styles.notice}
          accessibilityLiveRegion="polite"
          testID={`${testID}-allergens-unavailable`}
        >
          Allergy warnings aren't available right now — we couldn't load the allergen list, so no
          dish below has been checked.
        </Text>
      ) : null}

      <View style={styles.search}>
        <TextField
          label="Search the menu"
          value={query}
          onChangeText={onQueryChange}
          placeholder="Cold coffee, paneer, sandwich…"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          testID={`${testID}-search`}
        />
      </View>

      <Tabs
        items={tabs}
        activeId={categoryId}
        onChange={onCategoryChange}
        testID={`${testID}-tabs`}
      />
    </View>
  );
}

/**
 * The three empties that are genuinely N1 — a legitimate zero (§5.21). N2 never reaches here;
 * it is the error state above.
 *
 * Each gets its own words *and its own way out*, because "change what you asked for" is only a
 * recovery if the screen says which thing to change.
 */
function MenuEmpty({
  query,
  menuHasDishes,
  onClearSearch,
  onShowEverything,
  diagnostic,
}: {
  query: string;
  menuHasDishes: boolean;
  onClearSearch: () => void;
  onShowEverything: () => void;
  /** Non-production only. Four days of "no menu items" that no amount of reasoning closed. */
  diagnostic: MenuDiagnostic;
}) {
  const trimmed = query.trim();

  if (trimmed !== '') {
    return (
      <EmptyState
        title={`No dishes match "${trimmed}"`}
        body="Try a shorter word, or clear the category filter."
        actionLabel="Clear search"
        onAction={onClearSearch}
      />
    );
  }

  if (menuHasDishes) {
    return (
      <EmptyState
        title="Nothing in this category"
        body="Try another category — there's plenty on today."
        actionLabel="Show everything"
        onAction={onShowEverything}
      />
    );
  }

  /**
   * The one that has been wrong for four days, and the only one where the parent-facing copy is
   * a *claim about the server* rather than about what they typed. "Not published yet" is a
   * confident sentence; it is equally the sentence an app shows when it asked the wrong school,
   * read a poisoned cache, or received rows it then discarded. §5.21 says an unknown must not
   * render as a known — so below the reassuring sentence, the facts.
   */
  return (
    <>
      <EmptyState
        title="Nothing on the menu yet"
        body="This school's menu has not been published. It will appear here once it is."
      />
      <EmptyStateDiagnostic
        testID="menu-empty-diagnostic"
        facts={[
          { label: 'school', value: diagnostic.schoolId },
          { label: 'version', value: diagnostic.version },
          { label: 'source', value: diagnostic.source },
          { label: 'rows', value: diagnostic.rows },
        ]}
      />
    </>
  );
}

/**
 * Map a cached dish onto what the grid draws.
 *
 * The allergen state comes through `allergenDisclosure`, so `unknown` reaches the card as
 * `unknown` — the one mapping in this file that must not be simplified. Collapsing it to a
 * boolean here is the same defect `MI7` and `0006` exist to prevent, reintroduced two layers
 * up where no migration would catch it.
 *
 * The amber flag is a **different** question from the disclosure: it fires only on a real
 * clash with the selected recipient's own allergens (`allergenWarning`'s `match`). A dish
 * nobody has described is `warn: 'unknown'` — that is said in words on the dish sheet and in
 * the card's spoken label, and it is deliberately not dressed up as "Contains …", which would
 * name an allergen no one has actually declared.
 */
function toListItem(
  dish: CachedMenuPayload['dishes'][number],
  allergens: AllergenWatchlist,
): MenuListItem {
  const disclosure = menuDomain.allergenDisclosure({
    allergens: dish.allergens,
    allergensDeclaredNone: dish.allergensDeclaredNone,
  });

  return {
    id: dish.id,
    name: dish.name,
    pricePaise: dish.pricePaise,
    imageUri: dish.imageUri,
    foodType: readFoodType(dish),
    allergens: disclosure.state,
    warnAllergens: clashingAllergens(dish, allergens),
  };
}

function clashingAllergens(
  dish: CachedMenuPayload['dishes'][number],
  watchlist: AllergenWatchlist,
): string[] {
  // `none` has nobody to compare against; `unavailable` has nothing to compare with. Neither
  // may produce a flag, and only `unavailable` produces the line that says so.
  if (watchlist.status !== 'ready') return [];

  const warning = menuDomain.allergenWarning(
    { allergens: dish.allergens, allergensDeclaredNone: dish.allergensDeclaredNone },
    watchlist.avoid.map((entry) => entry.allergenId),
  );
  if (!warning.warn || warning.reason !== 'match') return [];

  const labels = new Map(watchlist.avoid.map((entry) => [entry.allergenId, entry.label]));
  return warning.allergenIds.map((id) => labels.get(id) ?? id);
}

/**
 * The dish's veg / egg / non-veg classification, if the cache is carrying one.
 *
 * **It is not, today.** `menu.FoodType` exists in the domain (`Dish.foodType`) but neither
 * `api/menu.ts`'s `ApiDish` nor `useCachedMenu`'s `CachedDish` carries it, so this returns
 * `null` for every dish and `FoodTypeMark` renders nothing — the mark the whole grid is
 * designed around is wired but unfed. Read defensively rather than hard-coded to `null` so
 * that adding the column to the payload lights the marks up without anyone having to find
 * this file; the three places that need the change are `api/menu.ts`, `installMenuCache.ts`
 * and `CachedDish`, none of which this task owns.
 */
function readFoodType(dish: CachedMenuPayload['dishes'][number]): menuDomain.FoodType | null {
  const value = (dish as unknown as { foodType?: unknown }).foodType;
  if (value === 'veg' || value === 'egg' || value === 'non_veg') return value;
  return null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.surface },
  intro: { paddingTop: space[2], gap: space[1] },
  eyebrow: {
    color: text.secondary,
    paddingHorizontal: layout.gutter,
    fontSize: scale.overline.size,
    lineHeight: scale.overline.lineHeight,
    fontWeight: scale.overline.weight,
    // `tracking` is the token's own value; a literal here escapes the type scale (S12).
    letterSpacing: scale.overline.tracking,
  },
  // `text.link` is `primary-700`. The brand green `#00af52` is 2.9:1 on white — a graphic and
  // large-text colour, never body copy — so the title uses the darker role even at h2.
  title: {
    color: text.link,
    paddingHorizontal: layout.gutter,
    fontSize: scale.h2.size,
    lineHeight: scale.h2.lineHeight,
    fontWeight: scale.h2.weight,
  },
  notice: {
    color: text.warning,
    backgroundColor: bg.surfaceWarning,
    marginHorizontal: layout.gutter,
    marginTop: space[2],
    padding: space[3],
    // `S15`: a fill with four visible corners is never `radius.none`.
    borderRadius: radius.md,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
  search: { paddingHorizontal: layout.gutter, paddingTop: space[3], paddingBottom: space[2] },
  stale: {
    color: text.secondary,
    backgroundColor: bg.surfaceMuted,
    paddingHorizontal: layout.gutter,
    paddingVertical: space[2],
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
  },
});
