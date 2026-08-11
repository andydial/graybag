import { Linking, StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

import { Button } from '../components/Button';
import { Card } from '../components/Surfaces';
import { SUPPORT_SUBJECTS, supportMailto } from '../support/contact';

const { bg, text, space, scale, layout } = design;

/**
 * Deleting an account — `E20-37`.
 *
 * ## What was wrong
 *
 * `AccountScreen.onDeleteAccount` had no caller. The danger row rendered, in red, and did
 * nothing. Both stores require an in-app path to account deletion, and it is one of the six v1
 * compliance controls, so this was a screen a reviewer would tap during submission and find
 * inert.
 *
 * ## Why this composes a request rather than deleting anything
 *
 * The erasure pipeline is not built. `E20-18` is the Edge Function that runs the fixed order in
 * `dpdp-compliance.md` §6.5, and `E20-30` is what scopes it so deleting an account does not
 * take a co-guardian's children with it. Neither exists.
 *
 * A button that says "Delete my account" and quietly does nothing is far worse than one that
 * says what it does. So this screen states what deletion means, what survives it and why, and
 * sends a request to a person who acts on it. That is a real path — the store requirement is
 * that a user can *initiate* deletion in the app — and it is honest about being manual.
 *
 * ## It promises no timeline, deliberately
 *
 * DPDP puts a statutory clock on this, and **we do not yet know what number it is**:
 * `data_subject_request.due_at` is `not null` with no default, and the original `E20-14` exists
 * precisely because the legal deadline has to come from `E20-01` rather than from somebody's
 * recollection. Printing "within 30 days" here would be the same defect as asserting a live app
 * version nobody had checked — a confident number standing in for an unanswered question, on a
 * screen where getting it wrong is a broken commitment to a parent.
 *
 * So the screen says we will confirm the timeline when we reply, and `E20-40` fills it in.
 *
 * ## What it says survives deletion
 *
 * Invoices and the money trail. That is not a hedge — it is statutory retention under Indian
 * tax law, it is written into `dpdp-compliance.md` §6.2, and a parent is entitled to know
 * before they ask rather than after. `[DP-02]`: telling someone their data is gone when the
 * invoices are not is the kind of statement that is worse than silence.
 */
export function DeleteAccountScreen({ testID = 'screen-delete-account' }: { testID?: string }) {
  return (
    <View style={styles.screen} testID={testID}>
      <Text style={styles.title} accessibilityRole="header">
        Delete your account
      </Text>
      <Text style={styles.lead}>
        You can ask us to delete your account and the details we hold about you and your
        children. Here is exactly what that means before you do.
      </Text>

      <Card testID={`${testID}-what-goes`}>
        <Text style={styles.cardHead}>What we delete</Text>
        <Text style={styles.cardBody}>
          Your account and sign-in, your children&rsquo;s names, class, section and any allergies
          you told us about, and who you order for.
        </Text>
      </Card>

      <Card testID={`${testID}-what-stays`}>
        <Text style={styles.cardHead}>What we have to keep</Text>
        <Text style={styles.cardBody}>
          Invoices and payment records for past orders. Indian tax law requires us to keep these
          for a set period, and we cannot delete them on request — they stay whether or not your
          account does.
        </Text>
      </Card>

      <Card testID={`${testID}-how`}>
        <Text style={styles.cardHead}>How it works</Text>
        <Text style={styles.cardBody}>
          Tap below and your mail app opens with the request ready to send. A person handles it,
          and we will write back to confirm it is done and how long it took.
        </Text>
      </Card>

      <View style={styles.actions}>
        <Button
          label="Request account deletion"
          variant="destructive"
          onPress={() => void Linking.openURL(supportMailto(SUPPORT_SUBJECTS.deleteAccount))}
          testID={`${testID}-request`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas, padding: layout.gutter, gap: space[3] },
  title: {
    color: text.primary,
    fontSize: scale.h1.size,
    lineHeight: scale.h1.lineHeight,
    fontWeight: scale.h1.weight,
  },
  lead: { color: text.secondary, fontSize: scale.body.size, lineHeight: scale.body.lineHeight },
  cardHead: { color: text.primary, fontSize: scale.label.size, fontWeight: scale.label.weight },
  cardBody: { color: text.secondary, fontSize: scale.body.size, lineHeight: scale.body.lineHeight },
  actions: { marginTop: 'auto' },
});
