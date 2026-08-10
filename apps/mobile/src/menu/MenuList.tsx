import { useCallback } from 'react';
import { Image } from 'expo-image';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { design, money, type menu as menuDomain } from '@graybag/shared';

import { AllergenFlag, FoodTypeMark, PatternTile, Skeleton } from '../components';
import { IMAGE_SIZES } from '../components/DishImage';

const { bg, text, scale, space, radius, layout, duration } = design;

export interface MenuListItem {
  id: string;
  name: string;
  pricePaise: number;
  imageUri: string | null;
  /** Veg / egg / non-veg. `null` when the kitchen has not classified the dish. */
  foodType: menuDomain.FoodType | null;
  /** From `allergenDisclosure` — drives the spoken label, and `unknown` is not `none`. */
  allergens: 'declared' | 'declaredNone' | 'unknown';
  /**
   * The display names of the **selected recipient's** allergens that this dish contains — the
   * amber flag on the photo. Empty means "no clash to report", which is not the same as "we
   * checked": when the allergen list could not be read at all the screen suppresses every flag
   * *and says so* (`docs/ux-spec.md` §5.21, N2). That distinction lives in `MenuScreen`,
   * because a row cannot tell "nothing matched" from "nothing was compared".
   */
  warnAllergens: string[];
}

/**
 * Past this text size the two-column grid stops being a grid — `docs/ux-spec.md` §3.5.
 *
 * `AX1` on iOS and the equivalent on Android. Above it the photograph is the thing that gives
 * way: it becomes a 96pt leading thumbnail, the dish name gets as many lines as it needs, and
 * the price and the allergen warning move into the text column where neither can be clipped.
 * Three things are absolute at every size — no truncated price, no truncated allergen warning,
 * no clipped primary action — and only the photo is negotiable.
 */
export const AX_SINGLE_COLUMN_FONT_SCALE = 1.35;

/** The card photo, 16:10 (§5.5). */
const PHOTO_ASPECT = 16 / 10;

/** Two lines, capped (§5.5) — and uncapped in the single-column layout above. */
const NAME_LINES = 2;

/** Six, because six is what fills the screen the grid is pretending to be (§5.5). */
const SKELETON_CARDS = 6;

interface MenuMetrics {
  singleColumn: boolean;
  columns: number;
  cardWidth: number;
  photoWidth: number;
  photoHeight: number;
  /** Reserved height for the name so every card in a row is the same height. */
  nameHeight: number;
  /**
   * The height of one grid row including the gap beneath it, or `null` in the single-column
   * layout where the name is deliberately unbounded and no constant can be true.
   */
  rowHeight: number | null;
}

/**
 * The one place the grid's geometry is computed.
 *
 * `NV6` keeps `getItemLayout` on this list, and `getItemLayout` is only *correct* while every
 * row really is the height it claims. So the card is styled **from these numbers** rather than
 * from numbers that happen to add up — the same discipline the old fixed `ROW_HEIGHT` had, now
 * that the row's height depends on the window width and the text size.
 *
 * Line heights are reserved at `lineHeight × fontScale`. If the platform scales an explicit
 * `lineHeight` the reservation is exact; if it does not, the reservation is generous. Both are
 * safe — over-reserving costs whitespace, under-reserving clips a price.
 */
function useMenuMetrics(): MenuMetrics {
  const { width, fontScale } = useWindowDimensions();

  const singleColumn = fontScale >= AX_SINGLE_COLUMN_FONT_SCALE;
  const contentWidth = Math.max(width - layout.gutter * 2, IMAGE_SIZES.thumb);
  const cardWidth = singleColumn ? contentWidth : (contentWidth - layout.gridGutter) / 2;
  const nameHeight = scale.bodySm.lineHeight * fontScale * NAME_LINES;

  if (singleColumn) {
    return {
      singleColumn,
      columns: 1,
      cardWidth,
      photoWidth: IMAGE_SIZES.thumb,
      photoHeight: IMAGE_SIZES.thumb,
      nameHeight,
      rowHeight: null,
    };
  }

  const photoHeight = Math.round(cardWidth / PHOTO_ASPECT);
  const cardHeight =
    photoHeight + space[2] + nameHeight + space[1] + scale.bodyStrong.lineHeight * fontScale;

  return {
    singleColumn,
    columns: 2,
    cardWidth,
    photoWidth: cardWidth,
    photoHeight,
    nameHeight,
    rowHeight: cardHeight + layout.gridGutter,
  };
}

/**
 * The menu grid — `docs/ux-spec.md` §5.5, drawn from `docs/prototype/graybag-prototype.html`.
 *
 * **`FlatList`, not FlashList, and that is a decision** (`NV6`). The largest menu today is 50
 * items and menu changes are rare; `FlatList` with a bounded window, stable keys and a fixed
 * `getItemLayout` is smooth at that size, and FlashList would add a native module to a product
 * whose binding constraint is network rather than render cost (`P11`).
 *
 * `getItemLayout` is supplied **only in the two-column layout**, where `useMenuMetrics` makes
 * the row height true by construction. In the `AX1`+ layout the name is unbounded by design, so
 * there is no constant to give — and a `getItemLayout` that lies is worse than none, because
 * the list then scrolls to the wrong place instead of merely measuring.
 *
 * Prices are integer paise formatted by `money.formatPaise` at the edge (non-negotiable #3).
 */
export function MenuList({
  items,
  onSelect,
  loading = false,
  testID = 'menu-list',
  ListHeaderComponent,
  ListEmptyComponent,
}: {
  items: MenuListItem[];
  onSelect: (id: string) => void;
  loading?: boolean;
  testID?: string;
  ListHeaderComponent?: React.ReactElement;
  ListEmptyComponent?: React.ReactElement;
}) {
  const metrics = useMenuMetrics();

  const renderItem = useCallback(
    ({ item }: { item: MenuListItem }) => (
      <DishCard item={item} onSelect={onSelect} metrics={metrics} />
    ),
    [onSelect, metrics],
  );

  const getItemLayout = useCallback(
    (_: unknown, index: number) => {
      // Only ever called when `rowHeight` is a number — see the guard on the prop below.
      const height = metrics.rowHeight ?? 0;
      return { length: height, offset: height * index, index };
    },
    [metrics.rowHeight],
  );

  if (loading) {
    return (
      <View style={styles.loading}>
        {ListHeaderComponent}
        <MenuListSkeleton testID={`${testID}-skeleton`} />
      </View>
    );
  }

  return (
    <FlatList
      // `numColumns` cannot change on the fly; remounting on the column count is how the
      // dynamic-type switch in §3.5 is allowed to happen at all.
      key={metrics.columns}
      testID={testID}
      data={items}
      numColumns={metrics.columns}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      // Bounded so a slow device never has fifty cards mounted at once. These are the defaults
      // made explicit rather than tuned — a number chosen without a device to measure on is a
      // guess, and E19-02 is the task that measures.
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={7}
      removeClippedSubviews
      contentContainerStyle={styles.content}
      {...(metrics.columns > 1 ? { columnWrapperStyle: styles.columnWrapper } : {})}
      {...(metrics.rowHeight !== null ? { getItemLayout } : {})}
      {...(ListHeaderComponent ? { ListHeaderComponent } : {})}
      {...(ListEmptyComponent ? { ListEmptyComponent } : {})}
    />
  );
}

const keyExtractor = (item: MenuListItem) => item.id;

/**
 * One dish card: photo, food-type mark, allergen flag, name, price.
 *
 * **Tapping opens the dish, it never adds it** (§5.5). A mis-tap that puts food in a cart is a
 * worse failure than a mis-tap that opens a sheet, and it is the reason the promoted dish on
 * Home says "See dish" rather than "Order".
 */
function DishCard({
  item,
  onSelect,
  metrics,
}: {
  item: MenuListItem;
  onSelect: (id: string) => void;
  metrics: MenuMetrics;
}) {
  const { singleColumn, cardWidth, photoWidth, photoHeight, nameHeight, rowHeight } = metrics;
  const warned = item.warnAllergens.length > 0;

  return (
    <Pressable
      onPress={() => onSelect(item.id)}
      testID={`menu-row-${item.id}`}
      accessibilityRole="button"
      // One label for the whole card. A parent scanning by ear must hear the warning and the
      // price without opening the dish, and must hear the difference between "no allergens"
      // and "nobody has said" (`MI1`, `MI7`).
      accessibilityLabel={cardLabel(item)}
      style={[
        styles.card,
        singleColumn
          ? [styles.cardRow, { width: cardWidth }]
          : { width: cardWidth, height: (rowHeight ?? 0) - layout.gridGutter },
      ]}
    >
      <View style={[styles.photo, { width: photoWidth, height: photoHeight }]}>
        {item.imageUri === null ? (
          // Never a grey box. Most of the catalogue has no photograph yet, so this is the
          // ordinary case rather than the edge one.
          <PatternTile testID={`menu-row-${item.id}-image`} />
        ) : (
          /*
           * `expo-image` directly rather than `DishImage`, and only because `DishImage` draws a
           * square (`size` sets both axes) while a menu card's photo is 16:10. Every property
           * that makes `DishImage` worth having is repeated here deliberately —
           * `recyclingKey` so a recycled card never shows the previous dish's photo against
           * this dish's name, a disk cache so a menu survives a restart on a connection that
           * may not come back, and `duration.fast` from the token. A `height`/`aspectRatio`
           * prop on `DishImage` would let this go back to one implementation.
           */
          <Image
            testID={`menu-row-${item.id}-image`}
            source={{ uri: item.imageUri }}
            recyclingKey={item.id}
            style={styles.photoFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={duration.fast}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        )}

        {/* On the photo, top-left, as an Indian audience expects to see it. */}
        <View style={styles.markSlot}>
          <FoodTypeMark foodType={item.foodType} testID={`menu-row-${item.id}-foodtype`} />
        </View>

        {/* Top-right, over the photo — but only where it has room. In the large-text layout it
            moves into the text column below, because §3.5 forbids a truncated warning and a
            96pt thumbnail cannot hold one. */}
        {!singleColumn && warned ? (
          <View style={styles.flagSlot}>
            <AllergenFlag allergens={item.warnAllergens} testID={`menu-row-${item.id}-allergen`} />
          </View>
        ) : null}
      </View>

      <View style={singleColumn ? styles.textColumn : styles.textBlock}>
        <Text
          style={[styles.name, singleColumn ? null : { height: nameHeight }]}
          {...(singleColumn ? {} : { numberOfLines: NAME_LINES })}
        >
          {item.name}
        </Text>

        {singleColumn && warned ? (
          <View style={styles.flagInline}>
            <AllergenFlag allergens={item.warnAllergens} testID={`menu-row-${item.id}-allergen`} />
          </View>
        ) : null}

        {/* Never truncated, at any text size (§3.5). No `numberOfLines`, ever. */}
        <Text style={styles.price}>{money.formatPaise(item.pricePaise)}</Text>
      </View>
    </Pressable>
  );
}

/**
 * The skeleton (`R9`, `S5`).
 *
 * Its boxes are the card's boxes, from the same metrics, so nothing shifts when the data lands
 * — that geometric match is the whole reason a skeleton reads as progress where a spinner reads
 * as a stall.
 */
export function MenuListSkeleton({ testID }: { testID?: string }) {
  const { singleColumn, cardWidth, photoWidth, photoHeight, nameHeight } = useMenuMetrics();

  return (
    <View testID={testID} style={[styles.content, styles.skeletonGrid]}>
      {Array.from({ length: SKELETON_CARDS }, (_, i) => (
        <View
          key={i}
          style={[styles.card, singleColumn ? styles.cardRow : null, { width: cardWidth }]}
        >
          <Skeleton width={photoWidth} height={photoHeight} />
          <View style={singleColumn ? styles.textColumn : styles.textBlock}>
            <Skeleton width="80%" height={nameHeight} />
            <Skeleton width="40%" height={scale.bodyStrong.lineHeight} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** `unknown` is not `none`, and the ear must hear the difference (`MI1`, `MI7`). */
function cardLabel(item: MenuListItem): string {
  const parts = [item.name, money.formatPaise(item.pricePaise)];

  if (item.warnAllergens.length > 0) {
    parts.push(`warning, contains ${item.warnAllergens.join(', ')}`);
  }
  if (item.allergens === 'declared') parts.push('contains allergens');
  if (item.allergens === 'unknown') parts.push('allergens not stated');

  return parts.join(', ');
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: layout.gutter, paddingBottom: layout.sectionGap },
  loading: { flex: 1 },
  columnWrapper: { gap: layout.gridGutter, marginBottom: layout.gridGutter },

  card: { backgroundColor: bg.surface },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: layout.blockGap,
    marginBottom: layout.gridGutter,
  },

  photo: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: bg.surfaceMuted,
  },
  photoFill: { width: '100%', height: '100%' },
  markSlot: { position: 'absolute', top: space[2], left: space[2] },
  flagSlot: { position: 'absolute', top: space[2], right: space[2] },

  textBlock: { paddingTop: space[2], gap: space[1] },
  textColumn: { flex: 1, gap: space[1] },
  flagInline: { alignSelf: 'flex-start' },

  name: {
    color: text.primary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  // `text.price` is `primary-700`. It is NOT legal on `bg.surfaceAccent` (4.09, E13-13's
  // forbidden list) — this card sits on `bg.surface`, where it passes.
  price: {
    color: text.price,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },

  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: layout.gridGutter },
});
