import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Which school's menu is being browsed.
 *
 * **Separate from `SessionContext`, and deliberately so.** A school is not a property of a
 * signed-in user here — `AR7` says the menu must be browsable before anyone identifies
 * themselves, so a visitor picks a school (mock 05's "Delivery to School" band) and browses,
 * and only later does a session arrive with recipients attached. Folding this into the
 * session would make "which menu do I show" depend on being signed in, which is the wall
 * `AR7` forbids expressed as a data dependency.
 *
 * `null` means no school chosen yet. That is a legitimate state that renders an empty menu,
 * **not** an error — a retry button in front of someone who has nothing to retry is worse
 * than an empty screen that explains itself.
 *
 * `E03` fills this from the user's recipients once they sign in; until then it is whatever
 * the visitor picked, and `E04-09`'s version endpoint is keyed on it either way.
 */
export interface SelectedSchool {
  schoolId: string | null;
  schoolName: string | null;
}

interface SelectedSchoolValue extends SelectedSchool {
  setSchool: (next: SelectedSchool) => void;
}

const NONE: SelectedSchool = { schoolId: null, schoolName: null };

const SelectedSchoolContext = createContext<SelectedSchoolValue>({
  ...NONE,
  setSchool: () => {},
});

export function SelectedSchoolProvider({
  children,
  initial = NONE,
}: {
  children: ReactNode;
  initial?: SelectedSchool;
}) {
  const [school, setSchool] = useState<SelectedSchool>(initial);
  const value = useMemo(() => ({ ...school, setSchool }), [school]);
  return (
    <SelectedSchoolContext.Provider value={value}>{children}</SelectedSchoolContext.Provider>
  );
}

export function useSelectedSchool(): SelectedSchoolValue {
  return useContext(SelectedSchoolContext);
}
