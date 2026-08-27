import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { analytics as analyticsEvents } from '@graybag/shared';

import { NON_ROUTE_SCREENS, screenNameFor } from './screens';

const SRC = join(__dirname, '..');
const APP = join(__dirname, '..', '..');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') sourceFiles(path, found);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

describe('screenNameFor', () => {
  it('maps a known route', () => {
    expect(screenNameFor('OrderDetail')).toBe('order_detail');
  });

  it('returns null for a route nobody vetted, rather than inventing a name', () => {
    // The safe direction. A screen added next month sends nothing until someone puts it on the
    // list; the alternative is that whatever a navigator happened to be called becomes an
    // analytics value with no review.
    expect(screenNameFor('SomeNewScreen')).toBeNull();
    expect(screenNameFor(undefined)).toBeNull();
  });

  it('ignores the tab container, which would double every tab view', () => {
    expect(screenNameFor('Tabs')).toBeNull();
  });
});

describe('the vocabulary matches the app', () => {
  /**
   * `E15-21`. The drift this catches: a screen name declared in `ENUM_VALUES` but emitted by
   * nothing. It costs nothing at runtime and is invisible in review — and then it reads on the
   * dashboard as **a screen no parent ever visited**, which is a far worse failure than a
   * missing row, because it looks like data.
   */
  it('every screen in ENUM_VALUES is actually reachable from some emitter', () => {
    const declared = analyticsEvents.ENUM_VALUES.screen ?? [];
    const source = sourceFiles(SRC)
      .concat(join(APP, 'App.tsx'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');

    // A screen is wired if it is in the ROUTES map (the navigator emits it) or named in
    // NON_ROUTE_SCREENS and passed to useScreenView / track somewhere.
    const routeNames = readFileSync(join(__dirname, 'screens.ts'), 'utf8');
    const nonRouteKeys = Object.entries(NON_ROUTE_SCREENS);

    const unreachable = declared.filter((screen) => {
      if (routeNames.includes(`: '${screen}',`)) return false; // in ROUTES
      const key = nonRouteKeys.find(([, value]) => value === screen)?.[0];
      if (key === undefined) return true;
      return !source.includes(`NON_ROUTE_SCREENS.${key}`);
    });

    expect(unreachable).toEqual([]);
  });

  it('every route in the navigator has a screen name', () => {
    // The other direction: a route the navigator can reach that the map does not know sends
    // nothing at all, so a parent's path has a hole in it exactly where they went.
    const navigator = readFileSync(join(SRC, 'navigation', 'RootNavigator.tsx'), 'utf8');
    const routes = [...navigator.matchAll(/name="([A-Z][A-Za-z]*)"/g)]
      .map((m) => m[1])
      .filter((name): name is string => typeof name === 'string')
      .filter((name) => name !== 'Tabs'); // the container, deliberately unmapped

    const unmapped = [...new Set(routes)].filter((name) => screenNameFor(name) === null);
    expect(unmapped).toEqual([]);
  });

  it('every non-route screen name is on the allowed vocabulary', () => {
    const declared = new Set(analyticsEvents.ENUM_VALUES.screen ?? []);
    for (const value of Object.values(NON_ROUTE_SCREENS)) {
      expect(declared.has(value)).toBe(true);
    }
  });
});

describe('E21 — the pack routes report like any other screen', () => {
  it('names the offers route, INCLUDING when it renders the refusal', () => {
    // The fallback case is the one worth counting: a parent reaching `Packs` with the gate off
    // means a stale link is in circulation. It is the same route either way, so one emitter
    // covers both and neither needs a special case.
    expect(screenNameFor('Packs')).toBe('packs');
  });

  it('names the balance route', () => {
    expect(screenNameFor('MyPacks')).toBe('my_packs');
  });

  it('names the planner route', () => {
    expect(screenNameFor('PackPlan')).toBe('pack_plan');
  });

  it('names the per-day picker', () => {
    expect(screenNameFor('PlanDay')).toBe('plan_day');
  });

  it('names every pack screen that now has a route', () => {
    // `pack_detail` and `pack_plan` are deliberately absent from the vocabulary until those
    // screens are built. A name with no emitter reads on the dashboard as a screen nobody
    // visited, which is worse than a missing row because it looks like data.
    // `pack_detail` joined the vocabulary with `E21-48`, when the screen gained a route. The
    // rule it demonstrates stands: a name here with no emitter reads as a screen nobody visited.
    const declared = analyticsEvents.ENUM_VALUES.screen ?? [];
    expect(declared).toContain('pack_detail');
    expect(screenNameFor('PackDetail')).toBe('pack_detail');
  });
});
