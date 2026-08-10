// The rules that keep the design system and the motion catalogue closed (E13-11).
//
// `docs/design-tokens.md` §9.2 and `docs/motion-system.md` §9 gate 2. Both documents say
// the same thing in different words: **a closed catalogue that lives only in a document
// reopens itself within about three sprints.** A reviewer is expected to reject a bespoke
// animation the way they reject a hard-coded hex, and the only reliable way to make that
// happen is to fail the build rather than to rely on the reviewer having read §6.
//
// These are `no-restricted-syntax` selectors rather than a custom plugin, because every
// one of them is a question about a single AST node and a plugin would be a package to
// maintain for no extra reach. Where a selector genuinely cannot express the rule, that is
// said out loud below rather than approximated silently.
//
// Tested by `scripts/test/eslint-design-system.test.mjs`, which runs ESLint over fixtures
// and asserts each rule fires — because "the rule is in the config" and "the rule works"
// are different claims, and only one of them is worth anything.

/**
 * Where the tokens live. Literals are legal here and nowhere else — this directory is the
 * one place a hex, a font size, a radius or a duration is allowed to be written down.
 */
export const TOKEN_DIR = 'packages/shared/src/design/**';

/**
 * The single module allowed to hold an easing curve.
 *
 * `docs/motion-system.md` §9 gate 1: one motion module, exporting `duration`, `ease` and
 * `spring` and nothing else.
 */
export const MOTION_MODULE = 'packages/shared/src/design/motion.ts';

/**
 * The **native** easing module — the one file in the app allowed to call `Easing.bezier`.
 *
 * `motion.ts` owns the curves as data and cannot own this conversion: turning four numbers
 * into a Reanimated `EasingFunction` needs `react-native-reanimated`, and `motion.ts` is
 * imported by the web build too (`S8`). So the curves need a second home on the native side,
 * and naming it here is what stops there being a third.
 *
 * Added by `E13-03`, which is when the gap showed: the original rule assumed components would
 * consume `ease.*` directly, and Reanimated does not accept an array. Same shape as the
 * `E13-19` finding — the gate was right about the rule and wrong about how many files needed
 * to be inside it.
 */
export const NATIVE_EASING_MODULE = 'apps/mobile/src/motion/easing.ts';

/**
 * The one place `withSpring` is allowed (`S4`).
 *
 * A spring is a fourth *kind* of motion — no fixed duration, it overshoots, and it
 * composes badly with the three curves. It exists once because adding to cart is the only
 * action whose confirmation appears somewhere other than where the user is looking.
 * Everywhere else, attracting the eye is a bug.
 *
 * **This file does not exist yet.** `E13-03` must create the cart badge at this path; the
 * rule is what makes that a decision rather than a detail, because the alternative is a
 * glob that quietly admits a second spring.
 */
export const CART_BADGE_MODULE = 'apps/mobile/src/components/cart/CartBadge.tsx';

/**
 * The three files allowed to animate something other than `transform` / `opacity`.
 *
 * `M04`'s container height, `M10`'s inline error height, `M14`'s row collapse. `E13-19`
 * found that the gate as originally written exempted two files and `M04` was the third
 * height animation — which would have failed every implementation of the catalogue's
 * most-used pattern. Three, and these three.
 *
 * **None of these exist yet**, and naming them here is deliberate: `E13-03` builds them at
 * these paths, and a fourth exemption is a decision-log line rather than an edit.
 */
export const HEIGHT_ANIMATION_MODULES = [
  'apps/mobile/src/components/motion/CollapsibleContainer.tsx', // M04
  'apps/mobile/src/components/motion/InlineError.tsx', // M10
  'apps/mobile/src/components/motion/SwipeRow.tsx', // M14
];

const say = (what, where) => `${what} ${where}`;

/** Colour, type, spacing and radius literals — `docs/design-tokens.md` §9.2. */
export const tokenLiteralRules = [
  {
    selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
    message: say(
      'Colour literal.',
      'Import a role from `@graybag/shared` design tokens — components use `semantic.ts`, never a ramp step (S7). If this is genuinely a new colour, it belongs in `color.ts` with a contrast pair in `contrast.ts`.',
    ),
  },
  {
    selector: 'Literal[value=/rgba?\\s*\\(/]',
    message: say(
      'Colour literal.',
      'The only `rgba()` in the system is `bg.scrim`. Import it.',
    ),
  },
  {
    selector:
      'Property[key.name=/^(fontSize|lineHeight|letterSpacing|fontWeight)$/] > Literal[raw=/^[0-9]/]',
    message: say(
      'Type literal.',
      'Use a token from the `scale` in `type.ts` — every size sits inside a brand band at the band weight (S12), and a literal escapes that.',
    ),
  },
  {
    selector:
      'Property[key.name=/^(borderRadius|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius)$/] > Literal[raw=/^[0-9]/]',
    message: say(
      'Radius literal.',
      'Use `radius.*`. If the corner must shrink to fit, use `clampRadius()`; if it is nested, use `nestedRadius()`.',
    ),
  },
  {
    selector:
      'Property[key.name=/^(margin|marginTop|marginBottom|marginLeft|marginRight|marginHorizontal|marginVertical|padding|paddingTop|paddingBottom|paddingLeft|paddingRight|paddingHorizontal|paddingVertical|gap|rowGap|columnGap)$/] > Literal[raw=/^[1-9]/]',
    message: say(
      'Spacing literal.',
      'Use `space[n]`. The scale is deliberately short — every gap in the product is one of thirteen values, and a fourteenth written inline is how that stops being true. `0` is allowed.',
    ),
  },
];

/** Motion gates — `docs/motion-system.md` §9 gate 2. */
export const motionRules = {
  /** Applies everywhere except the motion module itself. */
  everywhere: [
    {
      selector:
        'CallExpression[callee.name=/^(withTiming|withDelay|withRepeat)$/] Property[key.name="duration"] > Literal[raw=/^[0-9]/]',
      message: say(
        'Duration literal.',
        'Four durations exist — `duration.instant|fast|base|slow` — and no others (S2). A literal `180` is somebody deciding the ceiling does not apply to them.',
      ),
    },
    {
      selector: 'Property[key.name=/^(transitionDuration|animationDuration)$/] > Literal',
      message: say(
        'Duration literal.',
        'Use `duration.*` and let the web build emit the ms value.',
      ),
    },
    {
      selector: 'Property[key.name="transition"] > Literal[value=/(^|[^-\\w])all([^-\\w]|$)/]',
      message: say(
        '`transition: all`.',
        'It animates properties nobody chose, including ones that force layout. Name the property.',
      ),
    },
    {
      /**
       * `E14-18` — **a non-worklet function called from inside a worklet.**
       *
       * This is the rule that would have stopped the first iOS build aborting on the first
       * screen that mounted a `TextField`. `useAnimatedStyle` runs on the **UI runtime**, a
       * second JavaScript runtime; a plain function captured by a worklet is serialized as a
       * *remote function*, and calling one there throws
       *
       *   [Worklets] Tried to synchronously call a Remote Function.
       *
       * In a **debug** build `WorkletRuntime::callGuarded` catches that and reports it to
       * LogBox. **That try/catch is compiled out under `NDEBUG`**, so in every release build
       * the error propagates out of the frame callback as a C++ exception, nothing catches
       * it, and the process aborts. So the failure is invisible in development and fatal in
       * the build you hand to somebody.
       *
       * A unit test cannot catch it: under jest there is one runtime, and the worklet is an
       * ordinary function call that works. `motion/worklet-safety.test.ts` covers the other
       * half — that the allowlisted names really are compiled as worklets.
       *
       * **The allowlist is the point.** Adding a name to it is a claim that the function
       * carries `'worklet'`, and that claim is what the test checks. A helper that is not on
       * the list is not callable from a worklet, which is true.
       *
       * **Known limit, stated rather than implied:** this catches a bare identifier —
       * `resolveDuration(...)` — which is the shape the codebase produces, because tokens are
       * destructured at the top of every module. It does not catch `design.resolveDuration(...)`
       * through a member expression. The test is what covers that residue.
       */
      selector:
        'CallExpression[callee.name=/^(useAnimatedStyle|useDerivedValue|useAnimatedReaction|useAnimatedScrollHandler|useAnimatedProps)$/] CallExpression[callee.type="Identifier"]:not([callee.name=/^(withTiming|withSpring|withSequence|withDelay|withRepeat|withDecay|withClamp|interpolate|interpolateColor|clamp|easingFor|resolveDuration|Number|String|Boolean|Array|parseInt|parseFloat|isNaN|isFinite)$/])',
      message: say(
        'Non-worklet function called inside a worklet.',
        'It runs on the UI runtime, where a captured plain function is a remote function and calling it throws — caught and logged in debug, FATAL in release (E14-18). Give the helper a `\'worklet\'` directive and add it to this allowlist, or hoist the call out of the callback.',
      ),
    },
  ],

  /** Everywhere except `motion.ts`. */
  outsideMotionModule: [
    {
      selector: 'CallExpression[callee.object.name="Easing"][callee.property.name="bezier"]',
      message: say(
        'Easing curve outside `motion.ts`.',
        'Three curves exist, named by role: `ease.standard|enter|exit` (S3). A fourth written inline is a curve nobody chose.',
      ),
    },
    {
      selector: 'Literal[value=/cubic-bezier\\s*\\(/]',
      message: say(
        'Easing curve outside `motion.ts`.',
        'Use `cubicBezier(ease.standard)` — one source, two outputs (S8). A hand-written bezier in a stylesheet is the motion equivalent of a hard-coded hex.',
      ),
    },
  ],

  /** Everywhere except the cart-badge module. */
  outsideCartBadge: [
    {
      selector: 'CallExpression[callee.name="withSpring"]',
      message: say(
        '`withSpring` outside the cart badge.',
        'There is exactly one spring and exactly one place it is allowed (S4). A second one is a new catalogue entry and a decision-log line, not a copy-paste.',
      ),
    },
  ],

  /**
   * Everywhere except the three height-animation modules.
   *
   * **This selector is an approximation and the limit is worth stating.** It catches the
   * common shape — a `useAnimatedStyle` callback returning a style object with a key that
   * is not `transform` or `opacity` — and it does not catch a style assembled elsewhere
   * and returned by reference. That residue is what `E19-02`'s frame-budget gate and
   * review are for. An approximate gate that fires on the ordinary case beats no gate,
   * as long as nobody believes it is complete.
   */
  outsideHeightAnimation: [
    {
      selector:
        'CallExpression[callee.name="useAnimatedStyle"] ReturnStatement > ObjectExpression > Property:not([key.name="transform"]):not([key.name="opacity"])',
      message: say(
        'Animating a property other than `transform` / `opacity`.',
        'Everything else runs on the JS thread or forces layout, which is the frame budget gone on a mid-range Android (P11). Three files are exempt and they implement M04, M10 and M14.',
      ),
    },
  ],
};

const APP_FILES = ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'];

/** Everything, in the order the messages should read. */
const ALL = [
  ...tokenLiteralRules,
  ...motionRules.everywhere,
  ...motionRules.outsideMotionModule,
  ...motionRules.outsideCartBadge,
  ...motionRules.outsideHeightAnimation,
];

/**
 * The flat-config blocks.
 *
 * **Structured as one full set plus narrowing exemptions, and it has to be.** ESLint's
 * flat config *replaces* a rule's options rather than merging them, so four blocks each
 * adding a few `no-restricted-syntax` entries would leave only the last one in force —
 * and the failure would be silent, because a lint config that checks less still passes.
 * So the base block carries every rule, and each exempt path re-states the full set minus
 * the one thing it is allowed to do.
 *
 * Exported as a function so `scripts/test/eslint-design-system.test.mjs` can point it at a
 * fixture directory rather than at the repo.
 */
export function designSystemConfigs({
  tokenDir = TOKEN_DIR,
  motionModule = MOTION_MODULE,
  nativeEasingModule = NATIVE_EASING_MODULE,
  cartBadge = CART_BADGE_MODULE,
  heightModules = HEIGHT_ANIMATION_MODULES,
  /**
   * Rules from elsewhere that also need `no-restricted-syntax` (`E14-02`'s api-module
   * gates).
   *
   * **`no-restricted-syntax` is a single shared slot and this parameter is the only safe
   * way to add to it.** Flat config replaces a rule's options rather than merging them, so
   * a second config block setting the same rule does not extend this set — it deletes it
   * for every file it matches, silently, while the build stays green. That is `S33` stated
   * as a mechanism rather than a warning: anything that needs this rule comes through
   * here, gets composed into `ALL`, and therefore survives every exemption block below.
   */
  extraRestrictedSyntax = [],
  /**
   * Of those extra rules, the ones a given path is exempt from — same shape as the
   * design-system exemptions: `{ [globOrPath]: rules[] }` is not used, because each exempt
   * path already has a block below; instead this names rules dropped for `apiModuleDir`.
   */
  apiModuleDir = null,
  apiModuleExemptRules = [],
  envModuleFiles = [],
  envModuleExemptRules = [],
} = {}) {
  const ALL_COMPOSED = [...ALL, ...extraRestrictedSyntax];

  const exceptComposed = (...excluded) => {
    const drop = new Set(excluded.flat().map((r) => r.selector));
    return ALL_COMPOSED.filter((r) => !drop.has(r.selector));
  };

  return [
    { files: APP_FILES, rules: { 'no-restricted-syntax': ['error', ...ALL_COMPOSED] } },

    // `E14-02`. The `api/` module is the one place a Supabase read may be built, so it
    // drops that rule and keeps every other — including the write-path gate, because
    // "writes go through Edge Functions" is not relaxed by being inside the module. It is
    // the rule the module exists to obey.
    ...(apiModuleDir
      ? [
          {
            files: [apiModuleDir],
            rules: {
              'no-restricted-syntax': ['error', ...exceptComposed(apiModuleExemptRules)],
            },
          },
        ]
      : []),

    // `env.ts` defines the server-only names and its test asserts the list; both must be
    // able to write the strings down.
    ...(envModuleFiles.length > 0
      ? [
          {
            files: envModuleFiles,
            rules: {
              'no-restricted-syntax': ['error', ...exceptComposed(envModuleExemptRules)],
            },
          },
        ]
      : []),

    // The token directory is the one place a literal may be written down. It still may not
    // hold an easing curve, a spring, or a height animation — only `motion.ts` and the
    // named component files get those.
    {
      files: [tokenDir],
      rules: { 'no-restricted-syntax': ['error', ...exceptComposed(tokenLiteralRules)] },
    },

    // The native easing module. Curves only — it may call `Easing.bezier`, and it may not
    // write a colour, a size or a duration.
    {
      files: [nativeEasingModule],
      rules: {
        'no-restricted-syntax': ['error', ...exceptComposed(motionRules.outsideMotionModule)],
      },
    },

    // `motion.ts` is inside the token directory, so it inherits the literal exemption and
    // adds the curve one.
    {
      files: [motionModule],
      rules: {
        'no-restricted-syntax': [
          'error',
          ...exceptComposed(tokenLiteralRules, motionRules.outsideMotionModule),
        ],
      },
    },

    {
      files: [cartBadge],
      rules: {
        'no-restricted-syntax': ['error', ...exceptComposed(motionRules.outsideCartBadge)],
      },
    },

    {
      files: heightModules,
      rules: {
        'no-restricted-syntax': ['error', ...exceptComposed(motionRules.outsideHeightAnimation)],
      },
    },
  ];
}

/** The full rule set, for the test to assert nothing is silently dropped. */
export const ALL_RULES = ALL;
