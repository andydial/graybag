import { render, screen } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';

import { AccountScreen, HomeScreen, OrderDetailScreen, OrdersScreen } from './index';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.

/**
 * The unbuilt screens have to be readable by a parent (`E14-17`).
 *
 * The first iOS build shipped our notes to a phone: "Browsable signed out", "Never a wall —
 * the tab still opens". Both record real constraints and neither is addressed to the person
 * holding the device — the second reads as a warning about something.
 *
 * ## Why a vocabulary test rather than a snapshot
 *
 * A snapshot would pin these five strings and pass forever afterwards, including for the
 * sixth screen written next month in the same voice as the first five. What went wrong was
 * not the wording, it was **who the wording was addressed to**, and the reliable symptom of
 * writing for ourselves is our vocabulary: route names, decision ids, task ids, the names of
 * our own components. So the test bans the vocabulary and leaves the prose alone.
 *
 * It will not catch every badly-addressed sentence. It catches the specific way this one got
 * onto a device, which is the class of defect worth a test here.
 */
const OUR_WORDS: { pattern: RegExp; why: string }[] = [
  { pattern: /\bbrowsab/i, why: 'ours: describes the AR7 constraint, not the screen' },
  { pattern: /\bsigned out\b/i, why: 'ours: a session state, not something a parent thinks in' },
  { pattern: /\bplaceholder\b/i, why: 'ours: names the scaffolding' },
  { pattern: /\bempty state\b/i, why: 'ours: names the component' },
  { pattern: /\bstack\b|\bmodal\b|\bsheet\b|\broute\b/i, why: 'ours: navigation vocabulary' },
  { pattern: /\bTODO\b|\bTBD\b/i, why: 'ours: a note to ourselves' },
  // `E14-14`, `E04-12` — a task id on a screen is a note to the team on a customer's phone.
  { pattern: /\bE\d{2}-\d{2}\b/, why: 'ours: a backlog task id' },
  // `D7`, `AR7`, `S12`, `MC3` — the decision log's ids.
  { pattern: /\b[A-Z]{1,3}\d{1,2}\b/, why: 'ours: a decision-log id' },
];

const SCREENS: [string, () => React.JSX.Element, string][] = [
  ['Home', HomeScreen, 'screen-home'],
  ['Account', AccountScreen, 'screen-account'],
  ['Orders', OrdersScreen, 'screen-orders'],
  // Dish detail has left this list because it is no longer a placeholder — it renders a real
  // dish from the cached menu, and it is covered by `menu/DishDetailScreen.test.tsx`, which
  // asserts the same things about a real screen: what it says, and that it has a heading.
  // Leaving this table is what *finishing* a screen looks like; a row removed while the
  // screen still says "will appear here" would be the regression.
  ['Order detail', OrderDetailScreen, 'screen-order-detail'],
];

/**
 * Screens are mounted inside a `NavigationContainer`.
 *
 * Account gained a working action in `E05-01` — "Add a child" navigates — so it calls
 * `useNavigation` and throws outside a container. Rendering these bare used to work and
 * quietly stopped being the right shape the moment a placeholder could do something.
 */
const mount = (Screen: () => React.JSX.Element) =>
  render(
    <NavigationContainer>
      <Screen />
    </NavigationContainer>,
  );

/** Every string the screen puts on the display, heading included. */
async function textOf(Screen: () => React.JSX.Element, testID: string): Promise<string> {
  await mount(Screen);
  // Asserted here so a screen that stopped rendering fails as a missing screen rather than
  // as empty copy, which would read as a passing vocabulary check.
  expect(screen.getByTestId(testID)).toBeOnTheScreen();

  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      walk((node as { children?: unknown }).children);
    }
  };
  walk(screen.toJSON());
  return parts.join(' ');
}

describe('the screens that are not built yet', () => {
  it.each(SCREENS)('%s speaks to a parent, not to us', async (_name, Screen, testID) => {
    const text = await textOf(Screen, testID);

    expect(text.length).toBeGreaterThan(0);

    // Collected rather than asserted one at a time, so a failure names the offending words
    // and the copy they came from instead of stopping at the first.
    const ours = OUR_WORDS.filter(({ pattern }) => pattern.test(text)).map(
      ({ pattern, why }) => `${String(pattern)} — ${why}`,
    );
    expect({ copy: text, ours }).toEqual({ copy: text, ours: [] });
  });

  it.each(SCREENS)('%s says what will be there rather than nothing', async (_name, Screen, testID) => {
    // A heading alone is a dead end. The screen is unbuilt either way; what makes it not
    // confusing is that it tells you what it is for and, where there is one, where to go
    // instead.
    const text = await textOf(Screen, testID);
    expect(text.split(/\s+/).length).toBeGreaterThan(8);
  });

  it.each(SCREENS)('%s carries a heading for a screen reader', async (_name, Screen, testID) => {
    await mount(Screen);
    expect(screen.getByTestId(testID)).toBeOnTheScreen();
    expect(screen.getByRole('header')).toBeOnTheScreen();
  });
});
