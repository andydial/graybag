/**
 * The component library (`E13-03`).
 *
 * Everything here is built on `packages/shared/src/design` and imports **semantic roles,
 * never ramp steps** (`S7`). That is what makes a future dark mode a second mapping file
 * rather than a rewrite, and it is what lets `E13-13`'s contrast test reason about these
 * components at all — the test walks the role map, which a component reaching into a ramp
 * would escape.
 *
 * Four of these files exist at paths `config/eslint-design-system.js` names explicitly, and
 * they are the only files in the repository allowed to do what they do:
 *
 *   cart/CartBadge.tsx              the one `withSpring` (`S4`, `M06`)
 *   motion/CollapsibleContainer.tsx height animation (`M04`)
 *   motion/InlineError.tsx          height animation (`M10`)
 *   motion/SwipeRow.tsx             height animation (`M14`)
 *
 * A fifth exemption is a decision-log line, not an edit (`S32`).
 */

export { Button, BUTTON_MIN_HEIGHT, type ButtonVariant } from './Button';
export {
  Screen,
  SCREEN_TEST_ID,
  STACK_SCREEN_EDGES,
  TAB_SCREEN_EDGES,
  type ScreenEdge,
} from './Screen';
export { TextField } from './TextField';
export { Card, EmptyState, ErrorState, ListRow, Skeleton } from './Surfaces';
export { Sheet, Tabs, type TabItem } from './Tabs';
export { TabIcon } from './TabIcon';

export { CartBadge, CART_BADGE_MIN_SIZE, useCountCrossFade } from './cart/CartBadge';
export { CollapsibleContainer } from './motion/CollapsibleContainer';
export { InlineError } from './motion/InlineError';
export { SwipeRow, ARM_THRESHOLD } from './motion/SwipeRow';

/**
 * The brand furniture (`E21`). One implementation of the header, the veg mark and the pattern
 * tile, because eight screens are about to use them and a second copy is how two screens come
 * to disagree about what the product looks like.
 */
export {
  AllergenFlag,
  BrandHeader,
  BrandPanel,
  FoodTypeMark,
  Lockup,
  PatternTile,
  SectionHeading,
} from './Brand';

