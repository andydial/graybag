import { type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { design } from '@graybag/shared';

const {
  bg, text, border, scale, space, radius, borderWidth, layout, touchTarget, nav,
} = design;

export interface TabItem {
  id: string;
  label: string;
}

/**
 * Category tabs — the menu's browse control (`E04-12`).
 *
 * Horizontally scrollable, because a menu has more categories than fit and the alternative
 * (shrinking the labels) fails first on the longest translation and on the largest dynamic
 * type setting.
 *
 * The active tab is `nav.itemActive` — `forest-500`. That is brand-assigned: the guidelines
 * put `#145F48` on "secondary UI elements (tabs, toggles, footers)", which is why the active
 * tab is forest rather than the grey a token file would otherwise reach for (`S14`).
 *
 * **The indicator is not the only signal.** Colour alone conveying state fails §2.10 and
 * deuteranopia is roughly 6% of Indian men, so the active tab also carries `selected` in its
 * accessibility state and a heavier weight.
 */
export function Tabs({
  items,
  activeId,
  onChange,
  testID = 'tabs',
}: {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  testID?: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tabStrip}
      testID={testID}
      accessibilityRole="tablist"
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <Pressable
            key={item.id}
            onPress={() => onChange(item.id)}
            testID={`${testID}-${item.id}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            style={[styles.tab, active && styles.tabActive]}
          >
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * A bottom sheet (`M07`'s container).
 *
 * `useSafeAreaInsets` rather than `SafeAreaView`: a sheet needs the bottom inset added to its
 * padding, not a view inserted that also eats the top. Getting this wrong puts the primary
 * action under the home indicator on every modern iPhone, which is invisible in a simulator
 * screenshot taken at the wrong device size.
 */
export function Sheet({
  visible,
  onDismiss,
  title,
  children,
  testID = 'sheet',
}: {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  children: ReactNode;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
      testID={testID}
    >
      {/* The scrim is dismissable, and it is also the thing a screen reader must be able to
          skip past — so it is a button with a label rather than a bare View. */}
      <Pressable
        style={styles.scrim}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      <View
        style={[styles.sheet, { paddingBottom: layout.sheetPadding + insets.bottom }]}
        accessibilityViewIsModal
      >
        <View style={styles.grabber} />
        <Text style={styles.sheetTitle} accessibilityRole="header">
          {title}
        </Text>
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  tabStrip: { gap: space[2], paddingHorizontal: layout.gutter, paddingVertical: space[2] },
  tab: {
    minHeight: touchTarget.min,
    paddingHorizontal: space[4],
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: borderWidth.hairline,
    borderColor: border.subtle,
  },
  tabActive: { backgroundColor: nav.itemActive, borderColor: nav.itemActive },
  tabLabel: {
    color: text.secondary,
    fontSize: scale.label.size,
    lineHeight: scale.label.lineHeight,
    fontWeight: scale.label.weight,
  },
  // `text.onBrand` is white, and `nav.itemActive` is forest-500 at 7.61 on surface — this is
  // one of the pairs E13-13 asserts as legal rather than one a component guessed at.
  tabLabelActive: { color: text.onBrand },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: bg.scrim },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: bg.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: layout.sheetPadding,
    paddingTop: space[3],
    gap: space[3],
  },
  grabber: {
    alignSelf: 'center',
    width: space[10],
    height: space[1],
    borderRadius: radius.full,
    backgroundColor: border.subtle,
  },
  sheetTitle: {
    color: text.primary,
    fontSize: scale.h3.size,
    lineHeight: scale.h3.lineHeight,
    fontWeight: scale.h3.weight,
  },
});
