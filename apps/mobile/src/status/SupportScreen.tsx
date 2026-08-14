import { Linking, StyleSheet, Text, View } from 'react-native';
import { design } from '@graybag/shared';

import { Button } from '../components/Button';
import { Card } from '../components/Surfaces';
import { GRIEVANCE_EMAIL, SUPPORT_SUBJECTS, supportMailto } from '../support/contact';

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
 *
 * ## No address is drawn on this screen — `E20-39`
 *
 * Both buttons compose a message to `SUPPORT_EMAIL` without ever displaying it (Andy,
 * 2026-08-11). That is why `supportEmail` is gone as a prop: it existed, had no caller, and
 * its only purpose was to be turned into a `mailto:` — which the screen can do for itself from
 * one constant, with no way for a caller to pass an address that then gets rendered.
 *
 * The grievance officer's own email is deliberately **not** rendered either when `E20-21`
 * fills the block in. A published grievance contact has to be reachable, not scrapeable, and
 * the compose button is the reachable half.
 */
export interface GrievanceOfficer {
  /**
   * **A role, never a person.** Andy, 2026-08-15: no individual's name in the app.
   *
   * `name` was here and carried "Vivek". It is gone rather than left optional, because an
   * optional field that must never be filled is an invitation, and the next person to wire this
   * block up would have had no way to know. Making it un-representable is the same technique
   * this file already uses for the grievance email, and for the same reason.
   */
  designation: string;
  /**
   * Postal address. Optional because Andy has not supplied one — `E20-21` is still open for it.
   * Rendering "undefined" or inventing one would be worse than showing the fact we have.
   */
  address?: string;
}
// No `email` field, deliberately. DPDP requires the grievance contact to be **published**, and
// it is — in `docs/privacy-policy.md` §7.2, which is where a published document belongs. Making
// it un-representable here means "never rendered on this screen" is structural rather than
// something a future edit has to remember.

export function SupportScreen({
  grievance = null,
  testID = 'screen-support',
}: {
  grievance?: GrievanceOfficer | null;
  testID?: string;
}) {
  // `Linking` directly, with no injectable seam. An `openUrl` prop here would be passed by
  // nothing but the test file — which `orphans.test.ts` correctly calls an orphan, and which
  // is the same class of defect as an exported setter only tests call. The test mocks
  // `Linking` instead, so the production path is the tested path.
  const open = (url: string) => void Linking.openURL(url);
  return (
    <View style={styles.screen} testID={testID}>
      <Text style={styles.title} accessibilityRole="header">
        Support
      </Text>
      <Text style={styles.lead}>
        Something wrong with an order, or a question about the food? Tell us and we&rsquo;ll sort
        it out.
      </Text>

      <Button
        label="Email us"
        onPress={() => open(supportMailto(SUPPORT_SUBJECTS.general))}
        testID={`${testID}-email`}
      />

      <Card testID={`${testID}-grievance`}>
        <Text style={styles.cardHead}>Grievance officer</Text>
        {grievance === null ? (
          <Text style={styles.pending} testID={`${testID}-grievance-pending`}>
            We&rsquo;re publishing these details before launch. Until then, use the button below
            and it reaches the same people.
          </Text>
        ) : (
          <>
            <Text style={styles.cardBody}>{grievance.designation}</Text>
            {grievance.address === undefined ? null : (
              <Text style={styles.cardBody}>{grievance.address}</Text>
            )}
          </>
        )}

        {/*
          The reachable half of a published contact. Separate from "Email us" so the message
          arrives with a subject that says it is a data-protection matter — DPDP puts these on
          a statutory clock, and one undifferentiated inbox is how a deadline gets missed.
        */}
        <Button
          label="Write to the grievance officer"
          variant="secondary"
          onPress={() => open(supportMailto(SUPPORT_SUBJECTS.grievance, GRIEVANCE_EMAIL))}
          testID={`${testID}-grievance-email`}
        />
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
