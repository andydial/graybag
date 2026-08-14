import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **Every registered route must have a door.**
 *
 * This is the generalisation of `docs/learnings.md` — *"two units tested in isolation prove
 * nothing about the wire between them"* — applied to navigation. Three defects this week were
 * the same shape, and every one of them had green tests on both sides:
 *
 * | Defect | Both sides tested | The wire |
 * |---|---|---|
 * | The menu cache was never installed | `cache.test.ts` and `MenuScreen.test.tsx` | Nothing called `setMenuCache` |
 * | Maestro tapped `tab-menu`, `tab-cart` | Valid YAML, working app | The testIDs did not exist |
 * | **Sign-in had exactly one door, behind a wall** | `SignInScreen.test.tsx` passes, `DishDetailScreen.test.tsx` passed | The only `navigate('SignIn')` was the cart's Place order, and dish detail refused to fill a cart |
 *
 * The third is the reason this file exists. A screen can be built, styled, tested and
 * completely unreachable, and every existing test will be green — because a screen test mounts
 * the screen directly. **`SignInScreen.test.tsx` renders it in isolation, which is exactly the
 * situation a real user is never in.**
 *
 * ## What this asserts, and what it deliberately does not
 *
 * It asserts **the static call graph**: every route in `RootStackParamList` and `TabParamList`
 * is either a tab (reachable from the tab bar by definition) or is the target of at least one
 * `navigate('<Route>')` somewhere in `src/`.
 *
 * It does **not** prove a human can perform the taps — that is Maestro's job (`E14-24`), and the
 * §6.1 flow is the thing that walks it for real. Static reachability is the cheap half that runs
 * in the smoke test in milliseconds and catches the whole class: a route nobody navigates to.
 *
 * ## Why a source scan rather than a rendered navigator
 *
 * Rendering the navigator and crawling it would need a mounted tree per route and would still
 * only visit what a test remembers to tap. Reading the source finds `navigate('X')` wherever it
 * lives — a screen, a hook, a deep-link handler — and cannot be fooled by a test forgetting to
 * look somewhere.
 */

const SRC = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const sources = walk(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const allSource = sources.map((s) => s.text).join('\n');

/** Route names as registered, read from the navigator rather than duplicated here. */
function registeredRoutes(kind: 'Stack' | 'Tab'): string[] {
  const navigator = sources.find((s) => s.path.endsWith('RootNavigator.tsx'));
  if (!navigator) throw new Error('RootNavigator.tsx not found — this test cannot be trusted');
  const pattern = new RegExp(`<${kind}\\.Screen\\s+name="(\\w+)"`, 'g');
  return [...navigator.text.matchAll(pattern)].map((m) => m[1] as string);
}

/** Every route name any source file navigates to. */
const navigatedTo = new Set(
  [...allSource.matchAll(/navigate\(\s*['"](\w+)['"]/g)].map((m) => m[1] as string),
);
// `navigate(cond ? 'A' : 'B')` — the ternary form Account uses for signed-in vs signed-out.
for (const [, a, b] of allSource.matchAll(/navigate\([^)]*\?\s*['"](\w+)['"]\s*:\s*['"](\w+)['"]/g)) {
  navigatedTo.add(a as string);
  navigatedTo.add(b as string);
}

/**
 * Routes that are registered but genuinely have no door yet, each with the task that removes it.
 *
 * **This list is the honest alternative to two dishonest options:** faking a door so the test
 * passes, or deleting the assertion. A screen that is a stub with nothing to link to is a real
 * state — `OrderDetail` needs a list of orders to be tapped from, and that list is a
 * placeholder until `E21-11`.
 *
 * The rules that stop it rotting into a permanent exemption: every entry names the task that
 * deletes it, and the test below fails if an entry is added without one — so an exemption is a
 * line in a review, not a quiet append.
 */
const KNOWN_DOORLESS: Record<string, string> = {
  OrderDetail:
    'E21-11 — the Orders screen is a placeholder with no list, so there is no row to tap ' +
    'through to a detail. Wired when Orders is built.',
};

describe('every screen has a door', () => {
  const tabs = registeredRoutes('Tab');
  const stackRoutes = registeredRoutes('Stack');

  it('found the navigator and its routes, so a silent zero cannot pass this file', () => {
    // Without this, a rename of RootNavigator.tsx or a change to how screens are registered
    // would make every assertion below vacuously true — the `Tests: 0` failure mode that
    // `E02-24` already caught once in the pgTAP suite.
    expect(tabs.length).toBeGreaterThanOrEqual(4);
    expect(stackRoutes.length).toBeGreaterThanOrEqual(5);
    expect(navigatedTo.size).toBeGreaterThan(0);
    expect(sources.length).toBeGreaterThan(20);
  });

  it.each(registeredRoutes('Stack').filter((r) => r !== 'Tabs'))(
    '%s is navigated to from somewhere in src/',
    (route) => {
      // Jest's `expect` takes one argument, so the explanation is thrown rather than passed.
      // It matters that the failure explains itself: "DishDetail: false" tells whoever broke
      // it nothing about why a screen with no door is a defect.
      if (KNOWN_DOORLESS[route] !== undefined) {
        // Declared unreachable, on purpose, with the task that fixes it. Not silence.
        expect(KNOWN_DOORLESS[route]).toMatch(/E\d\d-\d\d/);
        return;
      }
      if (!navigatedTo.has(route)) {
        throw new Error(
          `Route "${route}" is registered in the navigator but nothing in src/ calls ` +
            `navigate('${route}'). It is a screen with no door: it renders correctly in its own ` +
            `test and is unreachable in the app. That is exactly how sign-in shipped behind a ` +
            `wall — its only door was the cart's Place order button, and the cart could not be ` +
            `filled signed out (E05-32).`,
        );
      }
      expect(navigatedTo.has(route)).toBe(true);
    },
  );

  /**
   * The sharper rule, and the one that would have caught this week's defect on its own.
   *
   * `SignIn` is the single gate in the product (`R1`/`AR7`). Every other route can afford to be
   * one tap deep from somewhere; this one has to be reachable by a **signed-out** person who has
   * not managed to build a cart — because the cart was, until `E05-32`, the only way in.
   */
  it('SignIn is reachable from more than one place, and one of them is Account', () => {
    const doors = sources.filter((s) => /navigate\([^)]*['"]SignIn['"]/.test(s.text));

    if (doors.length <= 1) {
      throw new Error(
        'SignIn has only one door. It had exactly one before — the cart\'s Place order button ' +
          '— and since the cart could not be filled signed out, sign-in was unreachable from a ' +
          'cold start. One door is one wall away from none.',
      );
    }
    expect(doors.length).toBeGreaterThan(1);

    if (!doors.some((source) => /screens\/index\.tsx$/.test(source.path))) {
      throw new Error(
        'Account does not offer sign-in. It is where a person looks for it, and the prototype ' +
          'leads with it.',
      );
    }
    expect(doors.some((source) => /screens\/index\.tsx$/.test(source.path))).toBe(true);
  });

  /**
   * Every stack route has a way back.
   *
   * `headerShown: false` is set globally so each screen can draw its own title in the brand's
   * voice. That quietly removed the only back affordance in the product — Dish detail and Add
   * someone both shipped with no visible exit, and the hardware gesture is not an answer for a
   * parent halfway through adding their child.
   *
   * Asserted at the registration site rather than per screen, because that is where it cannot
   * be forgotten for the NEXT screen.
   */
  it('gives every stack route a back affordance, and no tab one', () => {
    const navigator = sources.find((s) => s.path.endsWith('RootNavigator.tsx'))!.text;

    const stackFrames = [...navigator.matchAll(/withScreenFrame\(\s*(\w+),\s*STACK_SCREEN_EDGES([^)]*)\)/g)];
    expect(stackFrames.length).toBeGreaterThanOrEqual(5);
    for (const [, name, rest] of stackFrames) {
      if (!/back:\s*true/.test(rest ?? '')) {
        throw new Error(
          `Stack route "${name}" is registered without \`{ back: true }\`, so it has no visible ` +
            `way out — every route runs headerShown: false. Add it at the registration site; ` +
            `adding a chevron inside the screen fixes that screen and leaves the next one.`,
        );
      }
    }

    // A tab is not somewhere you came from, so it must NOT carry one.
    const tabFrames = [...navigator.matchAll(/withScreenFrame\(\s*(\w+),\s*TAB_SCREEN_EDGES([^)]*)\)/g)];
    for (const [, name, rest] of tabFrames) {
      if (/back:\s*true/.test(rest ?? '')) {
        throw new Error(`Tab "${name}" has a back bar. A tab is not somewhere you came from.`);
      }
    }
  });

  /**
   * `R1`: browsing and filling the cart never require a session. A tab that navigates to SignIn
   * on mount would be a wall in front of the menu, which is the failure `AR7` names explicitly.
   */
  it('every declared-doorless route names the task that gives it a door', () => {
    // An exemption without an owner becomes permanent. This is what keeps the list shrinking.
    for (const [route, reason] of Object.entries(KNOWN_DOORLESS)) {
      expect(reason).toMatch(/E\d\d-\d\d/);
      expect(stackRoutes).toContain(route);
    }
    // And the list must not grow quietly: any addition changes this number in a diff.
    expect(Object.keys(KNOWN_DOORLESS)).toHaveLength(1);
  });

  it('no tab screen sends a signed-out visitor to SignIn before they ask', () => {
    const navigator = sources.find((s) => s.path.endsWith('RootNavigator.tsx'))!;
    expect(navigator.text).not.toMatch(/useEffect\([^)]*navigate\([^)]*SignIn/s);
    expect(tabs).toEqual(expect.arrayContaining(['Home', 'Menu', 'Cart', 'Account']));
  });
});

/**
 * **A screen that shows server data must be connected to something that fetches it.** `E06-40`.
 *
 * The seventh instance of this codebase's most persistent defect, and the most expensive so far:
 * `OrdersScreen` was built with every state it needs — loading, ready, error, stale, signed out —
 * and was routed **directly**, with no props. So `state` was always its default, the error branch
 * was unreachable, and a parent with three settled orders, three invoices and a balanced ledger
 * saw "no orders yet".
 *
 * Every existing test was green. `OrdersScreen.test.tsx` mounts it with fixtures — which is the
 * situation a real user is never in — and the pgTAP suite proved the RLS policy admits the paying
 * parent, which it does. Neither could see that nothing ever asked.
 *
 * The rule this encodes: **a route rendered as a bare presentational component is a screen with
 * no data.** It is a static check, like the door check above, and it costs milliseconds.
 */
describe('every data screen is connected', () => {
  const navigator = sources.find((s) => s.path.endsWith('RootNavigator.tsx'));

  /**
   * Screens whose entire purpose is to render something the server holds. A route that renders
   * one of these directly is the bug; it must render a connected wrapper instead.
   *
   * Deliberately a short, hand-kept list rather than a heuristic. "Does this component need
   * data" is not decidable from its name, and a wrong guess here either blocks a presentational
   * screen or waves through the next `OrdersScreen`.
   */
  const NEEDS_DATA = ['OrdersScreen', 'OrderDetailScreen'];

  /**
   * **Found by this check on the day it was written**, which is the argument for it.
   *
   * `OrderDetailScreen` is routed bare too — the same defect as `OrdersScreen`, one screen
   * along, and it is already filed as `E06-34`. Listed rather than fixed here because the fix is
   * a read this task does not build, and listed rather than silently excluded because a check
   * that quietly skips its own findings is not a check.
   *
   * Removing this entry is part of closing `E06-34`.
   */
  const KNOWN_UNCONNECTED: Record<string, string> = {
    OrderDetailScreen: 'E06-34 — Order detail has no read yet',
  };

  it.each(NEEDS_DATA)('%s is not routed as a bare presentational component', (screen) => {
    if (KNOWN_UNCONNECTED[screen]) return;
    const text = navigator?.text ?? '';
    // `withScreenFrame(OrdersScreen, …)` — the exact shape that shipped the defect.
    const bare = new RegExp(`withScreenFrame\\(\\s*${screen}\\s*,`);
    expect(text).not.toMatch(bare);
  });

  it('the connected Orders screen actually calls the api read', () => {
    // The other half: a wrapper that exists and fetches nothing is the same defect with an extra
    // file. Asserted against the source rather than by mounting, because mounting is what missed
    // it the first time.
    // `expect(value, message)` is Vitest, not Jest — this file runs under Jest, and passing a
    // second argument throws inside `expect` itself rather than failing the assertion.
    const tab = sources.find((s) => s.path.endsWith('OrdersTabScreen.tsx'));
    expect(tab).toBeDefined();
    expect(tab?.text).toMatch(/api\.fetchOrders\(/);
  });

  it('it distinguishes a failed read from an empty list', () => {
    // §5.21, and the reason `fetchOrders` throws rather than returning `[]`. "No orders yet"
    // rendered over an outage is an unknown presented as a known.
    const tab = sources.find((s) => s.path.endsWith('OrdersTabScreen.tsx'));
    expect(tab?.text).toMatch(/setState\('error'\)/);

    // **Comments stripped first.** The first version of this matched the file's own comment —
    // which reads "Deliberately not `setOrders([])`" — and failed the very file it was written
    // to approve. A guard that its own documentation can trip is a guard people delete.
    const code = (tab?.text ?? '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    expect(code).not.toMatch(/catch[\s\S]{0,160}setOrders\(\[\]\)/);
  });
});
