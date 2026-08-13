import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { OrderTargetProvider, useOrderTarget } from './OrderTargetContext';
import type { OrderTarget } from './OrderTargetContext';
import { SchoolFollowsRecipient } from './SchoolFollowsRecipient';
import { SelectedSchoolProvider, useSelectedSchool } from './SelectedSchoolContext';

/**
 * The rule that closed "choose a school → add a child → back on Home with no school selected".
 *
 * Two independent answers to "which school are we ordering from" always drift; the fix was to
 * make one of them derived. These tests pin *which* one wins and, just as importantly, when
 * neither does — because clearing a browsing visitor's pick would empty the menu of somebody
 * who is looking at it perfectly happily.
 */
function Show() {
  const { schoolId, schoolName } = useSelectedSchool();
  const { target } = useOrderTarget();
  return (
    <Text testID="state">{`${schoolId ?? 'none'}|${schoolName ?? 'none'}|${target?.recipientId ?? 'none'}`}</Text>
  );
}

const AARAV: OrderTarget = {
  recipientId: 'r-1',
  allergenIds: null,
  serviceDate: '2026-08-12' as OrderTarget['serviceDate'],
  displayName: 'Aarav',
  schoolId: 'school-alpha',
  schoolName: 'Alpha Public School',
};

const mount = (target: OrderTarget | null, school: { schoolId: string | null; schoolName: string | null }) =>
  render(
    <SelectedSchoolProvider initial={school}>
      <OrderTargetProvider initial={target}>
        <SchoolFollowsRecipient>
          <Show />
        </SchoolFollowsRecipient>
      </OrderTargetProvider>
    </SelectedSchoolProvider>,
  );

describe('SchoolFollowsRecipient', () => {
  it('adopts the recipient’s school when none has been picked', async () => {
    await mount(AARAV, { schoolId: null, schoolName: null });

    // This is the flow that was broken: add a child, land back with a school selected.
    expect(await screen.findByTestId('state')).toHaveTextContent(
      'school-alpha|Alpha Public School|r-1',
    );
  });

  it('overrides a browsing pick that disagrees with the recipient', async () => {
    await mount(AARAV, { schoolId: 'school-bravo', schoolName: 'Bravo International' });

    // The recipient wins: a person attends exactly one school, whereas a browsing pick is a
    // guess about what someone wants to look at.
    expect(await screen.findByTestId('state')).toHaveTextContent(
      'school-alpha|Alpha Public School|r-1',
    );
  });

  /**
   * `AR7`. Before a recipient exists, the visitor's pick is the only answer there is — and
   * clearing it would empty the menu of somebody who is browsing perfectly happily, which is
   * the wall the whole rule set exists to prevent.
   */
  it('leaves a browsing visitor’s pick alone when there is no recipient', async () => {
    await mount(null, { schoolId: 'school-bravo', schoolName: 'Bravo International' });

    expect(screen.getByTestId('state')).toHaveTextContent(
      'school-bravo|Bravo International|none',
    );
  });

  it('leaves the pick alone when the recipient’s school could not be read', async () => {
    // `fetchRecipients` can return a row whose school is unreadable. Adopting `null` from it
    // would blank a working menu on the strength of a missing field.
    await mount(
      { ...AARAV, schoolId: null, schoolName: null },
      { schoolId: 'school-bravo', schoolName: 'Bravo International' },
    );

    expect(screen.getByTestId('state')).toHaveTextContent('school-bravo|Bravo International|r-1');
  });
});
