/**
 * Break / drop time selection (`E05-06`).
 *
 * Which break times a customer may choose for one recipient at one school. Pure rules over
 * rows the caller already holds — the app uses this to draw the picker, and the checkout
 * transaction uses it to refuse a break the recipient was never entitled to.
 *
 * **The class-group rule comes from the schema, not from here.** `break_time_class` is
 * designed and unused in v1, and `0001` states its semantics: *no rows for a break means the
 * break applies to every class.* That is what makes turning class-specific breaks on later a
 * matter of inserting data rather than changing code, and it is why this module reads an
 * empty `classIds` as "everyone" rather than as "nobody".
 */

/** One row of `break_time`, plus the class ids restricting it (empty = all classes). */
export interface BreakTime {
  id: string;
  schoolId: string;
  code: string;
  /** What the customer sees. Snapshotted onto the order as `break_label_snapshot`. */
  label: string;
  /** `HH:MM`, a real time. */
  startsAt: string;
  endsAt: string;
  sortOrder: number;
  isActive: boolean;
  /**
   * From `break_time_class`. **Empty means every class**, per `0001`'s stated semantics — not
   * "no class", which would make every break unusable the moment the table is read.
   */
  classIds: string[];
}

/**
 * The breaks this recipient may be given food at.
 *
 * @param schoolClassId the recipient's class, or `null` when it is unknown — `[DM-08]` makes
 *   `school_class_id` nullable with a free-text `class_label` fallback, so this is a real
 *   state and not a caller error.
 */
export function selectableBreakTimes(
  breakTimes: BreakTime[],
  schoolClassId: string | null,
): BreakTime[] {
  return breakTimes
    .filter((breakTime) => {
      if (!breakTime.isActive) return false;

      // Unrestricted: available to everyone, including a recipient whose class is unknown.
      if (breakTime.classIds.length === 0) return true;

      // Restricted, and we do not know the class. The two ways to be wrong are not
      // symmetric: offering a break the child cannot use sends food to a room they are not
      // in, while withholding one costs somebody a question to the school. Withhold.
      if (schoolClassId === null) return false;

      return breakTime.classIds.includes(schoolClassId);
    })
    .sort(
      (a, b) =>
        // Start time breaks the tie rather than input order. `sort_order` defaults to 0, so
        // two breaks at the default would otherwise come back in whatever order the database
        // returned them — and a picker that reorders itself between visits is reported as
        // "it moved", which is a hard bug to hear described and an easy one to prevent.
        a.sortOrder - b.sortOrder || a.startsAt.localeCompare(b.startsAt),
    );
}

/**
 * The break to preselect, or `null` when there is none.
 *
 * `null` rather than a throw or an arbitrary pick. A school with no usable break is a real
 * configuration state; refusing the order is the checkout's job, and inventing a delivery slot
 * is nobody's. `"order".break_time_id` is nullable for the same reason — counter pickup has no
 * break at all.
 */
export function defaultBreakTime(
  breakTimes: BreakTime[],
  schoolClassId: string | null,
): BreakTime | null {
  return selectableBreakTimes(breakTimes, schoolClassId)[0] ?? null;
}
