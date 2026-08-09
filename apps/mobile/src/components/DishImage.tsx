import { Image, type ImageContentFit } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { design } from '@graybag/shared';

const { bg, radius, duration } = design;

/**
 * A dish image (`E14-06`).
 *
 * **The single biggest lever on how the menu feels**, because the constraint is network and
 * not CPU (`P11`, CLAUDE.md's performance priorities): the audience is private schools in
 * tier-1 Indian cities on mid-range Androids over unreliable connections. A 50-item menu is a
 * 50-image page, and every byte not fetched is the difference between a screen that appears
 * and one that assembles itself while you watch.
 *
 * Four things are deliberate:
 *
 * **The size is requested, not downloaded-then-shrunk.** `E04-07` renders three sizes and the
 * caller says which it needs. Fetching a 1200px hero to draw a 96px thumbnail is the
 * commonest and most expensive mistake in a list like this, and it is invisible on a
 * developer's wifi.
 *
 * **`recyclingKey` is the dish id.** In a virtualised list (`E14-05`) a row's view is reused
 * for a different dish as you scroll; without a recycling key the old image stays visible
 * until the new one decodes, so you see the wrong dish's photo against the right dish's name.
 * On a menu with allergen information that is not a cosmetic bug.
 *
 * **`transition` is `duration.fast`, from the token.** An image appearing is `M04`'s
 * cross-fade, and the number comes from the same place every other duration does (`S2`).
 *
 * **The placeholder is a skeleton box, never a spinner** (`S5`) — and it is the *same* box
 * the image will occupy, so nothing shifts when it lands.
 */
export function DishImage({
  uri,
  size,
  /**
   * The dish id. Passed to `recyclingKey` — see above; without it a recycled row shows the
   * previous dish's photo against the new dish's name until the new image decodes.
   */
  recyclingKey,
  contentFit = 'cover',
  /**
   * Decorative by default. A dish image next to the dish's own name adds nothing for a
   * screen-reader user, and announcing "image of Veg Sandwich" after "Veg Sandwich" is
   * noise. Pass a label only when the image carries information the text does not.
   */
  accessibilityLabel,
  testID,
}: {
  uri: string | null;
  size: number;
  recyclingKey: string;
  contentFit?: ImageContentFit;
  accessibilityLabel?: string;
  testID?: string;
}) {
  if (uri === null) {
    return (
      <View
        testID={testID}
        style={[styles.placeholder, { width: size, height: size }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    );
  }

  return (
    <Image
      testID={testID}
      source={{ uri }}
      recyclingKey={recyclingKey}
      style={[styles.image, { width: size, height: size }]}
      contentFit={contentFit}
      // Disk, so a menu survives an app restart on a connection that may not come back.
      cachePolicy="memory-disk"
      transition={duration.fast}
      placeholderContentFit="cover"
      accessible={accessibilityLabel !== undefined}
      {...(accessibilityLabel !== undefined
        ? { accessibilityLabel }
        : { accessibilityElementsHidden: true, importantForAccessibility: 'no' as const })}
    />
  );
}

const styles = StyleSheet.create({
  image: { borderRadius: radius.md, backgroundColor: bg.surfaceMuted },
  // `S15`: a container or image frame with a visible corner is never `radius.none`. This one
  // sits inside a row, so all four corners are visible.
  placeholder: { borderRadius: radius.md, backgroundColor: bg.surfaceMuted },
});

/**
 * The three rendered widths (`E04-07`), as the numbers a caller picks between.
 *
 * Exported so a screen asks for `IMAGE_SIZES.thumb` rather than inventing a width, which is
 * what keeps the rendered set at three. A fourth size is a pipeline change, not a prop.
 */
export const IMAGE_SIZES = { thumb: 96, card: 160, hero: 640 } as const;
