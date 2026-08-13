import { useEffect, type ReactNode } from 'react';

import { useOrderTarget } from './OrderTargetContext';
import { useSelectedSchool } from './SelectedSchoolContext';

/**
 * Make the selected school **follow** whoever the order is for.
 *
 * ## The defect this closes, and why it is a class rather than a screen
 *
 * "Which school are we ordering from" was held in two independent places: the visitor's pick
 * in `SelectedSchoolContext`, and the recipient's own school on the order target. Two answers
 * to one question always drift, and this pair drifted in the most visible way possible:
 *
 *     Choose a school → Add a child → it asks for the school again → save
 *       → back on Home with no school selected.
 *
 * Each half was individually correct. The menu genuinely needs a school before anyone has
 * signed in (`AR7` — that is why `SelectedSchoolContext` exists and must keep existing), and a
 * recipient genuinely has a school of their own. What was missing was a rule about which one
 * wins when both are known.
 *
 * **The rule: a chosen recipient wins.** They are the more specific fact — a person attends
 * exactly one school, whereas a browsing pick is a guess about what someone wants to look at.
 * The moment there is a recipient, the school follows them; before that, the visitor's pick
 * stands untouched.
 *
 * ## Why a component rather than a hook called from three screens
 *
 * Because a hook has to be *remembered*. This mounts once, above the navigator, and applies
 * to every screen that exists now and every screen added later — including ones nobody has
 * thought of. A rule that can be forgotten on the next screen is not a fix to the class.
 *
 * It renders its children unchanged and draws nothing.
 */
export function SchoolFollowsRecipient({ children }: { children: ReactNode }) {
  const { target } = useOrderTarget();
  const { schoolId, setSchool } = useSelectedSchool();

  const targetSchoolId = target?.schoolId ?? null;
  const targetSchoolName = target?.schoolName ?? null;

  useEffect(() => {
    // No recipient, or one whose school we could not read: leave the visitor's pick alone.
    // Clearing it here would empty the menu of somebody who is browsing perfectly happily.
    if (targetSchoolId === null) return;
    if (targetSchoolId === schoolId) return;

    setSchool({ schoolId: targetSchoolId, schoolName: targetSchoolName });
  }, [targetSchoolId, targetSchoolName, schoolId, setSchool]);

  return <>{children}</>;
}
