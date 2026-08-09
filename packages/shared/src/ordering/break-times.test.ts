import { describe, expect, it } from 'vitest';

import { defaultBreakTime, selectableBreakTimes } from './break-times.js';
import type { BreakTime } from './break-times.js';

const MORNING: BreakTime = {
  id: 'bt-morning',
  schoolId: 's-1',
  code: 'break_1',
  label: 'Morning break',
  startsAt: '10:00',
  endsAt: '10:20',
  sortOrder: 1,
  isActive: true,
  classIds: [],
};

const LUNCH: BreakTime = {
  ...MORNING,
  id: 'bt-lunch',
  code: 'break_2',
  label: 'Lunch',
  startsAt: '12:30',
  endsAt: '13:10',
  sortOrder: 2,
};

describe('selectableBreakTimes', () => {
  it('returns the active breaks for the school', () => {
    expect(selectableBreakTimes([MORNING, LUNCH], null).map((b) => b.id)).toEqual([
      'bt-morning',
      'bt-lunch',
    ]);
  });

  it('drops an inactive break', () => {
    const retired = { ...LUNCH, isActive: false };
    expect(selectableBreakTimes([MORNING, retired], null).map((b) => b.id)).toEqual(['bt-morning']);
  });

  it('orders by sortOrder', () => {
    const out = selectableBreakTimes([{ ...LUNCH, sortOrder: 1 }, { ...MORNING, sortOrder: 2 }], null);
    expect(out.map((b) => b.id)).toEqual(['bt-lunch', 'bt-morning']);
  });

  // Two breaks left at the default sortOrder of 0 must not come back in whatever order the
  // database felt like. A picker that reorders itself between visits is a bug people report
  // as "it moved".
  it('breaks a sortOrder tie by start time, not by input order', () => {
    const a = { ...LUNCH, sortOrder: 0 };
    const b = { ...MORNING, sortOrder: 0 };
    expect(selectableBreakTimes([a, b], null).map((x) => x.id)).toEqual(['bt-morning', 'bt-lunch']);
  });

  // The schema states the rule: no `break_time_class` rows means the break applies to every
  // class. That is what makes switching class-specific breaks on later data rather than code.
  it('offers an unrestricted break to a recipient in any class', () => {
    expect(selectableBreakTimes([MORNING], 'class-7a').map((b) => b.id)).toEqual(['bt-morning']);
  });

  it('offers a restricted break to a recipient in one of its classes', () => {
    const restricted = { ...LUNCH, classIds: ['class-7a', 'class-7b'] };
    expect(selectableBreakTimes([restricted], 'class-7a').map((b) => b.id)).toEqual(['bt-lunch']);
  });

  it('withholds a restricted break from a recipient in another class', () => {
    const restricted = { ...LUNCH, classIds: ['class-7a'] };
    expect(selectableBreakTimes([restricted], 'class-9c')).toEqual([]);
  });

  /**
   * `[DM-08]`: `school_class_id` is nullable and `class_label` is a free-text fallback, so a
   * recipient's class can genuinely be unknown. A restricted break is then unverifiable, and
   * the two ways to be wrong are not symmetric — offering one the child cannot use sends food
   * to a room they are not in, while withholding one costs a question to the school. Withhold.
   */
  it('withholds a restricted break when the recipient class is unknown', () => {
    const restricted = { ...LUNCH, classIds: ['class-7a'] };
    expect(selectableBreakTimes([restricted], null)).toEqual([]);
  });

  it('still offers unrestricted breaks when the recipient class is unknown', () => {
    const restricted = { ...LUNCH, classIds: ['class-7a'] };
    expect(selectableBreakTimes([MORNING, restricted], null).map((b) => b.id)).toEqual([
      'bt-morning',
    ]);
  });

  it('is empty for a school with no breaks configured', () => {
    expect(selectableBreakTimes([], 'class-7a')).toEqual([]);
  });
});

describe('defaultBreakTime', () => {
  it('is the first selectable break', () => {
    expect(defaultBreakTime([MORNING, LUNCH], null)?.id).toBe('bt-morning');
  });

  it('respects sortOrder rather than input order', () => {
    expect(defaultBreakTime([{ ...LUNCH, sortOrder: 1 }, { ...MORNING, sortOrder: 2 }], null)?.id).toBe(
      'bt-lunch',
    );
  });

  /**
   * `null`, never a thrown error and never an arbitrary pick.
   *
   * A school with no usable break is a real configuration state, and it is the checkout's job
   * to refuse the order — not this function's job to invent a delivery slot. `"order"`
   * .`break_time_id` is nullable precisely because counter pickup has no break at all.
   */
  it('is null when nothing is selectable', () => {
    expect(defaultBreakTime([{ ...LUNCH, classIds: ['class-7a'] }], 'class-9c')).toBeNull();
  });
});
