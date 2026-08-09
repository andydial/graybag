import { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

import { DishImage, IMAGE_SIZES } from '../components/DishImage';
import { Skeleton } from '../components/Surfaces';

const { bg, text, border, scale, space, layout, borderWidth, touchTarget } = design;

export interface MenuListItem {
  id: string;
  name: string;
  description: string | null;
  pricePaise: number;
  imageUri: string | null;
  /** From `allergenDisclosure` — drives the badge, and `unknown` is not `none`. */
  allergens: 'declared' | 'declaredNone' | 'unknown';
}

/**
 * Row height, fixed and exported (`E14-05`).
 *
 * Fixed on purpose. `getItemLayout` needs a constant to let `FlatList` skip measurement, and
 * skipping measurement is most of what makes a long list smooth — but it is only *correct*
 * while every row really is this tall, so the row's own style is built from the same
 * constant rather than from numbers that happen to add up.
 */
export const ROW_HEIGHT = IMAGE_SIZES.thumb + layout.listRowPaddingY * 2;

/**
 * The menu list.
 *
 * **`FlatList`, not FlashList, and that is a decision.** The largest menu today is 50 items
 * (`E04`'s context note) and menu changes are rare. `FlatList` with a fixed `getItemLayout`,
 * a bounded window and stable keys is smooth at that size; FlashList would add a dependency
 * and a native module to a product whose binding constraint is network, not render cost
 * (`P11`). Revisit if a menu ever passes a few hundred items.
 *
 * Prices are integer paise and formatted here — never stored or passed as rupees
 * (non-negotiable #3).
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
  const renderItem = useCallback(
    ({ item }: { item: MenuListItem }) => <MenuRow item={item} onSelect={onSelect} />,
    [onSelect],
  );

  // `getItemLayout` is what lets the list skip measuring every row. It is only safe because
  // ROW_HEIGHT is fixed and the row is styled from that same constant.
  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: ROW_HEIGHT,
      offset: ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  if (loading) return <MenuListSkeleton testID={`${testID}-skeleton`} />;

  return (
    <FlatList
      testID={testID}
      data={items}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      getItemLayout={getItemLayout}
      // Bounded so a slow device never has fifty rows mounted at once. These are the
      // defaults made explicit rather than tuned — a number chosen without a device to
      // measure on is a guess, and E19-02 is the task that measures.
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={7}
      removeClippedSubviews
      contentContainerStyle={styles.content}
      {...(ListHeaderComponent ? { ListHeaderComponent } : {})}
      {...(ListEmptyComponent ? { ListEmptyComponent } : {})}
    />
  );
}

const keyExtractor = (item: MenuListItem) => item.id;

function MenuRow({
  item,
  onSelect,
}: {
  item: MenuListItem;
  onSelect: (id: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onSelect(item.id)}
      testID={`menu-row-${item.id}`}
      accessibilityRole="button"
      // One label for the row, and the allergen state is part of it — a parent scanning by
      // ear must not have to open each dish to learn that nobody has described it.
      accessibilityLabel={`${item.name}, ${formatPaise(item.pricePaise)}${allergenSuffix(item.allergens)}`}
      style={styles.row}
    >
      <DishImage
        uri={item.imageUri}
        recyclingKey={item.id}
        size={IMAGE_SIZES.thumb}
        testID={`menu-row-${item.id}-image`}
      />
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        {item.description !== null ? (
          <Text style={styles.description} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <Text style={styles.price}>{formatPaise(item.pricePaise)}</Text>
      </View>
    </Pressable>
  );
}

/**
 * The skeleton. `S5`: its boxes match the real row's boxes exactly, so nothing shifts when
 * the data lands — that geometric match is the whole reason a skeleton reads as progress
 * where a spinner reads as a stall.
 */
export function MenuListSkeleton({ testID }: { testID?: string }) {
  return (
    <View testID={testID} style={styles.content}>
      {Array.from({ length: 6 }, (_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={IMAGE_SIZES.thumb} height={IMAGE_SIZES.thumb} />
          <View style={styles.rowText}>
            <Skeleton width="60%" height={scale.bodyStrong.lineHeight} />
            <Skeleton width="90%" height={scale.bodySm.lineHeight} />
            <Skeleton width="25%" height={scale.bodyStrong.lineHeight} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Integer paise to a rupee string.
 *
 * Division happens **here, at the edge, for display only** — the number that travels and the
 * number that is stored are always paise (non-negotiable #3). A `pricePaise / 100` anywhere
 * that is not rendering is a bug.
 */
export function formatPaise(paise: number): string {
  return `Rs ${(paise / 100).toFixed(2)}`;
}

/** `unknown` is not `none`, and the ear must hear the difference (`MI1`, `MI7`). */
function allergenSuffix(state: MenuListItem['allergens']): string {
  if (state === 'declared') return ', contains allergens';
  if (state === 'unknown') return ', allergens not stated';
  return '';
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: layout.gutter },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    height: ROW_HEIGHT,
    minHeight: touchTarget.min,
    paddingVertical: layout.listRowPaddingY,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: border.subtle,
    backgroundColor: bg.surface,
  },
  rowText: { flex: 1, gap: space[1] },
  name: {
    color: text.primary,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  description: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
  // `text.price` is `primary-700`. It is NOT legal on `bg.surfaceAccent` (4.09, E13-13's
  // forbidden list) — this row is on `bg.surface`, where it passes.
  price: {
    color: text.price,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
});
