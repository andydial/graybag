import { render, screen } from '@testing-library/react-native';
import { design } from '@graybag/shared';

import { AppShell } from './AppShell';

// `render` is **async** on @testing-library/react-native v14 — it returns a Promise, because
// React 19's concurrent root commits outside the synchronous call. Every `render` in this
// codebase must be awaited. Forgetting the await does not fail with "you forgot await": it
// fails with `getByTestId is not a function`, or with `screen`'s "render function has not
// been called", both of which read as a broken component. See docs/learnings.md 2026-08-09.

describe('AppShell', () => {
  it('renders', async () => {
    await render(<AppShell />);
    expect(screen.getByTestId('app-shell')).toBeOnTheScreen();
  });

  // The point of this test is not that the background is grey. It is that the value
  // arrived from `@graybag/shared` — the scaffold's whole job (`E14-01`) is to prove the
  // token pipeline works across the workspace boundary before `E13-03` builds on it. If
  // the import breaks, or the workspace link is wrong, this fails here rather than in
  // twenty components at once.
  it('takes its colour from the shared design tokens, not a literal', async () => {
    await render(<AppShell />);
    expect(screen.getByTestId('app-shell')).toHaveStyle({
      backgroundColor: design.bg.canvas,
    });
  });

  // S7: components import semantic roles, never ramp steps. A component that reached into
  // `neutral[50]` directly would render identically and escape both the contrast test and
  // a future dark mode, so "it looks right" is not evidence — the identity is.
  it('uses the semantic role, and the role is what the ramp resolves to', () => {
    expect(design.bg.canvas).toBe(design.neutral[50]);
  });
});
