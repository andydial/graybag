import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

import { BrandHeader } from '../components/Brand';
import { Button } from '../components/Button';
import { ListRow } from '../components/Surfaces';
import { BuildLabel } from '../components/BuildLabel';

const { bg, text, border, space, layout, scale, borderWidth, touchTarget } = design;

/**
 * Account — `docs/ux-spec.md` §5.17, built to `docs/prototype/graybag-prototype.html`
 * at `#account` and `#account,signedin`.
 *
 * **This screen's job is to be a reliable set of doors.** It fetches nothing, decides
 * nothing and owns no session state: every row is a callback the caller supplies, and a row
 * whose callback is absent renders as an inert label rather than disappearing. That is
 * deliberate — the list of things an account *has* should not change shape depending on
 * which of them happen to be wired up yet, because a row that vanishes reads as a feature
 * that was taken away.
 *
 * ## Signed out, sign-in is the primary action
 *
 * The app shipped with **exactly one** route to sign-in and it was behind the cart's Place
 * order button — so a visitor who had not added a child could not fill a cart, and therefore
 * could not reach sign-in at all. One door, behind a wall. Account is where a person
 * actually looks for it, so signed out this screen leads with a full-width primary button
 * and says, underneath it, that browsing needs no account (`AR7`): the invitation is the
 * content, never a gate.
 *
 * ## The policy rows are present signed out too
 *
 * The prototype's signed-out state shows the button alone. The four public rows — privacy,
 * terms, refund, grievance officer — are kept below it because they are the compliance
 * surface both stores require to be reachable **in the app**, and a person who has not
 * signed in is exactly the person most likely to want to read them before they do. Nothing
 * behind them needs a session. The four that do — who you order for, your orders, delete,
 * sign out — are not rendered signed out.
 *
 * ## Recipient-neutral wording
 *
 * "Who you order for", not "Your children". An adult may order for themselves, and every
 * screen that assumes otherwise has to be found and fixed later.
 *
 * ## The email is drawn and nothing else
 *
 * It is displayed, never logged, never passed to Sentry or analytics, and never used as an
 * identifier by anything on this screen (non-negotiable #4, `R6`). It is not `selectable`:
 * the only reason to copy it out is to paste it somewhere it should not go.
 */
export function AccountScreen({
  testID = 'screen-account',
  access = 'pending',
  email = null,
  onSignIn,
  onRecipients,
  onOrders,
  onSupport,
  onPolicy,
  onDeleteAccount,
  onSignOut,
}: {
  testID?: string;
  /**
   * `pending` until the stored session has been read back — see `session/audience.ts`.
   *
   * It used to be `signedOut?: boolean` defaulting to `true`, and that default is the bug Andy
   * saw: this screen offered a Sign in button to somebody who was already signed in, while the
   * cart showed their child. A default must not make a claim.
   */
  access?: import('../session/audience').Access;
  /** Display only. Never logged, never sent anywhere. */
  email?: string | null;
  onSignIn?: () => void;
  onRecipients?: () => void;
  onOrders?: () => void;
  onSupport?: () => void;
  onPolicy?: (which: 'privacy' | 'terms' | 'refund') => void;
  /**
   * Account deletion is a compliance requirement — both stores demand an in-app path — so
   * the row exists here whether or not the flow behind it does. Where it goes is the
   * caller's decision.
   */
  onDeleteAccount?: () => void;
  onSignOut?: () => void;
}) {
  const policy = (which: 'privacy' | 'terms' | 'refund') =>
    onPolicy === undefined ? undefined : () => onPolicy(which);

  return (
    <View style={styles.screen} testID={testID}>
      <BrandHeader />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text style={styles.title} accessibilityRole="header">
            Account
          </Text>
          {/*
            The email as an eyebrow under the title, exactly as the prototype has it — it
            answers "which account am I in" without being a field anybody can act on.
          */}
          <Text style={styles.eyebrow} numberOfLines={1} testID={`${testID}-identity`}>
            {access !== 'signedIn' || email === null || email === '' ? (access === 'pending' ? ' ' : 'Not signed in') : email}
          </Text>
        </View>

        {access === 'pending' ? null : access === 'signedOut' ? (
          <View style={styles.signInBlock}>
            <Button
              label="Sign in"
              onPress={onSignIn ?? noop}
              testID={`${testID}-signin`}
            />
            <Text style={styles.signInNote}>
              You don&rsquo;t need an account to browse the menu or fill your order — we only
              ask when you place it. Signing in keeps your orders, and who you order for.
            </Text>
          </View>
        ) : null}

        <View style={styles.rows}>
          {access !== 'signedIn' ? null : (
            <>
              <Row
                title="Who you order for"
                // The one subtitle on the screen. The prototype's row said "Your children";
                // this one is named for what it holds, and a line of explanation is what
                // stops the rename reading as a different feature.
                subtitle="Children, or yourself"
                onPress={onRecipients}
                testID={`${testID}-recipients`}
              />
              <Row title="Your orders" onPress={onOrders} testID={`${testID}-orders`} />
            </>
          )}

          <Row title="Privacy policy" onPress={policy('privacy')} testID={`${testID}-privacy`} />
          <Row title="Terms of use" onPress={policy('terms')} testID={`${testID}-terms`} />
          <Row title="Refund policy" onPress={policy('refund')} testID={`${testID}-refund`} />
          <Row title="Grievance officer" onPress={onSupport} testID={`${testID}-support`} />

          {access !== 'signedIn' ? null : (
            <>
              <DangerRow
                title="Delete my account"
                onPress={onDeleteAccount}
                testID={`${testID}-delete`}
              />
              <Row title="Sign out" onPress={onSignOut} testID={`${testID}-signout`} />
            </>
          )}
        </View>

        {/*
          Which build this is, in words, at the foot of the one screen a person can always
          reach. Two bug reports have already been chased against the wrong binary because
          nothing on screen said which one it was — so this is never hidden behind `__DEV__`,
          which would remove it from exactly the builds whose identity is hardest to
          establish afterwards. Environment and commit only; no PII.
        */}
        <BuildLabel />
      </ScrollView>
    </View>
  );
}

/** A row with no handler yet is still a row. */
const noop = () => {};

/**
 * One door: a `ListRow` with the chevron, and the conditional spread that an absent handler
 * needs.
 *
 * `exactOptionalPropertyTypes` is on, so `onPress={maybeUndefined}` is a type error rather
 * than a no-op — which is the compiler being right: "the prop is absent" and "the prop is
 * present and undefined" are different claims. Doing it once here keeps eight call sites
 * from each repeating the spread.
 */
function Row({
  title,
  subtitle,
  onPress,
  testID,
}: {
  title: string;
  subtitle?: string | undefined;
  onPress?: (() => void) | undefined;
  testID: string;
}) {
  return (
    <ListRow
      title={title}
      {...(subtitle !== undefined ? { subtitle } : {})}
      {...(onPress !== undefined ? { onPress } : {})}
      trailing={<Chevron />}
      testID={testID}
    />
  );
}

/**
 * The affordance that says a row goes somewhere.
 *
 * Hidden from assistive technology: `ListRow` already gives the whole row one label, and a
 * screen reader announcing "chevron" after it is a second stop for no extra information.
 */
function Chevron() {
  return (
    <Text
      style={styles.chevron}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      ›
    </Text>
  );
}

/**
 * "Delete my account", in the danger colour.
 *
 * **Why this is not a `ListRow`.** `ListRow` has no tone, and this row has to read as the
 * destructive one — it is the single row on the screen that ends an account. Giving
 * `ListRow` a `tone` prop is the right fix and belongs in `components/Surfaces.tsx`; until
 * then this mirrors its geometry exactly (`touchTarget.min`, `layout.listRowPaddingY`, the
 * hairline rule) so the two sit in one list without a seam.
 *
 * It is a row rather than a destructive `Button` on purpose: a red filled button on the
 * Account screen competes with sign-in for the eye, and deleting an account is something a
 * person goes looking for, not something the screen should offer.
 */
function DangerRow({
  title,
  onPress,
  testID,
}: {
  title: string;
  onPress?: (() => void) | undefined;
  testID: string;
}) {
  const body = (
    <View style={styles.dangerRow}>
      <Text style={styles.dangerText}>{title}</Text>
      <Chevron />
    </View>
  );

  if (onPress === undefined) return <View testID={testID}>{body}</View>;

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.surface },
  // The rows run to the bottom of the list and the build label sits under them, so the
  // scroll view's own padding is vertical only — the gutter belongs to each block.
  content: { paddingBottom: space[6] },

  heading: {
    paddingHorizontal: layout.gutter,
    paddingTop: space[2],
    paddingBottom: space[4],
    gap: space[1],
  },
  title: {
    color: text.primary,
    fontSize: scale.h1.size,
    lineHeight: scale.h1.lineHeight,
    fontWeight: scale.h1.weight,
    // `tracking` is em, as `css.ts` emits it. React Native's `letterSpacing` is points, so
    // the token is multiplied by the size rather than used raw — used raw, -0.015 is a
    // fifteen-thousandth of a point and the tightened title is silently not tightened.
    letterSpacing: scale.h1.tracking * scale.h1.size,
  },
  eyebrow: { color: text.secondary, fontSize: scale.bodySm.size, lineHeight: scale.bodySm.lineHeight },

  signInBlock: { paddingHorizontal: layout.gutter, paddingBottom: space[6], gap: space[3] },
  signInNote: { color: text.secondary, fontSize: scale.bodySm.size, lineHeight: scale.bodySm.lineHeight },

  // A hairline above the first row so the list reads as a list even when the block above it
  // is only a title.
  rows: {
    paddingHorizontal: layout.gutter,
    borderTopWidth: borderWidth.hairline,
    borderTopColor: border.subtle,
  },

  chevron: { color: text.tertiary, fontSize: scale.h3.size, lineHeight: scale.h3.lineHeight },

  dangerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: touchTarget.min,
    paddingVertical: layout.listRowPaddingY,
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: border.subtle,
  },
  dangerText: {
    flex: 1,
    color: text.danger,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  pressed: { backgroundColor: bg.surfaceMuted },
});
