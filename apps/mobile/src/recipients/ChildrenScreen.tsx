import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, design } from '@graybag/shared';

import { Button } from '../components/Button';
import { EmptyState, ErrorState, ListRow, Skeleton } from '../components/Surfaces';
import { Sheet } from '../components/Tabs';
import { SchoolPicker } from '../menu/SchoolPicker';

const { bg, text, scale, space, layout } = design;

/**
 * "Your children" — the list `E05-01` was missing.
 *
 * Adding a child worked and then the child vanished: there was nothing that listed them, so
 * a parent had no way to see what they had entered, no way to correct it, and no way to tell
 * whether the add had worked at all. Everything downstream — ordering for a child, moving one
 * to another school (`E05-02`) — starts from a row on this screen.
 *
 * ## Everything on it is regulated data
 *
 * First name, last name, class, section and school are tier P under DPDP (§13.3,
 * non-negotiable #4). They are drawn and nothing else: **not logged, not sent to Sentry, not
 * put in analytics.** That is why the failure path below shows a fixed sentence rather than
 * the error's own message — a backend message can quote the row it refused.
 *
 * Allergies are deliberately absent. They are tier S and `fetchRecipients` does not even ask
 * the database for them; a screen that draws a name and a class has no reason to hold health
 * data about a minor.
 *
 * ## Signed out is empty, not a wall
 *
 * `fetchRecipients` answers with an empty list when there is no session, so this reads as
 * "you have not added anyone yet" with the invitation to do it. `AR7` says adding a child
 * must not be a wall in front of the app, and a sign-in screen thrown up on arrival here
 * would be exactly that.
 *
 * ## Changing school, and the one refusal that is not a failure
 *
 * A row opens the same `Sheet` + `SchoolPicker` the add-a-child form uses, so "which school"
 * is answered the same way everywhere and the onboarded-only list is enforced in one place.
 *
 * `changeRecipientSchool` can refuse with `future_orders_exist`, and that refusal is shown as
 * itself rather than as "something went wrong" (`D19`). Those lunches were bought against the
 * old school's kitchen, its menu and its prices; there is nothing this screen can do about
 * them, and the only way forward is for the parent to go and cancel those days first. A
 * generic failure would leave them tapping the same school again.
 */
export function ChildrenScreen({
  onAddChild,
  reloadToken,
  testID = 'screen-children',
}: {
  onAddChild: () => void;
  /**
   * Changes to ask for a fresh read. The route wrapper bumps it whenever the screen comes
   * back into focus, because the usual reason it was left is that a child was being added —
   * and a stack screen stays mounted underneath the form it pushed, so nothing else would
   * make the new child appear.
   *
   * A token rather than a `refresh()` callback: the caller says *when*, this screen keeps
   * ownership of *how*, and there is no handle a parent component could use to fetch twice.
   */
  reloadToken?: unknown;
  testID?: string;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [children, setChildren] = useState<api.ApiRecipient[]>([]);
  const [attempt, setAttempt] = useState(0);

  // The child whose school is being changed, held as a whole row rather than an id: the sheet
  // has to name them, and looking the id back up would go stale the moment the list reloads.
  const [moving, setMoving] = useState<api.ApiRecipient | null>(null);
  const [movingFailure, setMovingFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setState('loading');

    api
      .fetchRecipients()
      .then((rows) => {
        if (!live) return;
        setChildren(rows);
        setState('ready');
      })
      .catch(() => {
        // The error itself is swallowed on purpose. An RLS refusal or a PostgREST failure can
        // quote the row it refused, and that row is a child (§13.3). The sentence below is
        // fixed for that reason, not for tidiness.
        if (!live) return;
        setState('error');
      });

    return () => {
      live = false;
    };
  }, [attempt, reloadToken]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const moveTo = useCallback(
    async (school: { schoolId: string; schoolName: string }) => {
      if (moving === null) return;
      const child = moving;
      setMoving(null);
      setMovingFailure(null);

      try {
        await api.changeRecipientSchool({ recipientId: child.id, schoolId: school.schoolId });
        // Re-read rather than patching the row in place. The server may have cleared the
        // class as part of the move — a class at the old school does not mean anything at the
        // new one — so the list this screen holds is no longer what the database says.
        setAttempt((n) => n + 1);
      } catch (error) {
        setMovingFailure(refusalMessage(error));
      }
    },
    [moving],
  );

  if (state === 'error') {
    return (
      <View style={styles.screen} testID={`${testID}-error`}>
        <ErrorState
          body="We could not load your children just now. Check your connection and try again."
          onRetry={retry}
        />
      </View>
    );
  }

  if (state === 'loading') {
    return (
      <View style={styles.screen} testID={`${testID}-loading`}>
        {/* Sized to the real rows so nothing jumps when the list lands (`S5`). */}
        {[0, 1].map((i) => (
          <View key={i} style={styles.skeletonRow}>
            <Skeleton width="60%" height={scale.bodyStrong.lineHeight} />
            <Skeleton width="80%" height={scale.bodySm.lineHeight} />
          </View>
        ))}
      </View>
    );
  }

  if (children.length === 0) {
    return (
      <View style={styles.screen} testID={`${testID}-empty`}>
        <EmptyState
          title="No children yet"
          body="Add your child and we will know whose lunch is whose — their name, their class and their school is all we need."
          actionLabel="Add a child"
          onAction={onAddChild}
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID={testID}>
      <Text style={styles.title} accessibilityRole="header">
        Your children
      </Text>

      {/* `EmptyState`, not `ErrorState`, and that is the difference between the two
          components rather than a stylistic choice: `ErrorState` requires a retry, and the
          refusal that matters most here — `future_orders_exist` — is precisely the one that
          retrying cannot fix. Offering "Try again" against it would be a lie in a button. */}
      {movingFailure !== null ? (
        <EmptyState
          title="We could not move them"
          body={movingFailure}
          actionLabel="Close"
          onAction={() => setMovingFailure(null)}
          testID={`${testID}-move-error`}
        />
      ) : null}

      <View style={styles.list}>
        {children.map((child) => {
          // Spread rather than passed as `undefined`: `exactOptionalPropertyTypes` treats an
          // absent prop and one holding `undefined` as different types, and an empty string
          // would draw a blank second line under the name.
          const subtitle = placement(child);
          return (
            <ListRow
              key={child.id}
              title={fullName(child)}
              {...(subtitle === '' ? {} : { subtitle })}
              // A co-guardian who may see but not edit gets a row that does nothing rather
              // than a button that fails at the server. `canManage` comes off the
              // `guardian_link`, which is where the answer lives ([AZ-05], `D10`).
              {...(child.canManage ? { onPress: () => setMoving(child) } : {})}
              testID={`${testID}-${child.id}`}
            />
          );
        })}
      </View>

      <Button
        label="Add another child"
        variant="secondary"
        onPress={onAddChild}
        testID={`${testID}-add`}
      />

      <Sheet
        visible={moving !== null}
        onDismiss={() => setMoving(null)}
        // The child's first name only. A sheet title is the most quotable string on the
        // screen and this one names a minor (§13.3) — the surname buys nothing here, because
        // the parent has just tapped the row.
        title={moving === null ? 'Which school?' : `Move ${moving.firstName} to which school?`}
        testID={`${testID}-school-sheet`}
      >
        <SchoolPicker testID={`${testID}-school-picker`} onSelect={moveTo} />
      </Sheet>
    </ScrollView>
  );
}

/**
 * What to put in front of a parent when a move is refused.
 *
 * **`future_orders_exist` is the one that must survive** (`D19`). Those lunches were bought
 * against the old school's kitchen, its menu and its prices, and nothing this screen can do
 * will move them — the parent has to go and cancel those days first. Collapsed into
 * "something went wrong", they would tap the same school again and get the same nothing.
 *
 * The rule for the rest is narrower than it looks: a message is only shown when the failure
 * carried a `code`. The Edge Function maps a known guard to a curated, parent-facing sentence
 * and turns everything else into a generic 500 — so a `code` is the marker of a string that
 * was written to be read, and its absence is the marker of one that may quote whatever the
 * database was refusing. That row is a child (non-negotiable #4).
 */
export function refusalMessage(error: unknown): string {
  const code = error instanceof api.ApiError ? error.code : undefined;
  const message = error instanceof Error ? error.message : '';

  if (code === 'future_orders_exist') {
    // The server's own sentence already says what to do — "Cancel those days first, then
    // change the school" — so it is shown rather than paraphrased. The fallback exists
    // because a refusal with no body would otherwise lose the only actionable part of it.
    return message !== ''
      ? message
      : 'There are orders for this child that have not been delivered yet. Cancel those days first, then change the school.';
  }
  if (code !== undefined && message !== '') return message;
  return 'We could not change their school just now. Please try again.';
}

/** Both names when there are two, because two children in a class can share a first name. */
export function fullName(child: api.ApiRecipient): string {
  return child.lastName === null ? child.firstName : `${child.firstName} ${child.lastName}`;
}

/**
 * "Class 5A · Alpha Public School", degrading a part at a time.
 *
 * A child with no class is still a child the parent needs to see — the class is optional at
 * creation and `[DM-08]` keeps it free text — so a missing part drops out of the sentence
 * rather than leaving "Class undefined" or hiding the row.
 */
export function placement(child: api.ApiRecipient): string {
  const klass =
    child.classLabel === null
      ? null
      : `Class ${child.classLabel}${child.sectionLabel ?? ''}`;
  const school = child.schoolName === '' ? null : child.schoolName;
  return [klass, school].filter((part) => part !== null).join(' · ');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  content: { padding: layout.gutter, gap: space[4] },
  title: {
    color: text.primary,
    fontSize: scale.h2.size,
    lineHeight: scale.h2.lineHeight,
    fontWeight: scale.h2.weight,
  },
  list: { gap: space[1] },
  skeletonRow: {
    paddingHorizontal: layout.gutter,
    paddingVertical: space[3],
    gap: space[2],
  },
});
