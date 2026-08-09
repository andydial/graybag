/**
 * What the kitchen needs at 7am — `E09-01`, `E09-02`, `E09-03`, and the CSV half of
 * `E09-11a`.
 *
 * Pure functions over a flat list of order lines. No fetching, no dates, no `order`
 * table: the queries that produce the input belong with `E05-09`'s order creation, and
 * putting the aggregation here means it is testable today, against fixtures, before a
 * single real order exists.
 *
 * ## Three lists, and they are not the same list
 *
 * - **Production** (`E09-01`) answers "how many sandwiches do we make". One number per
 *   dish across every school. Nobody's name is in it and nobody's name should be.
 * - **Per-school** (`E09-02`) answers "how many go in the Alpha van". Same shape, split.
 * - **Packing** (`E09-03`) answers "which child gets which bag", and it is the only one
 *   that names anyone.
 *
 * Keeping them separate matters more than it looks: the production list is the one that
 * gets printed and left on a counter, and it is the one a photograph of ends up in a
 * WhatsApp group. It carries no child's name because it never needs one.
 *
 * ## PII
 *
 * `packingList` carries `recipientName` because a member of staff physically hands food to
 * a named child — there is no version of that job that works without the name. That makes
 * it **tier P** under `docs/authorization-model.md` and non-negotiable #4 applies in full:
 * it must never be logged, never reach Sentry or analytics, and never appear in a school
 * report. `productionCsv` and `perSchoolCsv` are safe to print and share; `packingCsv` is
 * not, and it says so in its own header row.
 */

/** One line of one order, flattened. Every field is a snapshot taken at order time. */
export interface KitchenOrderLine {
  orderId: string;
  schoolId: string;
  schoolName: string;
  /** The break the food is for. Null when the school does not use breaks. */
  breakId: string | null;
  breakLabel: string | null;
  dishId: string;
  dishName: string;
  quantity: number;
  /** Tier P. Present only because staff hand food to a named child. */
  recipientName: string;
  classLabel: string | null;
  sectionLabel: string | null;
  /** Counter collection only. Null for classroom delivery. */
  pickupCode: string | null;
}

export interface DishTotal {
  dishId: string;
  dishName: string;
  quantity: number;
}

export interface SchoolTotals {
  schoolId: string;
  schoolName: string;
  dishes: DishTotal[];
  totalItems: number;
}

/**
 * Sort dish totals the way a kitchen reads them: biggest batch first, because that is what
 * gets started first, and alphabetically within a tie so the order is stable between runs.
 * A list that reshuffles when two dishes have equal counts is a list nobody trusts.
 */
const byQuantityThenName = (a: DishTotal, b: DishTotal) =>
  b.quantity - a.quantity || a.dishName.localeCompare(b.dishName);

function totalsFrom(lines: KitchenOrderLine[]): DishTotal[] {
  const totals = new Map<string, DishTotal>();
  for (const line of lines) {
    const existing = totals.get(line.dishId);
    if (existing) {
      existing.quantity += line.quantity;
    } else {
      // Copied rather than referenced: the caller's array must not be mutated, and a
      // shared object here would make two lists' totals move together.
      totals.set(line.dishId, {
        dishId: line.dishId,
        dishName: line.dishName,
        quantity: line.quantity,
      });
    }
  }
  return [...totals.values()].sort(byQuantityThenName);
}

/** `E09-01` — one number per dish, across every school this kitchen serves. */
export function productionTotals(lines: KitchenOrderLine[]): DishTotal[] {
  return totalsFrom(lines);
}

/** `E09-02` — the same, split by school. Schools sorted by name for a stable printout. */
export function perSchoolTotals(lines: KitchenOrderLine[]): SchoolTotals[] {
  const bySchool = new Map<string, KitchenOrderLine[]>();
  for (const line of lines) {
    const existing = bySchool.get(line.schoolId);
    if (existing) existing.push(line);
    else bySchool.set(line.schoolId, [line]);
  }

  return [...bySchool.values()]
    .map((schoolLines) => {
      const dishes = totalsFrom(schoolLines);
      return {
        // Non-null: a group only exists because at least one line created it.
        schoolId: schoolLines[0]!.schoolId,
        schoolName: schoolLines[0]!.schoolName,
        dishes,
        totalItems: dishes.reduce((sum, d) => sum + d.quantity, 0),
      };
    })
    .sort((a, b) => a.schoolName.localeCompare(b.schoolName));
}

export interface PackingEntry {
  recipientName: string;
  classLabel: string | null;
  sectionLabel: string | null;
  pickupCode: string | null;
  dishes: DishTotal[];
}

export interface PackingGroup {
  schoolId: string;
  schoolName: string;
  breakId: string | null;
  breakLabel: string | null;
  classLabel: string | null;
  sectionLabel: string | null;
  entries: PackingEntry[];
}

/**
 * `E09-03` — school → break → class → section, then one entry per child.
 *
 * Grouped in exactly that order because it is the order the food physically moves: a van
 * goes to a school, a trolley goes out at a break, and a bag is handed to a class. A
 * packing list grouped any other way makes somebody re-sort it by hand at 7am.
 *
 * A child with two dishes is ONE entry with two dishes, not two entries. Two rows for one
 * child is how a child gets handed one bag and marked as served.
 */
export function packingList(lines: KitchenOrderLine[]): PackingGroup[] {
  const groups = new Map<string, PackingGroup>();

  for (const line of lines) {
    // Null-safe and unambiguous: a literal "|" in a label cannot collide with the
    // separator because every part is length-prefixed by JSON.
    const groupKey = JSON.stringify([
      line.schoolId,
      line.breakId,
      line.classLabel,
      line.sectionLabel,
    ]);

    let group = groups.get(groupKey);
    if (!group) {
      group = {
        schoolId: line.schoolId,
        schoolName: line.schoolName,
        breakId: line.breakId,
        breakLabel: line.breakLabel,
        classLabel: line.classLabel,
        sectionLabel: line.sectionLabel,
        entries: [],
      };
      groups.set(groupKey, group);
    }

    // One entry per ORDER, not per child name: two children with the same name at one
    // school is not a hypothetical, and merging them would hand one of them nothing.
    let entry = group.entries.find((e) => e.recipientName === line.recipientName);
    const sameOrder = group.entries.some(
      (e) => e.recipientName === line.recipientName && e.pickupCode === line.pickupCode,
    );
    if (!entry || !sameOrder) {
      entry = {
        recipientName: line.recipientName,
        classLabel: line.classLabel,
        sectionLabel: line.sectionLabel,
        pickupCode: line.pickupCode,
        dishes: [],
      };
      group.entries.push(entry);
    }

    const dish = entry.dishes.find((d) => d.dishId === line.dishId);
    if (dish) dish.quantity += line.quantity;
    else
      entry.dishes.push({
        dishId: line.dishId,
        dishName: line.dishName,
        quantity: line.quantity,
      });
  }

  for (const group of groups.values()) {
    group.entries.sort((a, b) => a.recipientName.localeCompare(b.recipientName));
    for (const entry of group.entries) entry.dishes.sort(byQuantityThenName);
  }

  return [...groups.values()].sort(
    (a, b) =>
      a.schoolName.localeCompare(b.schoolName) ||
      (a.breakLabel ?? '').localeCompare(b.breakLabel ?? '') ||
      (a.classLabel ?? '').localeCompare(b.classLabel ?? '') ||
      (a.sectionLabel ?? '').localeCompare(b.sectionLabel ?? ''),
  );
}

// ---------------------------------------------------------------------------
// CSV — E09-11a
//
// The kitchen must be able to work at 7am with no app and no network. That means a file
// that opens in Excel on whatever laptop is in the office, which in practice means CSV
// with CRLF line endings and quoted fields.
// ---------------------------------------------------------------------------

/**
 * Quote a CSV field.
 *
 * The leading-character guard is not decoration: a value beginning `=`, `+`, `-` or `@` is
 * interpreted by Excel and Sheets as a **formula**, so a dish named "-- Special" becomes a
 * calculation and a crafted name becomes a command. Prefixing with a single quote is the
 * documented mitigation and is invisible in the cell.
 */
function csvField(value: string | number | null): string {
  const raw = value === null ? '' : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

const csv = (rows: (string | number | null)[][]): string =>
  rows.map((row) => row.map(csvField).join(',')).join('\r\n');

/** `E09-11a` — the production list. Safe to print and leave on a counter: no names. */
export function productionCsv(lines: KitchenOrderLine[]): string {
  return csv([['Dish', 'Quantity'], ...productionTotals(lines).map((d) => [d.dishName, d.quantity])]);
}

/** `E09-11a` — per school. Also nameless. */
export function perSchoolCsv(lines: KitchenOrderLine[]): string {
  const rows: (string | number | null)[][] = [['School', 'Dish', 'Quantity']];
  for (const school of perSchoolTotals(lines)) {
    for (const dish of school.dishes) rows.push([school.schoolName, dish.dishName, dish.quantity]);
  }
  return csv(rows);
}

/**
 * `E09-11a` — the packing list. **This one names children.**
 *
 * The first row says so, in the file, because a CSV outlives the conversation in which it
 * was produced and the person who finds it on a shared drive in six months did not attend
 * that conversation.
 */
export function packingCsv(lines: KitchenOrderLine[]): string {
  const rows: (string | number | null)[][] = [
    ['CONTAINS CHILDREN’S NAMES — do not share outside the kitchen (DPDP Act)'],
    ['School', 'Break', 'Class', 'Section', 'Child', 'Pickup code', 'Dish', 'Quantity'],
  ];
  for (const group of packingList(lines)) {
    for (const entry of group.entries) {
      for (const dish of entry.dishes) {
        rows.push([
          group.schoolName,
          group.breakLabel,
          entry.classLabel,
          entry.sectionLabel,
          entry.recipientName,
          entry.pickupCode,
          dish.dishName,
          dish.quantity,
        ]);
      }
    }
  }
  return csv(rows);
}
