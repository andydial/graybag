import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronRight } from 'lucide-react-native';
import { api, design } from '@graybag/shared';

import { Button, EmptyState, ErrorState, Sheet, Skeleton } from '../components';
import { SchoolPicker } from '../menu/SchoolPicker';
import { EditChildSheet } from './EditChildSheet';
import { useOrderingTarget } from '../session/audience';
import { useRecipients } from '../session/useRecipients';
import { useSession } from '../session/SessionContext';
import { EmptyStateDiagnostic } from '../components/EmptyStateDiagnostic';

const {
  bg, text, border, action, space, radius, borderWidth, scale, layout, touchTarget, icon,
} = design;

/**
 * "Who you order for" — the list `E05-01` was missing, drawn to `docs/ux-spec.md` §5.16 and
 * the prototype at `#children,signedin`.
 *
 * Adding a recipient worked and then they vanished: there was nothing that listed them, so a
 * parent had no way to see what they had entered, no way to correct it, and no way to tell
 * whether the add had worked at all. Everything downstream — ordering for someone, moving them
 * to another school (`E05-02`) — starts from a row on this screen.
 *
 * ## Recipient-neutral, because an adult may be the recipient
 *
 * `P13`: an adult can buy their own lunch — school staff and university students did it in the
 * legacy app and the rebuild had dropped them by omission. So the copy here never says "child"
 * about the list as a whole, and a row whose recipient **is** the signed-in adult reads *You*
 * rather than their own name.
 *
 * Since `E05-38` the screen also **offers it**: "Order for myself" is a first-class action, not
 * a sentence inside the add form, and it disappears once the adult is on the list because the
 * server refuses a second self recipient. Until then the neutral wording was the whole of the
 * feature — an honest description of something a parent had no way to do.
 *
 * ## One guardian per recipient (`AR8`)
 *
 * There is no read-only row, no permission UI and no second-guardian invite. `can_manage` stays
 * in the schema defaulted true and this screen does not branch on it: a row that draws an Edit
 * affordance for one parent and withholds it for another is a co-guardian surface, and there
 * are no co-guardians in v1.
 *
 * ## Everything on it is regulated data
 *
 * First name, last name, class, section, school and allergies are tier P/S under DPDP (§13.3,
 * non-negotiable #4). They are **drawn and nothing else**: not logged, not sent to Sentry, not
 * put in analytics. That is why every failure path below shows a fixed sentence rather than the
 * error's own message — a backend message can quote the row it refused.
 *
 * ## The four empties are four different screens (§5.21)
 *
 * `ChildrenState` is a closed union and the render exhausts it against `never`, so a sixth
 * state cannot be added without the compiler asking what it looks like. The distinction that
 * matters most is `empty` against `unreachable`: "you have not added anyone" shown to a parent
 * whose read failed is a lie that reads as data loss, and it is the exact defect that cost
 * three hours on the menu.
 */

/**
 * A row of this list.
 *
 * Extends `api.ApiRecipient` with the things the design draws that `fetchRecipients` does not
 * return — the break label (`E05-29`, the same gap `OrderForBlock` has) and the allergy summary
 * (tier S: `RECIPIENT_COLUMNS` deliberately does not ask for it). They are **optional and never
 * invented**: an absent allergy summary renders as "we hold nothing", never as reassurance
 * (§5.21, `F5`/`F6`).
 *
 * `isSelf` **used to be one of them** and is not any more: `E05-38` put `is_self` in
 * `RECIPIENT_COLUMNS`, so it arrives with the row and is required rather than optional. That
 * matters beyond tidiness — while it was optional, every row this screen actually received had
 * it `undefined`, so the self rendering below was code no real data could reach.
 */
export interface RecipientRow extends api.ApiRecipient {
  /** "Morning break · 10:40". Absent until the break is resolvable; never guessed. */
  breakLabel?: string | null;
  /** Declared allergen names. Health data about a minor — drawn, never logged. */
  allergens?: readonly string[];
  /** Whether the optional health-data consent (`C12`, `C5`) was given at all. */
  allergenConsent?: boolean;
}

/**
 * The five states §5.16 lists, as a closed union.
 *
 * `empty` and `unreachable` are separate members rather than `rows.length === 0` plus a flag,
 * because the whole point of §5.21 is that a screen which *cannot* tell them apart will
 * eventually render one as the other.
 */
export type ChildrenState =
  | { kind: 'loading' }
  | { kind: 'loaded'; rows: readonly RecipientRow[] }
  | { kind: 'empty' }
  /**
   * §5.21 N3 — "you cannot see this", which is not N1's "there is nothing here". The old code
   * conflated them and the comment on `empty` said a signed-out parent lands there too; that is
   * how a list of children and a list of nobody became the same screen, and why nothing noticed
   * when the signed-out case started showing real names.
   */
  | { kind: 'signedOut' }
  | { kind: 'unreachable' }
  | { kind: 'error' };

export function ChildrenScreen({
  onSignIn,
  onAddChild,
  onOrderForSelf,
  onSelectRecipient,
  reloadToken,
  testID = 'screen-children',
}: {
  onAddChild: () => void;
  /**
   * "Order for myself" — `E05-38`. Opens the same form with the question already answered.
   *
   * Optional, and falls back to `onAddChild`. The fallback is not a placeholder: the form asks
   * who it is for as its first question, so the worst a missing wire does is ask something the
   * person has just answered. A route that forgot it degrades to one extra tap rather than to
   * a button that does nothing.
   */
  onOrderForSelf?: () => void;
  /**
   * Choose who the next order is for. Optional, and **not wired yet on purpose**: setting the
   * order target needs the recipient's allergen ids as well as their id (`OrderTarget`), and
   * this screen does not hold them — sending `[]` would silently turn the add-to-cart allergy
   * warning off for that recipient, which is the one failure `F5`/`F6` forbid outright.
   *
   * Until a caller passes it, a row press opens the same edit path the Edit affordance does,
   * so the largest target on the row still does something a parent expects.
   */
  onSelectRecipient?: (recipientId: string) => void;
  /**
   * Changes to ask for a fresh read. The route wrapper bumps it whenever the screen comes
   * back into focus, because the usual reason it was left is that someone was being added —
   * and a stack screen stays mounted underneath the form it pushed, so nothing else would
   * make the new row appear.
   *
   * A token rather than a `refresh()` callback: the caller says *when*, this screen keeps
   * ownership of *how*, and there is no handle a parent component could use to fetch twice.
   */
  reloadToken?: unknown;
  /** Where the N3 state goes. Without a session this screen has no account to describe. */
  onSignIn?: (() => void) | undefined;
  testID?: string;
}) {

  // The recipient whose school is being changed, held as a whole row rather than an id: the
  // sheet has to name them, and looking the id back up would go stale the moment the list
  // reloads.
  const [editing, setEditing] = useState<RecipientRow | null>(null);
  const [editFailure, setEditFailure] = useState<string | null>(null);
  /**
   * Which sheet the row's Edit opens — `E05-37`.
   *
   * `'details'` is the ordinary case and the default: a name, a class, a section. `'school'` is
   * the move, reached from inside the details sheet, because it has a future-order guard and
   * resets the class and is not a fourth field.
   */
  const [editMode, setEditMode] = useState<'details' | 'school'>('details');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Display only. The tick says which recipient the app is currently ordering for; nothing
  // here writes it, for the reason on `onSelectRecipient`. Via the audience, so there is no
  // tick — and no list — without a session.
  const { status: sessionStatus } = useSession();
  const target = useOrderingTarget();
  const selectedId = target === null ? null : target.recipientId;

  /**
   * **Through `useRecipients`, never `api.fetchRecipients` directly.**
   *
   * This screen used to run its own read here, and that is how a minor's name stayed on screen
   * after `E03-26` supposedly closed the disclosure: `fetchRecipients` gates on the *keychain*
   * session, this screen gated on nothing, and the guard that shipped only ever inspected the
   * order-target context. One door now, and it consults the app's session before it opens.
   */
  const recipients = useRecipients();

  // `reloadToken` changes when the screen is re-focused, so a child added elsewhere appears.
  // Only on the token. `reload` is stable, and `recipients` is a fresh object each render, so
  // depending on it here would loop — which it did, once, straight into an out-of-memory crash.
  const reload = recipients.reload;
  useEffect(() => {
    reload();
  }, [reloadToken, reload]);

  /**
   * **Derived, not mirrored.** Copying this into `useState` inside an effect is what made the
   * first attempt loop forever: `useRecipients` returns a fresh object each render, so listing it
   * as a dependency re-ran the effect, which set state, which re-rendered. There is no second
   * source of truth to keep in step here — the read already has the state, so this just names it
   * in the vocabulary the screen renders.
   */
  const state: ChildrenState = useMemo(() => {
    switch (recipients.kind) {
      case 'loading':
        return { kind: 'loading' };
      case 'signedOut':
        // Not 'empty'. "You have nobody yet" describes an account we can see; this is an account
        // we cannot. §5.21 N3 against N1.
        return { kind: 'signedOut' };
      case 'ready':
        return recipients.rows.length === 0
          ? { kind: 'empty' }
          : { kind: 'loaded', rows: recipients.rows as RecipientRow[] };
      case 'failed':
        // Only the error's *shape* is read, never its text: an RLS refusal can quote the row it
        // refused, and that row is a person (§13.3).
        return { kind: classifyReadFailure(recipients.error) };
    }
  }, [recipients.kind, recipients.kind === 'ready' ? recipients.rows : null, recipients.kind === 'failed' ? recipients.error : null]);

  const retry = recipients.reload;

  /**
   * Where "Order for myself" goes when it is not wired. See the prop.
   */
  const addSelf = onOrderForSelf ?? onAddChild;

  /**
   * Whether to offer "Order for myself" at all — `E05-38`.
   *
   * **Hidden once the adult is on the list**, because `create_recipient` refuses a second self
   * recipient (`self_recipient_exists`, `0022`) and an entry point that always ends in a
   * refusal is worse than no entry point: it teaches that the button is broken rather than
   * that the thing is already done.
   *
   * Computed from the rows rather than from a separate read. `is_self` arrives on every row
   * since `E05-38`, and one list that answers both "who do I order for" and "am I on it" cannot
   * disagree with itself the way two reads would.
   */
  const hasSelf = state.kind === 'loaded' && state.rows.some((row) => row.isSelf);

  const moveTo = useCallback(
    async (school: { schoolId: string; schoolName: string }) => {
      if (editing === null) return;
      const recipient = editing;
      setEditing(null);
      setEditFailure(null);

      try {
        await api.changeRecipientSchool({ recipientId: recipient.id, schoolId: school.schoolId });
        // Re-read rather than patching the row in place. The server may have cleared the
        // class as part of the move — a class at the old school does not mean anything at the
        // new one — so the list this screen holds is no longer what the database says.
        recipients.reload();
      } catch (error) {
        setEditFailure(refusalMessage(error));
      }
    },
    [editing, recipients],
  );

  /** Open the details sheet. Always resets the mode — a previous move must not leak into it. */
  const openEditor = useCallback((recipient: RecipientRow) => {
    setEditMode('details');
    setEditFailure(null);
    setEditing(recipient);
  }, []);

  /**
   * Correct a name, class or section — `E05-43`.
   *
   * Re-reads rather than patching the row in place, for the same reason `moveTo` does: the
   * server is the one that decides what the row now says, and a list patched from the request
   * rather than the response is a list that disagrees with the database the moment a rule fires.
   */
  const saveDetails = useCallback(
    async (edit: {
      firstName: string;
      classLabel: string | null;
      sectionLabel: string | null;
      clearSection: boolean;
    }) => {
      if (editing === null) return;
      setSaving(true);
      setEditFailure(null);
      try {
        await api.updateRecipientDetails({ recipientId: editing.id, ...edit });
        setEditing(null);
        recipients.reload();
      } catch (error) {
        setEditFailure(refusalMessage(error, 'save'));
      } finally {
        setSaving(false);
      }
    },
    [editing, recipients],
  );

  /**
   * Remove, which since `0026` also erases — `E05-44`, `E20-30`.
   *
   * The sheet closes only on success. A failed removal that dismissed itself would leave a
   * parent believing a child had gone, and the commonest failure here is the future-order
   * guard, which is guidance rather than an error: there is something they can do about it.
   */
  const removeChild = useCallback(async () => {
    if (editing === null) return;
    setRemoving(true);
    setEditFailure(null);
    try {
      await api.removeRecipient(editing.id);
      setEditing(null);
      recipients.reload();
    } catch (error) {
      setEditFailure(refusalMessage(error, 'remove'));
    } finally {
      setRemoving(false);
    }
  }, [editing, recipients]);

  switch (state.kind) {
    case 'loading':
      return (
        <View style={[styles.screen, styles.content]} testID={`${testID}-loading`}>
          {/* The title is drawn now rather than when the rows land, so it does not move. */}
          <Text style={styles.title} accessibilityRole="header">
            Who you order for
          </Text>
          {/* Sized to the real rows so nothing jumps when the list lands (`S5`). */}
          <View style={styles.list}>
            {[0, 1].map((i) => (
              <View key={i} style={styles.skeletonRow}>
                <Skeleton width={AVATAR} height={AVATAR} />
                <View style={styles.skeletonText}>
                  <Skeleton width="55%" height={scale.bodyStrong.lineHeight} />
                  <Skeleton width="75%" height={scale.bodySm.lineHeight} />
                  <Skeleton width="45%" height={scale.bodySm.lineHeight} />
                </View>
              </View>
            ))}
          </View>
        </View>
      );

    case 'unreachable':
      // N2 — **not** an empty list. The read failed; nothing is wrong with their data, and
      // saying "you have not added anyone" here would be a lie that reads as data loss.
      return (
        <View style={styles.screen} testID={`${testID}-unreachable`}>
          <ErrorState
            title="We can’t reach GrayBag right now"
            body="We couldn’t load this list — that’s us, not your account. Check your connection and try again."
            onRetry={retry}
          />
        </View>
      );

    case 'error':
      return (
        <View style={styles.screen} testID={`${testID}-error`}>
          <ErrorState
            body="We could not load this list just now. Check your connection and try again."
            onRetry={retry}
          />
        </View>
      );

    case 'signedOut':
      // Not a wall (`AR7`): browsing never needed a session and still does not. But *this*
      // screen is a list of people on an account, and without a session there is no account to
      // list. Offering sign-in is the honest next step, not "add someone" — which cannot
      // complete without a session either.
      return (
        <View style={styles.screen} testID={`${testID}-signedout`}>
          <EmptyState
            title="Sign in to see who you order for"
            body="Your children — or you — live on your account. Browsing the menu never needs one."
            actionLabel="Sign in"
            {...(onSignIn === undefined ? {} : { onAction: onSignIn })}
          />
          <EmptyStateDiagnostic
            testID="children-signedout-diagnostic"
            facts={[
              { label: 'session', value: sessionStatus },
              { label: 'read', value: 'refused: no session' },
            ]}
          />
        </View>
      );

    case 'empty':
      // N1 — an invitation, not a failure. Reached only with a session, so this genuinely means
      // the account has nobody on it yet.
      return (
        <View style={styles.screen} testID={`${testID}-empty`}>
          <EmptyState
            title="Nobody added yet"
            body="Add whoever the lunch is for — your child, or yourself. A name and a school is all we need to start."
            actionLabel="Add someone"
            onAction={onAddChild}
          />
          {/*
            `E05-38`. The empty account is where the "am I supposed to add myself as a child?"
            confusion actually happens — the body sentence has said "or yourself" for a while
            and a member of staff still had nothing to tap that said so. An account with nobody
            on it has no self recipient by definition, so this is always offered here.
          */}
          <Button
            label="Order for myself"
            variant="secondary"
            onPress={addSelf}
            testID={`${testID}-empty-self`}
          />
          {/*
            "Nobody added yet" is a claim about an account. It is also what this screen showed
            for a signed-out visitor until `E03-27` split the two apart, so the facts stay on
            screen where the distinction can be checked rather than trusted.
          */}
          <EmptyStateDiagnostic
            testID="children-empty-diagnostic"
            facts={[
              { label: 'session', value: sessionStatus },
              { label: 'rows', value: 0 },
              { label: 'query', value: 'guardian_link+recipient' },
            ]}
          />
        </View>
      );

    case 'loaded':
      return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID={testID}>
          <Text style={styles.title} accessibilityRole="header">
            Who you order for
          </Text>

          {/* `EmptyState`, not `ErrorState`, and that is the difference between the two
              components rather than a stylistic choice: `ErrorState` requires a retry, and the
              refusal that matters most here — `future_orders_exist` — is precisely the one that
              retrying cannot fix. Offering "Try again" against it would be a lie in a button. */}
          {editFailure !== null ? (
            <EmptyState
              title="We could not move them"
              body={editFailure}
              actionLabel="Close"
              onAction={() => setEditFailure(null)}
              testID={`${testID}-move-error`}
            />
          ) : null}

          <View style={styles.list}>
            {state.rows.map((recipient, index) => (
              <RecipientListRow
                key={recipient.id}
                recipient={recipient}
                selected={recipient.id === selectedId}
                last={index === state.rows.length - 1}
                onPress={
                  onSelectRecipient === undefined
                    ? () => openEditor(recipient)
                    : () => onSelectRecipient(recipient.id)
                }
                onEdit={() => openEditor(recipient)}
                testID={`${testID}-${recipient.id}`}
              />
            ))}
          </View>

          {/*
            `E05-38`, and **first-class rather than a line inside the add form**: a member of
            staff who orders their own lunch is not "someone else". It sits above Add someone
            else because for the person who needs it, it is the primary action on the screen.

            Gone once they are on the list — `hasSelf`. The server refuses a second self
            recipient, so leaving it would be a button whose only outcome is a refusal.
          */}
          {hasSelf ? null : (
            <Button
              label="Order for myself"
              variant="secondary"
              onPress={addSelf}
              testID={`${testID}-add-self`}
            />
          )}

          <Button
            label="Add someone else"
            variant="secondary"
            onPress={onAddChild}
            testID={`${testID}-add`}
          />

          {/* Only when choosing actually does something. The prototype's footnote describes a
              consequence — switching who you order for switches the school and the menu — and
              printing it while the rows cannot be chosen would describe behaviour the build
              does not have. */}
          {onSelectRecipient === undefined ? null : (
            <Text style={styles.footnote} testID={`${testID}-switch-note`}>
              Who you order for decides the school and the menu you see.
            </Text>
          )}

          <Sheet
            visible={editing !== null}
            onDismiss={() => setEditing(null)}
            // The first name only, or "you". A sheet title is the most quotable string on the
            // screen and this one may name a minor (§13.3) — the surname buys nothing here,
            // because the parent has just tapped the row.
            title={
              editing === null
                ? 'Edit'
                : editMode === 'school'
                  ? `Move ${editing.isSelf ? 'yourself' : editing.firstName} to which school?`
                  : `Edit ${editing.isSelf ? 'your details' : editing.firstName}`
            }
            testID={`${testID}-${editMode === 'school' ? 'school' : 'edit'}-sheet`}
          >
            {editing === null ? null : editMode === 'school' ? (
              <SchoolPicker
                // Embedded in a sheet that already has its own title — the welcome panel
                // belongs only on the standalone screen (§6.1.1 cut 1).
                welcome={false}
                testID={`${testID}-school-picker`}
                onSelect={moveTo}
              />
            ) : (
              <EditChildSheet
                // Keyed on the row, so opening a different child does not inherit the last
                // one's half-typed class in the field state.
                key={editing.id}
                // `isSelf` is required on both sides now (`E05-38`), so there is nothing left
                // to default. It decides whether the copy says "you" or a child's name, on the
                // screen that erases data — a flag that could be forgotten was the wrong shape
                // for that.
                recipient={editing}
                onSave={saveDetails}
                onMoveSchool={() => {
                  setEditFailure(null);
                  setEditMode('school');
                }}
                onRemove={removeChild}
                saving={saving}
                removing={removing}
                error={editFailure}
                testID={`${testID}-edit`}
              />
            )}
          </Sheet>
        </ScrollView>
      );

    default: {
      // §5.21's mechanism, not a formality: a screen that cannot render `unreachable` as
      // something distinct from `empty` must fail to compile rather than fail in production.
      const exhausted: never = state;
      return exhausted;
    }
  }
}

/**
 * One row: avatar, who, where, when, allergies, Edit, and a tick when this is the recipient
 * the app is currently ordering for.
 *
 * Exported so the presentation of a self row and of an allergy line can be rendered directly
 * in a test — `fetchRecipients` cannot yet produce either (see `RecipientRow`), and a design
 * that is only exercised through a transport that strips the fields is a design nothing tests.
 *
 * Built here rather than from `ListRow`, which has no leading slot and one subtitle line.
 */
export function RecipientListRow({
  recipient,
  selected = false,
  last = false,
  onPress,
  onEdit,
  testID = 'recipient-row',
}: {
  recipient: RecipientRow;
  selected?: boolean;
  last?: boolean;
  onPress: () => void;
  onEdit: () => void;
  testID?: string;
}) {
  const who = displayName(recipient);
  const allergy = allergyLine(recipient);

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      // One label for the whole row. A screen reader stopping separately on the name, the
      // school and the break is three times the work for one row of information. The allergy
      // line is in it because it is the part a parent most needs to hear.
      accessibilityLabel={[who, placement(recipient), allergy?.text].filter(Boolean).join(', ')}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.row,
        last ? null : styles.rowDivided,
        selected && styles.rowSelected,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarInitial} allowFontScaling={false}>
          {initial(who)}
        </Text>
      </View>

      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{headline(recipient)}</Text>
        {recipient.schoolName === '' ? null : (
          <Text style={styles.rowMeta}>{recipient.schoolName}</Text>
        )}
        {/* Omitted rather than guessed when it is unknown — the same rule `OrderForBlock`
            follows. A plausible break a parent believes is worse than no break at all. */}
        {recipient.breakLabel === undefined || recipient.breakLabel === null ? null : (
          <Text style={styles.rowMeta} testID={`${testID}-break`}>
            {recipient.breakLabel}
          </Text>
        )}
        {allergy === null ? null : (
          <Text
            style={allergy.tone === 'alert' ? styles.allergyAlert : styles.allergyMuted}
            testID={`${testID}-allergies`}
          >
            {allergy.text}
          </Text>
        )}
      </View>

      <Pressable
        onPress={onEdit}
        testID={`${testID}-edit`}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${who}`}
        hitSlop={space[2]}
        style={styles.edit}
      >
        <Text style={selected ? styles.editLabelOnSelected : styles.editLabel}>Edit</Text>
      </Pressable>

      {/* The state is on the row already (`accessibilityState.selected`); an icon that
          announced it too would say it twice. But it must not be colour alone — the tick is
          the shape that carries it visually (§2.10). */}
      <View
        testID={`${testID}-${selected ? 'selected' : 'chevron'}`}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {selected ? (
          <Check size={icon.size.md} color={text.onTonal} strokeWidth={icon.stroke.large} />
        ) : (
          <ChevronRight size={icon.size.md} color={text.tertiary} strokeWidth={icon.stroke.default} />
        )}
      </View>
    </Pressable>
  );
}

/**
 * Which of the two failure screens a read failure gets — §5.21's N2 against everything else.
 *
 * **Only the shape of the error is read, never its text**, because a PostgREST message can
 * quote the row it refused and that row is a person (§13.3).
 *
 * A backend that answered and refused carries a provider `code` — `42501` for an RLS refusal,
 * a `PGRST…` for a malformed request — and that is a defect on our side, not a connection the
 * parent can do anything about. Nothing answering at all (no client configured, DNS, a dropped
 * connection) arrives with no code, and that is `unreachable`: retry is the honest advice and
 * their data is fine.
 */
export function classifyReadFailure(error: unknown): 'unreachable' | 'error' {
  if (error instanceof api.ApiNotConfiguredError) return 'unreachable';
  // A payload we could read and could not understand. The backend answered.
  if (error instanceof api.RecipientPayloadError) return 'error';
  if (error instanceof api.ApiError) {
    return error.code === undefined || error.code === '' ? 'unreachable' : 'error';
  }
  return 'unreachable';
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
 * database was refusing. That row is a person (non-negotiable #4).
 */
export function refusalMessage(
  error: unknown,
  /** Which action was refused. The same server code needs different advice per action. */
  action: 'move' | 'save' | 'remove' = 'move',
): string {
  const code = error instanceof api.ApiError ? error.code : undefined;
  const message = error instanceof Error ? error.message : '';

  if (code === 'future_orders_exist') {
    /**
     * **Guidance, not an error** (`E05-37`). There is undelivered food already paid for, and
     * the parent can do something about it — so this says what, rather than reporting a
     * failure and stopping.
     *
     * The server's sentence is written for the *move* case ("then change the school"), so it
     * is used only there. Reusing it under Remove would tell a parent to change a school they
     * were not changing — and after `0026` the refusal is doing more work than it was: it is
     * the only thing standing between a mistaken tap and a child's details being erased while
     * their lunch is still on Friday's list.
     */
    if (action === 'remove') {
      return 'There is food ordered for this person that hasn’t been delivered yet. Cancel those days first, then you can remove them.';
    }
    if (action === 'save') {
      // The server does not guard edits this way today. If that changes, a parent should not
      // be told to cancel lunches in order to fix a section label.
      return 'We couldn’t save that just now. Please try again.';
    }
    return message !== ''
      ? message
      : 'There are orders for this person that have not been delivered yet. Cancel those days first, then change the school.';
  }

  if (code === 'first_name_required') {
    return 'Please enter a first name.';
  }
  if (code === 'recipient_not_found') {
    return action === 'remove'
      ? 'They’ve already been removed.'
      : 'That person is no longer available.';
  }

  if (code !== undefined && message !== '') return message;

  switch (action) {
    case 'remove':
      return 'We could not remove them just now. Please try again.';
    case 'save':
      return 'We could not save those changes just now. Please try again.';
    case 'move':
      return 'We could not change their school just now. Please try again.';
  }
}

/** Both names when there are two, because two children in a class can share a first name. */
export function fullName(recipient: RecipientRow): string {
  return recipient.lastName === null
    ? recipient.firstName
    : `${recipient.firstName} ${recipient.lastName}`;
}

/**
 * "You" for the adult's own row (`P13`), their name otherwise.
 *
 * An adult who has added themselves knows who they are; printing their own name back at them
 * reads like a record of someone else, which is exactly the confusion the self row exists to
 * remove.
 */
export function displayName(recipient: RecipientRow): string {
  return recipient.isSelf ? 'You' : fullName(recipient);
}

/**
 * "Class 5-A", degrading a part at a time, and absent entirely for the adult's own row —
 * an adult buying their own lunch has no class, and "Class undefined" is worse than nothing.
 *
 * The class is optional at creation and `[DM-08]` keeps it free text, so a missing part drops
 * out of the sentence rather than leaving a placeholder or hiding the row.
 */
export function classLine(recipient: RecipientRow): string | null {
  if (recipient.isSelf || recipient.classLabel === null) return null;
  const section = recipient.sectionLabel === null ? '' : `-${recipient.sectionLabel}`;
  return `Class ${recipient.classLabel}${section}`;
}

/** "Ishaan Mehta · Class 5-A" — the row's first line. */
export function headline(recipient: RecipientRow): string {
  const klass = classLine(recipient);
  return klass === null ? displayName(recipient) : `${displayName(recipient)} · ${klass}`;
}

/** "Class 5-A · Alpha Public School" — for the accessible label, which is read as one line. */
export function placement(recipient: RecipientRow): string {
  return [classLine(recipient), recipient.schoolName === '' ? null : recipient.schoolName]
    .filter((part) => part !== null)
    .join(' · ');
}

/** The avatar's letter. `Array.from` because a name may begin with a surrogate pair. */
export function initial(who: string): string {
  return (Array.from(who)[0] ?? '').toUpperCase();
}

export type AllergyLine = { tone: 'alert' | 'muted'; text: string } | null;

/**
 * The allergy line, in the only three renderings that are honest (§5.21, `F5`/`F6`).
 *
 * **Declared allergens** are drawn in red, because they are the reason a parent scans this
 * list. **Consent given and nothing declared** draws no line: that absence was verified.
 * **Everything else — no consent, or a screen that simply does not hold the answer — says so
 * in words.** Silence there would be a safety claim we never checked, and a claim about a
 * minor's health is the one place this product cannot afford to imply anything.
 */
export function allergyLine(recipient: RecipientRow): AllergyLine {
  const allergens = recipient.allergens ?? [];
  if (allergens.length > 0) return { tone: 'alert', text: `Allergies: ${allergens.join(', ')}` };
  if (recipient.allergenConsent === true) return null;

  /**
   * **This says what WE have not done, not what the parent failed to do.**
   *
   * It used to read "No allergy details shared", which is a statement about the parent — and
   * it was on every single row, because `fetchRecipients` deliberately does not return allergy
   * data at all (`E05-31`). So the app was telling every parent they had withheld something
   * they may well have entered, on the strength of a read it never performed.
   *
   * `allergenConsent === false` is the only case where "they chose not to" is true, and we
   * cannot currently tell that case from "we did not look" — so the copy covers the honest
   * union of the two and puts the uncertainty on us, where it belongs.
   */
  return {
    tone: 'muted',
    text: 'Allergy details aren’t loaded here yet — we can’t warn you about ingredients',
  };
}

/** The avatar is a token-sized circle; `radius.full` is the scale's own word for "avatar". */
const AVATAR = space[12];

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  content: { padding: layout.gutter, gap: layout.blockGap },
  title: {
    color: text.primary,
    fontSize: scale.h2.size,
    lineHeight: scale.h2.lineHeight,
    fontWeight: scale.h2.weight,
    letterSpacing: scale.h2.tracking,
  },
  list: {
    backgroundColor: bg.surface,
    borderRadius: radius.lg,
    borderWidth: borderWidth.hairline,
    borderColor: border.subtle,
    // So a selected row's fill stops at the rounded corner instead of squaring it off.
    overflow: 'hidden',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: touchTarget.min,
    paddingHorizontal: space[3],
    paddingVertical: layout.listRowPaddingY,
  },
  rowDivided: { borderBottomWidth: borderWidth.hairline, borderBottomColor: border.subtle },
  // Tonal, and never the only marker: the tick carries it as a shape and
  // `accessibilityState.selected` carries it to a screen reader (§2.10).
  rowSelected: { backgroundColor: action.secondaryBg },
  rowPressed: { backgroundColor: bg.surfaceMuted },

  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radius.full,
    backgroundColor: bg.surfaceAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // `text.onAccent` rather than `text.link`: `primary-700` on `lime-200` is 4.09 and fails,
  // which is the substitution `semantic.ts` documents for exactly this ground.
  avatarInitial: {
    color: text.onAccent,
    fontSize: scale.h3.size,
    lineHeight: scale.h3.lineHeight,
    fontWeight: scale.h3.weight,
  },

  rowText: { flex: 1, gap: space[0.5] },
  rowTitle: {
    color: text.primary,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  // `text.secondary`, not `tertiary`: `neutral-600` on the selected row's `primary-100` is
  // 4.13 and fails, and any row can become the selected one.
  rowMeta: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
  allergyAlert: {
    color: text.danger,
    fontSize: scale.label.size,
    lineHeight: scale.label.lineHeight,
    fontWeight: scale.label.weight,
    marginTop: space[1],
  },
  allergyMuted: {
    color: text.secondary,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
    marginTop: space[1],
  },

  edit: {
    minHeight: touchTarget.min,
    justifyContent: 'center',
    paddingHorizontal: space[2],
  },
  editLabel: {
    color: text.link,
    fontSize: scale.label.size,
    lineHeight: scale.label.lineHeight,
    fontWeight: scale.label.weight,
  },
  // On the selected row's tonal fill `text.link` is 4.47 and fails; `text.onTonal` is 8.68.
  editLabelOnSelected: {
    color: text.onTonal,
    fontSize: scale.label.size,
    lineHeight: scale.label.lineHeight,
    fontWeight: scale.label.weight,
  },

  footnote: {
    color: text.secondary,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
  },

  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[3],
    paddingVertical: layout.listRowPaddingY,
  },
  skeletonText: { flex: 1, gap: space[2] },
});
