import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react-native';

import { EmptyStateDiagnostic } from './EmptyStateDiagnostic';

/**
 * Mocked rather than mutated. `Constants.expoConfig` is null under jest, so the component builds
 * a fresh `{}` on every render and a test that pokes at the real object changes nothing it reads.
 */
// The `mock` prefix is required: jest forbids a factory closing over any other outer variable.
let mockAppEnv = 'staging';
jest.mock('expo-constants', () => ({
  __esModule: true,
  get default() {
    return { expoConfig: { extra: { appEnv: mockAppEnv } } };
  },
}));

/**
 * The diagnostic that ends the "your check says X, my screen says Y" argument — `E14-31`.
 *
 * Two properties, and the second is the one that could hurt somebody.
 */
describe('EmptyStateDiagnostic', () => {
  afterEach(() => {
    mockAppEnv = 'staging';
  });

  it('shows the facts in a staging build', async () => {

    await render(
      <EmptyStateDiagnostic
        facts={[
          { label: 'school', value: '77308e75-d8e9-47ba-a503-7c38d482a72c' },
          { label: 'version', value: 47 },
          { label: 'source', value: 'cache' },
          { label: 'rows', value: 0 },
        ]}
      />,
    );

    expect(screen.getByTestId('empty-diagnostic-school')).toBeOnTheScreen();
    expect(screen.getByTestId('empty-diagnostic-rows')).toHaveTextContent('rows: 0');
    // `0` must render as "0", not vanish as falsy — a row count of zero is the entire finding.
    expect(screen.queryByText(/rows: —/)).toBeNull();
  });

  it('renders an absent value as a dash rather than dropping the row', async () => {

    await render(<EmptyStateDiagnostic facts={[{ label: 'version', value: null }]} />);

    // A row that disappears cannot be told apart, in a screenshot, from a row never added.
    expect(screen.getByTestId('empty-diagnostic-version')).toHaveTextContent('version: —');
  });

  it('renders nothing at all in production', async () => {
    mockAppEnv = 'production';

    await render(<EmptyStateDiagnostic facts={[{ label: 'school', value: 's-1' }]} />);

    expect(screen.queryByTestId('empty-diagnostic')).toBeNull();
  });

  /**
   * **No call site may pass anything about a person** — non-negotiable #4, R6, `docs/ux-spec.md`
   * §13.3.
   *
   * A diagnostic exists to be screenshotted and pasted into a chat. That is the whole point of
   * it, and it is exactly why a name reaching one is worse than the bug it was added to solve:
   * a minor's name in a support thread is a disclosure that outlives the ticket.
   *
   * So the guard is on the *call sites*, not on the component: the component cannot know whether
   * the string it was handed is an id or a child. This reads every `facts={[...]}` in the app and
   * fails on any value that looks like it came from a person.
   */
  it('no call site passes anything about a person', () => {
    const root = join(__dirname, '..');

    /** Field names that carry, or could carry, a person. Matched against the *value* expression. */
    const FORBIDDEN = [
      /\bdisplayName\b/,
      /\bfirstName\b/,
      /\blastName\b/,
      /\bfullName\b/,
      /\bclassLabel\b/,
      /\bsectionLabel\b/,
      /\ballergy/i,
      /\ballergen/i,
      /\bemail\b/,
      /\brecipientName\b/,
      /\bschoolName\b/,
      /\btarget\.\w+/,
      /\brecipient\.\w+/,
    ];

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        const source = readFileSync(path, 'utf8');
        // Each `facts={[ ... ]}` block, comments stripped so prose about names does not trip it.
        for (const match of source.matchAll(/facts=\{\[([\s\S]*?)\]\}/g)) {
          const block = (match[1] ?? '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
            .replace(/^\s*\/\/.*$/gm, '');
          for (const pattern of FORBIDDEN) {
            if (pattern.test(block)) {
              offenders.push(`${path.slice(path.indexOf(join('src', '')))} — ${pattern}`);
            }
          }
        }
      }
    };
    walk(root);

    if (offenders.length > 0) {
      throw new Error(
        `A diagnostic is screenshotted and pasted into chats. These pass person data:\n  ${offenders.join('\n  ')}`,
      );
    }
  });
});
