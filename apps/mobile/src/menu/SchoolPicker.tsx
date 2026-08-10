import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { api, design } from '@graybag/shared';

import {
  BrandPanel,
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  Lockup,
  Skeleton,
  TextField,
} from '../components';

const {
  bg, text, scale, space, radius, layout, touchTarget, borderWidth, border, icon,
} = design;

/**
 * "Which school?" — and, since `docs/ux-spec.md` §6.1.1 cut 1, the first thing the product
 * says about itself.
 *
 * ## This screen carries the welcome
 *
 * There used to be a Welcome screen in front of this one whose only job was to be passed
 * through: a value proposition, a "Browse the menu" button and a "Sign in" link. §6.1.1
 * counted the install-to-paid path at 11 screens and cut it, because a screen nobody reads
 * and everybody taps through is a tap we charge ~150 Amity parents for in a compressed
 * window (`SC3`). Its content moved here, into the green panel above the search field, and
 * the returning parent's route back is the "Sign in" link in its corner.
 *
 * So this component is two things at once, and that is deliberate rather than accidental:
 * the app's front door (`welcome`, the default) and a plain picker embedded in a sheet
 * (`welcome={false}`) when `AddChildScreen` or `ChildrenScreen` needs the same list under
 * their own title.
 *
 * ## Why the panel is `surfaceBrandStrong` and not the `BrandPanel` default
 *
 * `bg.surfaceBrand` is the brand green, and white on it is **3.85:1** — legal for large text
 * and control boundaries, forbidden for body copy, and `contrast.ts` asserts that pair as
 * one that must keep failing. This panel carries body copy ("Start by picking their
 * school…"), which is precisely the hole `E13-17` added `bg.surfaceBrandStrong` to fill: the
 * same green as `action.primaryBg`, no new colour, white on it is 5.19. The alternative —
 * setting a 13pt line in semibold and calling it large text — is the kind of rounding that
 * `S20` exists to stop.
 *
 * ## Four kinds of empty, which is the whole point (§5.21)
 *
 * "No school matches your search" (N1) and "we could not load the list" (N2) were one state
 * here, and that collapse is the defect class §5.21 was written about. They are now two
 * states with two testIDs, two sets of words and two recoveries — clear the search, or
 * retry. A third, "nothing is onboarded at all", should be impossible in production and
 * still renders as itself rather than as a failure.
 *
 * The fourth is N4, below.
 */

/** Fixed rather than derived: the main thread wires the link and needs a stable handle. */
export const SIGN_IN_TEST_ID = 'screen-school-picker-signin';

/**
 * The last list that loaded, kept so a failed refresh can serve N4 ("this is what we had
 * last time") instead of N2 ("we couldn't ask").
 *
 * **In memory, and it does not survive a restart** — the same limitation, for the same
 * reason, as `installMenuCache`: the app has no key/value store yet (`expo-secure-store` is
 * for the session, AsyncStorage is a native module and arrives with `E04-15`). Within a
 * session it is still worth having: reopening the picker on a train is the common case, and
 * showing the two schools you saw a minute ago under a quiet stale line beats a retry button
 * for a list that changes about twice a year.
 *
 * It is only ever consulted **after a fetch has failed**. Rendering it first and revalidating
 * behind it would be better UX and a worse trade here: it would make the loading state
 * conditional on what an earlier mount happened to see.
 */
let lastLoaded: api.ApiSchool[] | null = null;

/** Test seam. Also the right call on sign-out, if a caller ever needs it. */
export function clearSchoolListCache(): void {
  lastLoaded = null;
}

export function SchoolPicker({
  onSelect,
  onSignIn,
  onRequestSchool,
  welcome = true,
  testID = 'school-picker',
}: {
  onSelect: (school: { schoolId: string; schoolName: string }) => void;
  /**
   * Opens sign-in from the panel's corner link. Optional because the link is only honest
   * when there is somewhere for it to go — an embedded picker inside a sheet has no such
   * route, and a link that does nothing is worse than no link.
   */
  onSignIn?: () => void;
  /**
   * "Ask us to add it", offered when a search matches nothing. Optional for the same reason:
   * there is no published support address yet (`E20-21` is still `«PENDING»`), so the button
   * appears when a caller can route it and the copy stands on its own when nobody can.
   */
  onRequestSchool?: () => void;
  /** The merged Welcome header. False for the picker embedded in a sheet. */
  welcome?: boolean;
  testID?: string;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [schools, setSchools] = useState<api.ApiSchool[]>([]);
  const [stale, setStale] = useState(false);
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState('loading');

    api
      .fetchSchools()
      .then((rows) => {
        if (!live) return;
        lastLoaded = rows;
        setSchools(rows);
        setStale(false);
        setState('ready');
      })
      .catch(() => {
        if (!live) return;
        // N4 before N2: if we have shown this parent a list before, showing it again and
        // saying it is old is truer than telling them we have nothing. If we have not,
        // there is genuinely nothing to render — no school has been chosen, so nothing
        // downstream is cached either — and a retry is the honest answer.
        if (lastLoaded !== null) {
          setSchools(lastLoaded);
          setStale(true);
          setState('ready');
          return;
        }
        setStale(false);
        setState('error');
      });

    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const trimmed = query.trim();
  const matches = useMemo(() => {
    if (trimmed === '') return schools;
    const needle = trimmed.toLowerCase();
    // City as well as name: "Mohali" is how half the audience would start, and a search that
    // ignores the only other word on the row looks broken rather than strict.
    return schools.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) || s.city.toLowerCase().includes(needle),
    );
  }, [schools, trimmed]);

  // The search field is shown only where there is something to search. Over an error it
  // invites typing into a list we never loaded, which is the same lie in a different shape.
  const searchable = state === 'loading' || (state === 'ready' && schools.length > 0);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID={testID}
      // A parent taps a school with the keyboard still up. Without this the first tap only
      // dismisses the keyboard and the row has to be pressed twice.
      keyboardShouldPersistTaps="handled"
    >
      {welcome ? <WelcomeHeader onSignIn={onSignIn} /> : null}

      {searchable ? (
        <View style={styles.search}>
          <TextField
            label="Find your school or college"
            value={query}
            onChangeText={setQuery}
            placeholder="Search schools and colleges in Mohali"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            testID={`${testID}-search`}
          />
        </View>
      ) : null}

      {stale ? (
        <Text style={styles.stale} testID={`${testID}-stale`}>
          Offline — showing the schools you last loaded.
        </Text>
      ) : null}

      <Body
        state={state}
        schools={schools}
        matches={matches}
        query={trimmed}
        onSelect={onSelect}
        onClearSearch={() => setQuery('')}
        {...(onRequestSchool ? { onRequestSchool } : {})}
        onRetry={retry}
        testID={testID}
      />
    </ScrollView>
  );
}

/**
 * The merged Welcome (§6.1.1 cut 1): lockup, the way back for a returning parent, and the
 * two lines that used to be a whole screen.
 *
 * The lockup is `Lockup`, not an icon with "graybag" typed beside it — the supplied asset is
 * the lockup and the spacing is not ours to invent — and it is the white variant, because the
 * green one on a green fill is how the first prototype shipped a header nobody could see.
 */
function WelcomeHeader({ onSignIn }: { onSignIn?: (() => void) | undefined }) {
  return (
    <BrandPanel radius={radius.none} style={styles.panel} testID="school-picker-welcome">
      <View style={styles.panelTop}>
        <Lockup white />
        {onSignIn !== undefined ? (
          <Pressable
            onPress={onSignIn}
            testID={SIGN_IN_TEST_ID}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            style={styles.signIn}
          >
            <Text style={styles.signInLabel}>Sign in</Text>
          </Pressable>
        ) : null}
      </View>

      {/*
        Recipient-neutral copy is the standing preference and this line is the one place it
        is deliberately not neutral: it is the brand's own sentence, it is what the panel
        replaced a whole screen to keep, and the neutral rewrite lands in the search field
        and the empty states instead, where the college and staff cases actually bite.
      */}
      <Text style={styles.pitch} accessibilityRole="header">
        healthy, home-fresh meals delivered right to your child at school
      </Text>
      <Text style={styles.pitchSub}>
        Start by picking their school. No account needed to look around.
      </Text>
    </BrandPanel>
  );
}

/**
 * Every state the list can be in, in one place, so the four emptinesses are visibly four
 * things rather than four branches scattered through a render.
 */
function Body({
  state,
  schools,
  matches,
  query,
  onSelect,
  onClearSearch,
  onRequestSchool,
  onRetry,
  testID,
}: {
  state: 'loading' | 'ready' | 'error';
  schools: api.ApiSchool[];
  matches: api.ApiSchool[];
  query: string;
  onSelect: (school: { schoolId: string; schoolName: string }) => void;
  onClearSearch: () => void;
  onRequestSchool?: () => void;
  onRetry: () => void;
  testID: string;
}) {
  if (state === 'error') {
    // N2. Named as ours, because it is: nothing about the parent's data is wrong.
    return (
      <View style={styles.state} testID={`${testID}-error`}>
        <ErrorState
          title="We couldn't load the school list"
          body="This is us, not you. Check your connection and try again."
          onRetry={onRetry}
        />
      </View>
    );
  }

  if (state === 'loading') {
    return (
      <View testID={`${testID}-loading`}>
        {/* Sized to the real rows so the list does not jump when it lands (S9). */}
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.skeletonRow}>
            <Skeleton width="65%" height={scale.bodyStrong.lineHeight} />
            <Skeleton width="35%" height={scale.bodySm.lineHeight} />
          </View>
        ))}
      </View>
    );
  }

  if (schools.length === 0) {
    // N1, and one that should be impossible in production — `0012`'s anon policy admits
    // every onboarded, active, not-offboarded school, so an empty answer means none exist.
    return (
      <View style={styles.state} testID={`${testID}-empty`}>
        <EmptyState
          title="No schools yet"
          body="GrayBag isn't serving any schools or colleges yet. Check back soon."
        />
      </View>
    );
  }

  if (matches.length === 0) {
    // N1, and the one §5.21 names: this is a statement about the search, never about the
    // request. The words and the recovery both have to say so.
    return (
      <View style={styles.state} testID={`${testID}-no-match`}>
        <EmptyState
          title={`No school matches "${query}"`}
          body="We're adding schools and colleges across Mohali. Tell us yours and we'll come to you."
          actionLabel="Clear search"
          onAction={onClearSearch}
        />
        {onRequestSchool !== undefined ? (
          <View style={styles.stateAction}>
            <Button label="Ask us to add it" onPress={onRequestSchool} variant="primary" />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {matches.map((school) => (
        <ListRow
          key={school.id}
          title={school.name}
          subtitle={school.city}
          testID={`${testID}-${school.id}`}
          trailing={
            <ChevronRight
              size={icon.size.md}
              color={text.tertiary}
              strokeWidth={icon.stroke.default}
            />
          }
          onPress={() => onSelect({ schoolId: school.id, schoolName: school.name })}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  content: { flexGrow: 1 },

  panel: {
    // Not the `BrandPanel` default green: white body copy is illegal on `bg.surfaceBrand`
    // (3.85) and legal on this one (5.19). See the note at the top of the file.
    backgroundColor: bg.surfaceBrandStrong,
    paddingHorizontal: layout.gutter,
    paddingTop: space[4],
    paddingBottom: space[6],
  },
  panelTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space[4],
  },
  signIn: {
    minHeight: touchTarget.min,
    justifyContent: 'center',
    paddingLeft: space[4],
  },
  signInLabel: {
    color: text.onBrand,
    fontSize: scale.button.size,
    lineHeight: scale.button.lineHeight,
    fontWeight: scale.button.weight,
  },
  pitch: {
    color: text.onBrand,
    fontSize: scale.h2.size,
    lineHeight: scale.h2.lineHeight,
    fontWeight: scale.h2.weight,
    marginBottom: space[2],
  },
  pitchSub: {
    color: text.onBrand,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },

  search: { paddingHorizontal: layout.gutter, paddingTop: space[4], paddingBottom: space[2] },

  stale: {
    backgroundColor: bg.surfaceMuted,
    color: text.secondary,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
    paddingHorizontal: layout.gutter,
    paddingVertical: space[2],
  },

  list: { paddingHorizontal: layout.gutter },

  // `EmptyState` and `ErrorState` bring their own padding; this only gives them the room to
  // sit in the middle of what is left rather than under the search field.
  state: { flexGrow: 1, justifyContent: 'center', gap: space[4] },
  stateAction: { paddingHorizontal: layout.gutter },

  skeletonRow: {
    minHeight: touchTarget.min,
    justifyContent: 'center',
    gap: space[1],
    marginHorizontal: layout.gutter,
    paddingVertical: layout.listRowPaddingY,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: border.subtle,
  },
});
