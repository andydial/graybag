/**
 * An automated accessibility audit over a rendered tree (`E13-08`, `E13-10`).
 *
 * **This is a check that runs in CI, not a design review someone does once.** That
 * distinction is `E13-10`'s whole point: a one-time audit is true on the day it is done and
 * decays with every component added afterwards. Three of `E13-08`'s four parts are already
 * asserted at the token layer — contrast by `E13-13`, tap targets and dynamic type by
 * `E13-01` — so what is left is the part that needs something rendered: **does every
 * interactive element have a name, and is it big enough to hit.**
 *
 * There is no axe for React Native. Axe walks a DOM, and this tree is native views; the web
 * half of `E13-10` is a separate job that waits on `E12`. So the rules below are written
 * out, and each one is a defect somebody would otherwise ship.
 */

export interface A11yViolation {
  rule: string;
  detail: string;
  testID?: string;
  role?: string;
}

/** Roles a user is expected to act on. An unnamed one is unusable without sight. */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'search',
  'imagebutton',
]);

/**
 * 48×48, the stricter of iOS's 44 and Android's 48 — taken once rather than per-platform,
 * matching `touchTarget.min`.
 *
 * Read from the style rather than from layout because jest does not lay out. That is a real
 * limitation and it is stated rather than hidden: this catches a control with no minimum
 * set, which is the ordinary defect. A control whose *content* collapses it below the
 * minimum at runtime is `E19-02`'s territory, on a device.
 */
export const MIN_TOUCH_TARGET = 48;

const flatten = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

/** Anything with props and children — deliberately structural, so the audit does not depend
 *  on react-test-renderer's instance type, which RNTL v14 no longer hands out. */
interface TreeNode {
  props?: Record<string, unknown>;
  children?: unknown;
}

/** Every string anywhere beneath a node — what the platform falls back to for a name. */
function textUnder(node: unknown, depth = 0): string {
  if (depth > 12 || node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map((n) => textUnder(n, depth + 1)).join(' ');
  if (typeof node === 'object') {
    const candidate = node as TreeNode & { children?: unknown };
    return textUnder(candidate.children ?? candidate.props?.children, depth + 1);
  }
  return '';
}

/** The name a screen reader would announce, if any. */
function accessibleName(node: TreeNode): string {
  const label = node.props?.accessibilityLabel;
  if (typeof label === 'string' && label.trim() !== '') return label.trim();
  return textUnder(node).trim();
}

/** What the audit needs from the test harness. `screen` satisfies it. */
export interface Queryable {
  queryAllByRole: (role: string) => TreeNode[];
}

/**
 * Walk a rendered tree and return every violation.
 *
 * Driven by RNTL's own `queryAllByRole` rather than react-test-renderer's `findAll`, because
 * v14 no longer exposes a `ReactTestInstance` to walk — and querying by role is the right
 * shape anyway: it asks the same question the platform's accessibility tree does.
 *
 * Returns a list rather than throwing so a test can report all of them at once. A check that
 * fails on the first problem makes fixing ten of them ten runs.
 */
export function auditA11y(screen: Queryable): A11yViolation[] {
  const violations: A11yViolation[] = [];

  const nodes = [...INTERACTIVE_ROLES].flatMap((role) =>
    screen.queryAllByRole(role).map((node) => ({ node, role })),
  );

  for (const { node, role: nodeRole } of nodes) {
    const props = (node.props ?? {}) as Record<string, unknown>;
    const role = nodeRole;
    const testID = typeof props.testID === 'string' ? props.testID : undefined;

    // Hidden from assistive tech on purpose — the loading indicator inside a button whose
    // label already says what is happening. Skipping these is correct; not skipping them
    // would train people to add labels to things that must not be announced.
    if (props.accessibilityElementsHidden === true || props.importantForAccessibility === 'no') {
      continue;
    }

    const name = accessibleName(node);
    if (name === '') {
      violations.push({
        rule: 'interactive-element-has-name',
        detail:
          `A "${role}" has no accessibility label and no text content. It is announced as ` +
          `just "button" and is unusable without sight.`,
        ...(testID !== undefined ? { testID } : {}),
        role,
      });
    }

    const style = flatten(props.style);
    const height = style.minHeight ?? style.height;
    if (typeof height === 'number' && height < MIN_TOUCH_TARGET) {
      violations.push({
        rule: 'touch-target-minimum',
        detail:
          `A "${role}" is ${height}pt tall, below the ${MIN_TOUCH_TARGET}pt minimum. ` +
          `If the visual must be smaller, keep the visual and extend the target with hitSlop.`,
        ...(testID !== undefined ? { testID } : {}),
        role,
      });
    }
  }

  return violations;
}

/** Format violations so a failure message says what to fix rather than that something failed. */
export function formatViolations(violations: A11yViolation[]): string {
  return violations
    .map((v) => `  [${v.rule}] ${v.role ?? '?'}${v.testID ? ` (${v.testID})` : ''}: ${v.detail}`)
    .join('\n');
}
