// Metro configuration.
//
// TWO PROBLEMS, BOTH OF WHICH ONLY APPEAR WHEN THE APP IS ACTUALLY BUNDLED.
//
// Neither was caught by CI, because CI typechecks, lints and unit-tests — and none of those
// three uses Metro. `jest-expo` resolves modules with Jest's resolver, `tsc` with TypeScript's,
// and `vitest` with Vite's. All three are more forgiving than Metro in exactly the way that
// matters below, so the app typechecked and 496 tests passed against a bundle that could not
// be produced. The first `eas build` failed in the "Bundle JavaScript" phase.
//
// 1. `packages/shared` is `"type": "module"` and its sources import each other with an
//    explicit `.js` extension — `import { … } from './env.js'` inside `index.ts`, referring to
//    `env.ts`. That is what TypeScript's ESM resolution requires and it is correct; it is also
//    something Metro does not do, so it looks for a literal `env.js` and finds nothing. The
//    resolver below retries `.ts`/`.tsx` before giving up, rather than the alternative of
//    stripping the extensions from the package and breaking its own typecheck.
//
// 2. This is an npm-workspaces monorepo, so `@graybag/shared` lives outside the app directory
//    and reaches it through a symlink. Metro needs to be told to watch the workspace root and
//    where to look for modules; it does not infer either.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// (2) — see above.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// (1) — see above.
//
// Scoped to *relative* specifiers ending in `.js`, which is exactly the TypeScript-ESM shape.
// A bare specifier like `react-dom/client.js` is left alone: that is a real path into a real
// package, and retrying it as `.ts` would mask a genuine missing dependency.
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;

  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    try {
      // Extensionless, so Metro applies its own `sourceExts` and finds the `.ts`/`.tsx`.
      return resolve(context, moduleName.slice(0, -'.js'.length), platform);
    } catch {
      // A real `.js` file next to the importer is legitimate. Fall through to the normal
      // resolution rather than turning a missing `.ts` into a confusing error about a path
      // nobody wrote.
    }
  }

  return resolve(context, moduleName, platform);
};

module.exports = config;
