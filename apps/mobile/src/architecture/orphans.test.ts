import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **Nothing may be half-wired.** Every context, provider and module-level store must have a
 * reader *and* a writer somewhere that is not itself and is not a test.
 *
 * `navigation/reachability.test.ts` is this test's sibling: it catches the navigation flavour
 * of the same defect (a screen with no door). This one catches the state flavour, which has
 * now shipped four times, each time with green tests on both sides:
 *
 * | Defect | Both sides tested | The wire |
 * |---|---|---|
 * | The Menu tab said "this school's menu has not been published" in every build ever made | `cache.test.ts`, `MenuScreen.test.tsx` | **Nothing called `setMenuCache`** — it appeared only in test files, so `cache` was `null` in every real build |
 * | Sign-in was unreachable | `SignInScreen.test.tsx` | The only `navigate('SignIn')` was behind a wall |
 * | Home could never say who it was ordering for | `OrderTargetContext.test.tsx`, `HomeScreen.test.tsx` | **Nothing called `setTarget`** — a type, a provider and readers, and no writer |
 * | `E13`'s design tokens sat unused for weeks | the token unit tests | No component imported them |
 *
 * They are all one shape: **both sides written, both sides unit-tested, the wire between them
 * missing, and every test green — because each side's test substitutes the other.** A screen
 * test mounts the screen directly and passes it a fake provider, which is the one situation a
 * real user is never in. `docs/learnings.md` states the general form: *two units tested in
 * isolation prove nothing about the wire between them*.
 *
 * ## What this asserts
 *
 * For every React context in `src/`:
 *
 * 1. **A reader** — its `use<Name>` hook is *called* from at least one other non-test file.
 * 2. **A writer** — at least one of the function-typed keys it exposes (`setTarget`, `add`,
 *    `refresh`, …) is *called* from at least one other non-test file. Data keys are what
 *    readers take; function keys are what writers call. That split is what makes a source
 *    scan able to tell the two halves apart without a type checker.
 * 3. **A mount** — its `<Name>Provider` is rendered from at least one other non-test file.
 *    This is the one that catches defect 3 in its current form: a provider with readers, a
 *    writer, its own passing test, and nothing rendering it, so every consumer silently gets
 *    the default context value and every setter is a no-op `() => {}`.
 *
 * For every injection seam — an exported `set…`/`install…`/`configure…` function — that it is
 * called from at least one non-test file other than the one that defines it. **An exported
 * setter whose only callers are test files is defect 1, exactly.**
 *
 * For every module-level mutable store (a top-level `let`), that something outside the file
 * uses at least one of its exports, so a singleton cannot sit in the tree wired to nothing.
 *
 * ## What it deliberately does not assert
 *
 * - **That every individual key is used.** `clear` on the cart has no caller yet; that is a
 *   feature not built, not a broken wire. The rule is one writer per store, which is what
 *   distinguishes "wired" from "not wired". Per-key coverage would produce a permanent
 *   exemption list and stop being read.
 * - **That the caller is itself reachable.** `setMenuCache` is called by `installMenuCache`,
 *   which is called by `App.tsx`. If the chain's root came loose the *root* would be flagged,
 *   not the leaf — one link is enough here because the entry point is in the scan.
 * - **File-private `let` caches.** `SchoolPicker`'s `lastLoaded` is written and read in its own
 *   file on purpose; it has no exported writer, so there is no seam to leave dangling.
 * - **`clear…` test-reset helpers.** `clearPendingSignIn` is *supposed* to have only test
 *   callers. It is a different class from `setMenuCache`, which was supposed to have a
 *   production caller and did not. Folding them together would mean exemptions, and an
 *   exemption list with routine entries in it is one nobody reads.
 * - **That the wire carries the right value.** Only that it exists. `E05-16` is what proves
 *   an order reaches a kitchen.
 *
 * ## Why a source scan rather than a runtime crawl
 *
 * Mounting the app and inspecting the live tree would prove the providers *this test remembers
 * to mount* are mounted, which is the same substitution that hid all four defects — the test
 * would supply the wire it is meant to be checking for. Reading the source finds the call
 * wherever it actually is (a screen, a hook, `App.tsx` before first render) and cannot be
 * fooled by a test forgetting to look somewhere. It is also a few milliseconds, so it belongs
 * in the smoke test rather than the nightly.
 *
 * It is not type-aware, and does not need to be: the failure mode being caught is a call that
 * **does not exist anywhere in the repo**, and grep is complete for that question. Comments are
 * stripped before scanning, because `setMenuCache` was named in four doc comments while nothing
 * called it — a scan that counted prose would have declared it wired.
 */

/** `apps/mobile` — `App.tsx` lives here, and it is where the providers are actually mounted. */
const APP_ROOT = join(__dirname, '..', '..');
const SRC = join(__dirname, '..');

/** The app's entry points. Excluding them would call every wire made at startup an orphan. */
const ENTRY_FILES = ['App.tsx', 'index.ts'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/**
 * Comments out, before anything is counted.
 *
 * This is load-bearing rather than tidiness. `setMenuCache` was referenced by name in the doc
 * comments of `useCachedMenu.ts`, `installMenuCache.ts` and `reachability.test.ts` during the
 * entire period in which nothing called it. A scan that read prose as evidence of a wire would
 * have passed the exact defect it exists to catch.
 *
 * `//` preceded by `:` is left alone so a `https://` inside a string does not eat the rest of
 * its line.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1');
}

interface Source {
  path: string;
  name: string;
  code: string;
}

function load(path: string): Source {
  return {
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    code: stripComments(readFileSync(path, 'utf8')),
  };
}

/** Where candidates are found: `src/`, non-test. */
const candidates: Source[] = walk(SRC).map(load);

/** Where wires are looked for: `src/` plus the entry points that do the wiring at startup. */
const callers: Source[] = [
  ...candidates,
  ...ENTRY_FILES.map((f) => join(APP_ROOT, f))
    .filter(existsSync)
    .map(load),
];

/** A real call, not a property access (`subscription.remove()`) and not a mention in prose. */
function callsTo(name: string, exclude: string): string[] {
  const pattern = new RegExp(`(?<![.\\w])${name}\\s*\\(`);
  return callers.filter((s) => s.path !== exclude && pattern.test(s.code)).map((s) => s.path);
}

/** A rendered element: `<CartProvider>`. */
function rendersOf(name: string, exclude: string): string[] {
  const pattern = new RegExp(`<${name}[\\s/>]`);
  return callers.filter((s) => s.path !== exclude && pattern.test(s.code)).map((s) => s.path);
}

/** Any bare mention of the identifier — an import, a call, a JSX tag, an aliased re-export. */
function referencesTo(name: string, exclude: string): string[] {
  const pattern = new RegExp(`(?<![.\\w])${name}(?![\\w])`);
  return callers.filter((s) => s.path !== exclude && pattern.test(s.code)).map((s) => s.path);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function relative(path: string): string {
  return path.slice(APP_ROOT.length + 1);
}

/**
 * `it.each([])` is zero tests and a green run, and `describe.each([])` fails with jest's own
 * *"called with an empty Array of table data"* — which is a failure, but one that says nothing
 * about what it means. Every table below goes through here so that a scan finding nothing
 * explains itself instead of reading as a broken test file.
 */
function nonEmpty<T>(table: T[], what: string): T[] {
  if (table.length === 0) {
    throw new Error(
      `The orphan scan found no ${what} under ${SRC}. Every assertion in this file is a table ` +
        `over a scan result, so an empty scan means the guard tests nothing at all while ` +
        `reporting success — the "Tests: 0" failure E02-24 already shipped once. Either the ` +
        `directory moved, the naming convention changed, or the regexes need updating. Fix ` +
        `the scan; do not delete the assertion.`,
    );
  }
  return table;
}

interface ContextModule {
  source: Source;
  /** `Cart` from `const CartContext = createContext(…)`. */
  base: string;
  hook: string | null;
  provider: string | null;
  /** The function-typed keys of the exposed value — the things a writer calls. */
  actions: string[];
}

/**
 * Function-typed keys, from anywhere in a context module.
 *
 * Matches both halves of how the shape is declared — the interface (`setTarget: (next: X) =>
 * void`) and the default value handed to `createContext` (`refresh: async () => {}`) — so a
 * context declared with an inline type rather than a named interface is still read correctly.
 * Scanning the whole file is safe *because* these files hold nothing but the context; the
 * `>= 1 action` guard below fails loudly if that ever stops being true and the parse returns
 * nothing, rather than passing an empty writer check.
 */
function functionKeys(code: string): string[] {
  return unique(
    [...code.matchAll(/(\w+)\s*:\s*(?:async\s*)?\([^)]*\)\s*(?:=>|:)/g)].map((m) => m[1] as string),
  );
}

const contexts: ContextModule[] = candidates
  .filter((s) => /createContext\s*[<(]/.test(s.code))
  .map((source) => ({
    source,
    base: /(?:const|let)\s+(\w+)Context\s*=\s*createContext/.exec(source.code)?.[1] ?? source.name,
    hook: /export\s+function\s+(use\w+)/.exec(source.code)?.[1] ?? null,
    provider: /export\s+function\s+(\w+Provider)/.exec(source.code)?.[1] ?? null,
    actions: functionKeys(source.code),
  }));

interface Seam {
  source: Source;
  name: string;
}

/**
 * Injection seams: the pattern `setMenuCache` and `setApiTransport` use — module state written
 * once at startup and replaced by tests. It is a good pattern and it has exactly one failure
 * mode, which is forgetting the "once at startup" half.
 */
const seams: Seam[] = candidates.flatMap((source) =>
  [
    ...source.code.matchAll(
      /export\s+(?:async\s+)?(?:function|const)\s+((?:set|install|configure)[A-Z]\w*)/g,
    ),
  ].map((m) => ({ source, name: m[1] as string })),
);

/** Modules holding mutable singleton state — a top-level `let`. */
const stores: Source[] = candidates.filter((s) => /^let\s+\w+/m.test(s.code));

function exportsOf(code: string): string[] {
  return unique(
    [...code.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)].map(
      (m) => m[1] as string,
    ),
  );
}

/**
 * Known half-wired state, each entry naming the task that removes it.
 *
 * Same contract as `KNOWN_DOORLESS` in `reachability.test.ts`, for the same reason: the honest
 * alternative to the two dishonest options, which are faking a wire so the test passes and
 * deleting the assertion. Every entry must name a task id, and the length is pinned below, so
 * an addition is a line in a review rather than a quiet append.
 *
 * **An entry here is a defect that is agreed to be live, not a defect that is forgiven.** If
 * something belongs here because the feature that writes it is not built yet, that is fine; if
 * it belongs here because a wire was forgotten, fix the wire instead.
 */
const KNOWN_ORPHANS: Record<string, string> = {};

/**
 * The tables, built once so an empty scan fails at load with an explanation rather than at
 * `describe.each` with jest's own wording — or, for `it.each`, not at all.
 */
const CONTEXT_TABLE = nonEmpty(contexts, 'React contexts').map((c) => [c.base, c] as const);
const SEAM_TABLE = nonEmpty(seams, 'injection seams (exported set…/install…/configure…)').map(
  (s) => [s.name, s] as const,
);
const STORE_TABLE = nonEmpty(stores, 'module-level stores (a top-level `let`)').map(
  (s) => [relative(s.path), s] as const,
);

describe('nothing is half-wired', () => {
  it('found the modules, so a rename or a moved directory cannot pass this file vacuously', () => {
    // `E02-24` shipped a suite that silently tested nothing. Every assertion below is
    // `it.each` over a scan result, and `it.each([])` is zero tests and a green run — so the
    // scan finding nothing must itself be the failure.
    expect(candidates.length).toBeGreaterThan(30);
    expect(callers.length).toBeGreaterThan(candidates.length);
    expect(contexts.length).toBeGreaterThanOrEqual(4);
    expect(seams.length).toBeGreaterThanOrEqual(1);
    expect(stores.length).toBeGreaterThanOrEqual(1);

    // And that App.tsx is in the caller set. If it is renamed, every provider in the app
    // becomes unmounted as far as this test can see, which is a false failure — but a silent
    // *pass* is the thing that must be impossible, so this is asserted rather than assumed.
    const entries = callers.filter((s) => ENTRY_FILES.includes(s.name));
    if (entries.length === 0) {
      throw new Error(
        `No entry point found in ${APP_ROOT}. This test looks for the wires made before ` +
          `first render (${ENTRY_FILES.join(', ')}); without them it would report every ` +
          `provider as unmounted and every startup seam as uncalled.`,
      );
    }
    expect(entries.length).toBeGreaterThan(0);

    // A context whose shape could not be parsed would silently have no writers to check,
    // which is the empty-check failure mode wearing a different hat.
    for (const ctx of contexts) {
      if (ctx.actions.length === 0 || ctx.hook === null || ctx.provider === null) {
        throw new Error(
          `Could not read the shape of ${relative(ctx.source.path)}: hook=${ctx.hook}, ` +
            `provider=${ctx.provider}, function-typed keys=[${ctx.actions.join(', ')}]. ` +
            `The writer check below has nothing to look for, so it would pass without ` +
            `testing anything. Fix the scan, do not delete the assertion.`,
        );
      }
    }
  });

  describe.each(CONTEXT_TABLE)('%s', (base, ctx) => {
    const where = relative(ctx.source.path);

    it('is read somewhere outside its own file', () => {
      if (KNOWN_ORPHANS[`${base}:reader`] !== undefined) {
        expect(KNOWN_ORPHANS[`${base}:reader`]).toMatch(/E\d\d-\d\d/);
        return;
      }
      const readers = callsTo(ctx.hook as string, ctx.source.path);
      if (readers.length === 0) {
        throw new Error(
          `${where} exports \`${ctx.hook}\` and nothing outside the file calls it. The ` +
            `context exists, its provider exists, its tests pass — and no screen reads it. ` +
            `That is a store nobody looks at: it is the E13 shape, where design tokens sat ` +
            `fully tested and unconsumed for weeks.`,
        );
      }
      expect(readers.length).toBeGreaterThan(0);
    });

    it('is written somewhere outside its own file', () => {
      if (KNOWN_ORPHANS[`${base}:writer`] !== undefined) {
        expect(KNOWN_ORPHANS[`${base}:writer`]).toMatch(/E\d\d-\d\d/);
        return;
      }
      const writers = ctx.actions.flatMap((action) =>
        callsTo(action, ctx.source.path).map((path) => `${action}() in ${relative(path)}`),
      );
      if (writers.length === 0) {
        throw new Error(
          `${where} exposes [${ctx.actions.join(', ')}] and nothing outside the file calls ` +
            `any of them. Every consumer therefore reads the initial value forever. This is ` +
            `defect 3 verbatim: \`OrderTarget\` had a type, a provider and readers, nothing ` +
            `ever called \`setTarget\`, and Home could not say who it was ordering for in ` +
            `any build — with both sides green, because each side's test wrote the value the ` +
            `other side was supposed to.`,
        );
      }
      expect(writers.length).toBeGreaterThan(0);
    });

    /**
     * The sharpest of the three, and the only one that catches a provider that is fully wired
     * on paper. Readers read, writers write, and if nothing renders the provider then React
     * hands every one of them the default context value — where the getters are `null` and
     * every setter is `() => {}`. Nothing throws. Nothing logs. The screen just never changes.
     */
    it('is mounted — something renders its provider', () => {
      if (KNOWN_ORPHANS[`${base}:mounted`] !== undefined) {
        expect(KNOWN_ORPHANS[`${base}:mounted`]).toMatch(/E\d\d-\d\d/);
        return;
      }
      const mounts = rendersOf(ctx.provider as string, ctx.source.path);
      if (mounts.length === 0) {
        throw new Error(
          `<${ctx.provider}> from ${where} is never rendered outside its own file or a test. ` +
            `Its readers all get the default context value, so \`${base}\` is permanently ` +
            `whatever \`createContext\` was given and every setter it exposes is a silent ` +
            `no-op. Mounting it only inside a test is the worst version of this: the test ` +
            `supplies the wire it is meant to be checking for, so it stays green while the ` +
            `app is broken. Mount it in App.tsx.`,
        );
      }
      expect(mounts.length).toBeGreaterThan(0);
    });
  });

  /**
   * Defect 1, as its own rule.
   *
   * `createMenuCache` was written and tested. `setMenuCache` was written, exported and tested.
   * The only callers were test files, so `cache` was `null` in every build ever shipped and the
   * Menu tab told every user "this school's menu has not been published". Both suites green
   * throughout, because each test called the setter itself.
   */
  it.each(SEAM_TABLE)(
    '%s is called from production code, not only from tests',
    (name, seam) => {
      if (KNOWN_ORPHANS[`seam:${name}`] !== undefined) {
        expect(KNOWN_ORPHANS[`seam:${name}`]).toMatch(/E\d\d-\d\d/);
        return;
      }
      // `callers` holds no test files, so any hit here is a production caller by construction.
      const production = callsTo(name, seam.source.path);
      if (production.length === 0) {
        throw new Error(
          `\`${name}\` is exported from ${relative(seam.source.path)} and called from no ` +
            `non-test file. An injection seam only exists to be injected: if the only code ` +
            `that calls it is a test, then in every real build the thing it installs is ` +
            `never installed. That is exactly how the Menu tab shipped saying "this ` +
            `school's menu has not been published" to every user on every school — nothing ` +
            `called \`setMenuCache\`, and both cache and screen suites were green.`,
        );
      }
      expect(production.length).toBeGreaterThan(0);
    },
  );

  it.each(STORE_TABLE)(
    '%s holds module state that something outside the file uses',
    (where, store) => {
      if (KNOWN_ORPHANS[`store:${store.name}`] !== undefined) {
        expect(KNOWN_ORPHANS[`store:${store.name}`]).toMatch(/E\d\d-\d\d/);
        return;
      }
      const names = exportsOf(store.code);
      const used = names.filter((name) => referencesTo(name, store.path).length > 0);
      if (used.length === 0) {
        throw new Error(
          `${where} holds mutable module-level state and nothing outside it uses any of its ` +
            `exports [${names.join(', ')}]. A singleton nobody touches is either dead code ` +
            `or a wire that was never connected, and the two are indistinguishable from ` +
            `inside its own test.`,
        );
      }
      expect(used.length).toBeGreaterThan(0);
    },
  );

  it('every declared orphan names the task that wires it up', () => {
    for (const [key, reason] of Object.entries(KNOWN_ORPHANS)) {
      // An exemption without an owner becomes permanent. This keeps the list shrinking.
      expect(reason).toMatch(/E\d\d-\d\d/);
      // And it must name something the scan actually found, so a stale key cannot sit here
      // silently exempting nothing while the real orphan goes unnoticed under a new name.
      const known = [
        ...contexts.flatMap((c) => [`${c.base}:reader`, `${c.base}:writer`, `${c.base}:mounted`]),
        ...seams.map((s) => `seam:${s.name}`),
        ...stores.map((s) => `store:${s.name}`),
      ];
      if (!known.includes(key)) {
        throw new Error(
          `KNOWN_ORPHANS has an entry for "${key}", which the scan does not produce. Either ` +
            `it was fixed and the exemption was left behind, or it was renamed and is now ` +
            `unguarded. Delete it or correct it.`,
        );
      }
      expect(known).toContain(key);
    }
    // The list must not grow quietly: any addition changes this number in a diff.
    expect(Object.keys(KNOWN_ORPHANS)).toHaveLength(0);
  });
});
