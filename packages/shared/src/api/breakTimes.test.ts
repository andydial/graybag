import { describe, expect, it, afterEach } from 'vitest';

import {
  BREAK_TIME_COLUMNS,
  BreakTimePayloadError,
  fetchBreakTimes,
  formatBreakWindow,
  setApiTransport,
} from './index.js';
import { fakeTransport } from './test-support.js';

afterEach(() => setApiTransport(null));

const install = (rows: unknown, error: { message: string; code?: string } | null = null) => {
  const fake = fakeTransport(rows, error);
  setApiTransport(fake.transport);
  return fake;
};

const ROW = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  label: 'Morning break',
  starts_at: '10:40:00',
  ends_at: '11:15:00',
  ...over,
});

describe('fetchBreakTimes', () => {
  it('reads break_time for the school, in offer order', async () => {
    const fake = install([ROW()]);
    await fetchBreakTimes('s1');
    const q = fake.queries[0];
    expect(q?.table).toBe('break_time');
    expect(q?.filters).toContainEqual({ column: 'school_id', value: 's1' });
    expect(q?.filters).toContainEqual({ column: 'is_active', value: true });
    expect(q?.orders).toContainEqual({ column: 'sort_order', ascending: true });
  });

  it('never asks for legacy_option_value', async () => {
    // Its own column comment says never trust it: the legacy option-set db values contradict
    // their labels. A field documented as wrong must not reach a screen.
    const fake = install([ROW()]);
    await fetchBreakTimes('s1');
    expect(fake.queries[0]?.columns).toBe(BREAK_TIME_COLUMNS);
    expect(fake.queries[0]?.columns).not.toContain('legacy_option_value');
    expect(fake.queries[0]?.columns).not.toContain('*');
  });

  it('returns the windows a parent can choose from', async () => {
    install([ROW()]);
    await expect(fetchBreakTimes('s1')).resolves.toEqual([
      { id: 'b1', label: 'Morning break', startsAt: '10:40:00', endsAt: '11:15:00' },
    ]);
  });

  it('returns empty for a school with no windows — which is an answer, not a gap', async () => {
    // `P19`. Gem and Paragon were in exactly this state until `0029` gave them Amity's windows
    // as provisional rows (`P20`); it is now what a newly onboarded school looks like before its
    // times are agreed. The caller must read it as "this school cannot take orders yet" rather
    // than proceeding without a window.
    install([]);
    await expect(fetchBreakTimes('s2')).resolves.toEqual([]);
  });

  it('refuses a row missing a required field', async () => {
    install([ROW({ starts_at: undefined })]);
    await expect(fetchBreakTimes('s1')).rejects.toBeInstanceOf(BreakTimePayloadError);
  });
});

describe('formatBreakWindow', () => {
  it('renders a 24-hour range without seconds', () => {
    expect(formatBreakWindow('10:40:00', '11:15:00')).toBe('10:40 – 11:15');
  });

  it('passes an unparseable value through rather than inventing one', () => {
    // The row stays selectable. A mangled time beats "Invalid Date" on a checkout screen.
    expect(formatBreakWindow('later', 'much later')).toBe('later – much later');
  });
});
