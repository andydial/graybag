// The text an operator reads before deciding to apply.
//
// Written for one person at a terminal on 17 August with a spreadsheet open in the other window.
// So: row numbers as the spreadsheet shows them, the column named, and the correction spelled out
// rather than a rule quoted. Counts come last, because the first question is "is anything wrong"
// and the second is "how much".

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Problems, grouped by row so a row with three bad columns is read once, not three times. */
export function renderErrors(errors, { label = 'file' } = {}) {
  if (errors.length === 0) return '';

  const byRow = new Map();
  for (const e of errors) {
    if (!byRow.has(e.row)) byRow.set(e.row, []);
    byRow.get(e.row).push(e);
  }

  const lines = [`${plural(byRow.size, 'row')} in the ${label} cannot be imported:`, ''];
  for (const [row, list] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    lines.push(`  row ${row}`);
    for (const e of list) lines.push(`    ${e.column ? `${e.column}: ` : ''}${e.message}`);
  }
  return lines.join('\n');
}

export function renderBlockers(blockers) {
  if (blockers.length === 0) return '';
  const lines = [
    `${plural(blockers.length, 'row')} could not be planned — the row is fine, but something it ` +
      `refers to is missing:`,
    '',
  ];
  for (const b of [...blockers].sort((a, b) => a.row - b.row)) {
    lines.push(`  row ${b.row}  ${b.message}`);
  }
  return lines.join('\n');
}

export function renderSchoolPlan(plan) {
  const lines = ['SCHOOLS', ''];

  if (plan.creates.length === 0 && plan.updates.length === 0) {
    lines.push('  nothing to do — every school in the file already matches what is stored');
  }

  for (const s of plan.creates) {
    lines.push(`  + create  ${s.code.padEnd(20)} ${s.name}  (${s.city}, kitchen ${s.kitchenCode})`);
  }
  for (const s of plan.updates) {
    const what = [...s.changed, ...s.configChanged.map((c) => `config.${c}`)].join(', ');
    lines.push(`  ~ update  ${s.code.padEnd(20)} ${s.name}`);
    lines.push(`            changing: ${what}`);
  }
  if (plan.unchanged.length > 0) {
    lines.push(`  = ${plural(plan.unchanged.length, 'school')} unchanged`);
  }
  return lines.join('\n');
}

export function renderDishPlan(plan) {
  const lines = ['DISHES', ''];

  if (plan.creates.length === 0 && plan.updates.length === 0) {
    lines.push('  nothing to do — every dish in the file already matches what is stored');
  }

  for (const d of plan.creates) {
    const bits = [d.category];
    if (d.foodType) bits.push(d.foodType);
    if (d.allergens.length) bits.push(`allergens: ${d.allergens.join(', ')}`);
    // A dish with no food type is called out on creation. [DM-17] leaves the column nullable
    // because the source has no such field, but veg/non-veg is close to required in this market
    // and a silent null becomes a dish nobody can filter.
    if (!d.foodType) bits.push('NO FOOD TYPE — veg/non-veg unset');
    lines.push(`  + create  ${d.name}  (${bits.join('; ')})`);
  }
  for (const d of plan.updates) {
    lines.push(`  ~ update  ${d.name}`);
    lines.push(`            changing: ${d.changed.join(', ')}`);
  }
  if (plan.unchanged.length > 0) {
    lines.push(`  = ${plural(plan.unchanged.length, 'dish', 'dishes')} unchanged`);
  }
  return lines.join('\n');
}

export function renderMenuPlan(menus) {
  const lines = ['MENUS', ''];
  if (menus.length === 0) lines.push('  nothing to do');

  for (const m of menus) {
    const mark = m.isNew ? '+ create' : m.changed ? '~ update' : '=       ';
    lines.push(`  ${mark}  menu ${m.code} — ${m.name} (kitchen ${m.kitchenCode})`);
    lines.push(`            ${plural(m.items.length, 'dish', 'dishes')}`);
    for (const a of m.assignments.values()) {
      const until = a.validTo ? `until ${a.validTo} (exclusive)` : 'open-ended';
      lines.push(`            → ${a.schoolCode}, from ${a.validFrom} ${until}`);
    }
    if (m.assignments.size === 0) {
      // Worth stating: a menu with no assignment is invisible to every parent. It is a legitimate
      // state — a menu prepared before its school is ready — but it is never what somebody
      // intended on the day they imported it.
      lines.push('            → not assigned to any school. No parent will see it until it is');
    }
  }
  return lines.join('\n');
}

export function renderBreakPlan(plan) {
  const lines = ['BREAK WINDOWS', ''];

  if (plan.creates.length === 0 && plan.updates.length === 0) {
    lines.push('  nothing to do — every window in the file already matches what is stored');
  }
  for (const b of plan.creates) {
    lines.push(`  + create  ${b.schoolCode.padEnd(28)} ${b.label}  ${b.startsAt.slice(0, 5)}–${b.endsAt.slice(0, 5)}`);
  }
  for (const b of plan.updates) {
    lines.push(`  ~ update  ${b.schoolCode.padEnd(28)} ${b.label}  ${b.startsAt.slice(0, 5)}–${b.endsAt.slice(0, 5)}`);
    lines.push(`            changing: ${b.changed.join(', ')}`);
  }
  if (plan.unchanged.length > 0) {
    lines.push(`  = ${plural(plan.unchanged.length, 'window')} unchanged`);
  }

  // `P19` makes this the headline rather than a footnote: an active, onboarded school with no
  // window takes no orders at all, and the app says so rather than failing.
  if (plan.stillClosed.length > 0) {
    lines.push('');
    lines.push(`  STILL CLOSED after this: ${plan.stillClosed.join(', ')}`);
    lines.push('  A school with no break window cannot be ordered from (P19).');
  }
  return lines.join('\n');
}

/** The one line that says what happens next. */
export function renderVerdict({ dryRun, errorCount, blockerCount, changeCount }) {
  if (errorCount > 0 || blockerCount > 0) {
    return (
      `REFUSED. ${plural(errorCount, 'invalid row')} and ${plural(blockerCount, 'unresolved reference')}. ` +
      `Nothing was written. Fix the rows above and run again.`
    );
  }
  if (changeCount === 0) {
    return 'Nothing to do. Everything in the file already matches what is stored.';
  }
  return dryRun
    ? `Dry run. ${plural(changeCount, 'change')} would be made. Nothing was written — ` +
      `re-run with --apply to make them.`
    : `Applied ${plural(changeCount, 'change')}.`;
}
