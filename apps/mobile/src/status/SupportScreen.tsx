import { Linking, StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

import { Button } from '../components/Button';
import { Card } from '../components/Surfaces';

const { bg, text, space, scale, layout } = design;

/**
 * Support and the grievance officer — `E21-19`, `docs/ux-spec.md` §5.18.
 *
 * ## This is a compliance surface, not a courtesy
 *
 * India's DPDP Act requires a Data Fiduciary to **publish** the contact details of someone who
 * can answer questions about how personal data is processed, and both app stores expect an
 * in-app route to it. It is one of the six compliance items in v1 scope, and it is the reason
 * this screen exists at all rather than a link to the website.
 *
 * ## The contact is not filled in yet, and it says so
 *
 * `E20-21` is `owner:andy`: the name, designation, email and published postal address are
 * facts only he can supply. Rather than invent a plausible-looking address — which would be
 * worse than useless, because a published contact that goes nowhere is a commitment on record
 * that we are failing — the screen renders what it holds and states plainly that the rest is
 * coming.
 *
 * Pass real values through `grievance` and the notice disappears. Nothing else changes.
 */
export interface GrievanceOfficer {
  name: string;
  designation: string;
  email: string;
  address: string;
}

export function SupportScreen({
  grievance = null,
  supportEmail = null,
  testID = 'screen-support',
}: {
  grievance?: GrievanceOfficer | null;
  supportEmail?: string | null;
  testID?: string;
}) {
  return (
    <View style={styles.screen} testID={testID}>
      <Text style={styles.title} accessibilityRole="header">
        Support
      </Text>
      <Text style={styles.lead}>
        Something wrong with an order, or a question about the food? Tell us and we&rsquo;ll sort
        it out.
      </Text>

      {supportEmail === null ? null : (
        <Button
          label="Email us"
          onPress={() => void Linking.openURL(`mailto:${supportEmail}`)}
          testID={`${testID}-email`}
        />
      )}

      <Card testID={`${testID}-grievance`}>
        <Text style={styles.cardHead}>Grievance officer</Text>
        {grievance === null ? (
          <Text style={styles.pending} testID={`${testID}-grievance-pending`}>
            We&rsquo;re publishing these details before launch. Until then, email us above and
            it reaches the same people.
          </Text>
        ) : (
          <>
            <Text style={styles.cardBody}>
              {grievance.name} · {grievance.designation}
            </Text>
            <Text style={styles.cardBody}>{grievance.email}</Text>
            <Text style={styles.cardBody}>{grievance.address}</Text>
          </>
        )}
        <Text style={styles.cardNote}>
          You can write to us about anything we hold about you or your child — to see it,
          correct it, or have it deleted.
        </Text>
      </Card>
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
  cardNote: { color: text.tertiary, fontSize: scale.caption.size, marginTop: space[2] },
  pending: { color: text.secondary, fontSize: scale.body.size, lineHeight: scale.body.lineHeight },
});
