import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { api, design } from '@graybag/shared';

import { EmptyState, ErrorState, ListRow, Skeleton } from '../components/Surfaces';

const { bg, space, layout } = design;

/**
 * "Which school?" — the first thing a new parent answers, and the only thing standing
 * between opening the app and seeing food.
 *
 * ## Why it is on the Menu tab rather than in front of the app
 *
 * `AR7` is a revenue constraint now, not a principle: ~150 Amity parents register from
 * scratch in a compressed window, and every step between opening the app and seeing a menu
 * costs some of them. So this is **not** a launch gate, not a modal, and not a step in a
 * signup wizard. It is what the Menu tab shows when it does not yet know which menu to
 * show, and answering it puts you straight into the menu.
 *
 * Everything else on the tab bar stays reachable while it is on screen, because a parent
 * who wants to look at their cart or their account should not have to answer this first.
 *
 * ## Why the list is not searchable
 *
 * Two schools today, and Mohali-only in v1. A search box in front of a two-item list is a
 * step that buys nothing. When the list is long enough to need one, `TextField` is already
 * in the component library and this becomes a five-line change — but adding it now would
 * be adding friction against a problem we do not have.
 */
export function SchoolPicker({
  onSelect,
  testID = 'school-picker',
}: {
  onSelect: (school: { schoolId: string; schoolName: string }) => void;
  testID?: string;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [schools, setSchools] = useState<api.ApiSchool[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState('loading');

    api
      .fetchSchools()
      .then((rows) => {
        if (!live) return;
        setSchools(rows);
        setState('ready');
      })
      .catch(() => {
        if (!live) return;
        // A failure here is genuinely blocking — there is nothing to show and nothing
        // cached, because a school has not been chosen yet. So this is one of the few
        // places a retry button is the honest answer rather than an empty state.
        setState('error');
      });

    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (state === 'error') {
    return (
      <View style={styles.screen} testID={`${testID}-error`}>
        <ErrorState
          body="We could not load the list of schools. Check your connection and try again."
          onRetry={retry}
        />
      </View>
    );
  }

  if (state === 'loading') {
    return (
      <View style={styles.screen} testID={`${testID}-loading`}>
        {/* Sized to the real rows so the list does not jump when it lands (S9). */}
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.skeletonRow}>
            <Skeleton width="70%" height={20} />
          </View>
        ))}
      </View>
    );
  }

  if (schools.length === 0) {
    return (
      <View style={styles.screen} testID={`${testID}-empty`}>
        <EmptyState
          title="No schools yet"
          body="GrayBag is not serving any schools in your area yet. Check back soon."
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.list} testID={testID}>
      {schools.map((school) => (
        <ListRow
          key={school.id}
          title={school.name}
          subtitle={school.city}
          testID={`${testID}-${school.id}`}
          onPress={() => onSelect({ schoolId: school.id, schoolName: school.name })}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: bg.canvas,
  },
  list: {
    paddingVertical: space[2],
  },
  skeletonRow: {
    paddingHorizontal: layout.gutter,
    paddingVertical: space[3],
  },
});
