import { describe, expect, it } from 'vitest';

import { estate, readiness } from './school-readiness.js';

const TODAY = '2026-08-17';

const school = (over: Record<string, unknown> = {}) => ({
  id: 's-1', code: 'amity', name: 'Amity', cityName: 'Mohali',
  kitchenId: 'k-1', kitchenName: 'Sky Bites', institutionType: 'school',
  addressLine1: null, addressLine2: null, postcode: null,
  contactName: null, contactEmail: 'office@amity.example', contactPhone: null,
  isActive: true, onboardedAt: '2026-08-01', ...over,
}) as never;

const dish = (over: Record<string, unknown> = {}) => ({
  id: 'd-1', name: 'Veg Sandwich', kitchenId: 'k-1', categoryCode: 'snack', categoryName: 'Snack',
  foodType: 'veg', description: null, ingredientsText: null, caloriesKcal: null, caloriesText: null,
  portionText: null, nutrition: null, isActive: true, imageAssetId: null,
  allergens: [], allergensDeclaredNone: true, ...over,
}) as never;

const menu = (over: Record<string, unknown> = {}) => ({
  id: 'm-1', name: 'Term 1', kitchenId: 'k-1', status: 'active',
  items: [{ menuId: 'm-1', dishId: 'd-1', dishName: 'Veg Sandwich', pricePaise: 4500, availableDays: [1], isActive: true }],
  ...over,
}) as never;

const assignment = (over: Record<string, unknown> = {}) => ({
  schoolId: 's-1', schoolName: 'Amity', schoolCode: 'amity',
  menuId: 'm-1', menuName: 'Term 1', validFrom: '2026-01-01', validTo: null, revokedAt: null, ...over,
}) as never;

const breakWindow = (over: Record<string, unknown> = {}) =>
  ({ schoolId: 's-1', label: 'Morning break', startsAt: '10:40:00', endsAt: '11:15:00', isActive: true, ...over }) as never;

/** Every input defaulted to a school that is completely ready; each test breaks exactly one. */
interface Inputs {
  schools: unknown[];
  assignments: unknown[];
  menus: unknown[];
  dishes: unknown[];
  breaks: unknown[];
  serviceDays: Map<string, number[]>;
}

const run = (over: Partial<Inputs> = {}) => {
  const o: Inputs = {
    schools: [school()], assignments: [assignment()], menus: [menu()], dishes: [dish()],
    breaks: [breakWindow()], serviceDays: new Map([['s-1', [1, 2, 3, 4, 5, 6]]]),
    ...over,
  };
  return readiness(
    o.schools as never, o.assignments as never, o.menus as never,
    o.dishes as never, o.breaks as never, o.serviceDays, TODAY,
  );
};

const gate = (r: ReturnType<typeof run>[number], key: string) => r.gates.find((g) => g.key === key)!;

describe('a school that is ready', () => {
  it('is live, with no blockers', () => {
    const r = run()[0]!;
    expect(r.state).toBe('live');
    expect(r.blockers).toEqual([]);
    expect(r.gates.every((g) => g.state === 'ok')).toBe(true);
  });

  it('says what each gate actually is, not just that it passed', () => {
    // A checklist of ticks tells you nothing you can check. "Term 1 — 1 of 1 orderable" does.
    const r = run()[0]!;
    expect(gate(r, 'menu').detail).toMatch(/Term 1/);
    expect(gate(r, 'breaks').detail).toMatch(/10:40–11:15/);
    expect(gate(r, 'serviceDays').detail).toBe('Mon, Tue, Wed, Thu, Fri, Sat');
  });
});

describe('each gate fails on its own', () => {
  it('no break windows blocks, whatever else is set', () => {
    // `P19`. This is the one that is easiest to miss because everything else looks finished.
    const r = run({ breaks: [] })[0]!;
    expect(gate(r, 'breaks').state).toBe('missing');
    expect(r.state).toBe('incomplete');
    expect(r.blockers.map((g) => g.key)).toEqual(['breaks']);
  });

  it('no menu blocks', () => {
    const r = run({ assignments: [] })[0]!;
    expect(gate(r, 'menu').state).toBe('missing');
    expect(gate(r, 'menu').detail).toMatch(/empty menu/);
  });

  it('a menu with nothing orderable blocks, and says so distinctly', () => {
    // Different fix from "no menu": the assignment is right and the dishes are wrong.
    const r = run({ dishes: [dish({ foodType: null })] })[0]!;
    expect(gate(r, 'menu').state).toBe('missing');
    expect(gate(r, 'menu').detail).toMatch(/nothing on it can be ordered/);
  });

  it('a school that was never onboarded blocks first', () => {
    const r = run({ schools: [school({ onboardedAt: null })] })[0]!;
    expect(r.blockers[0]!.key).toBe('onboarded');
  });

  it('deactivated is distinguished from never onboarded', () => {
    // Same consequence for a parent, completely different fix.
    expect(gate(run({ schools: [school({ isActive: false })] })[0]!, 'onboarded').detail).toMatch(/Deactivated/);
    expect(gate(run({ schools: [school({ onboardedAt: null })] })[0]!, 'onboarded').detail).toMatch(/Never onboarded/);
  });
});

describe('warnings are not blockers', () => {
  it('inherited service days warn, and say the default includes Sunday', () => {
    // Inheriting is legitimate. It is worth saying out loud because the platform default is all
    // seven days, so a parent can order for a Sunday nobody meant to serve.
    const r = run({ serviceDays: new Map() })[0]!;
    expect(gate(r, 'serviceDays').state).toBe('warning');
    expect(gate(r, 'serviceDays').detail).toMatch(/Sunday/);
    expect(r.state).toBe('live');
    expect(r.blockers).toEqual([]);
  });

  it('a missing report contact does not stop anyone ordering', () => {
    const r = run({ schools: [school({ contactEmail: null })] })[0]!;
    expect(gate(r, 'contact').state).toBe('warning');
    expect(gate(r, 'contact').blocking).toBe(false);
    expect(r.state).toBe('live');
  });

  it('a menu that starts later is SCHEDULED, not broken', () => {
    // The distinction that makes a correctly-configured school stop looking like a fault.
    const r = run({ assignments: [assignment({ validFrom: '2099-01-01' })] })[0]!;
    expect(r.state).toBe('scheduled');
    expect(gate(r, 'menu').detail).toMatch(/starts 2099-01-01/);
    expect(r.blockers).toEqual([]);
  });
});

describe('ordering and the summary', () => {
  it('puts the schools that need work first', () => {
    // The opposite of alphabetical, deliberately: this screen exists to show what needs doing.
    const list = readiness(
      [school({ id: 's-1', name: 'Aaa' }), school({ id: 's-2', name: 'Zzz' })] as never,
      [assignment({ schoolId: 's-2' })] as never,
      [menu()] as never, [dish()] as never,
      [breakWindow({ schoolId: 's-2' })] as never,
      new Map([['s-2', [1]]]), TODAY,
    );
    expect(list.map((r) => r.school.name)).toEqual(['Aaa', 'Zzz']);
    expect(list[0]!.state).toBe('incomplete');
    expect(list[1]!.state).toBe('live');
  });

  it('counts the estate in one line', () => {
    const list = readiness(
      [school({ id: 's-1' }), school({ id: 's-2', name: 'B' })] as never,
      [assignment()] as never, [menu()] as never, [dish()] as never,
      [breakWindow()] as never, new Map([['s-1', [1]]]), TODAY,
    );
    expect(estate(list)).toEqual({ total: 2, live: 1, scheduled: 0, incomplete: 1 });
  });
});
