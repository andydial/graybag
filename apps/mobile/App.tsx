import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CartProvider } from './src/cart/CartContext';
import { configureApiFromEnvironment, missingClientEnvNames } from './src/env/configure';
import { track } from './src/analytics/analytics';
import { guardFromEnvironment } from './src/env/guard';
import { installMenuCache } from './src/menu/installMenuCache';
import { RootNavigator } from './src/navigation/RootNavigator';
import { PolicyGateProvider } from './src/policy/PolicyGateContext';
import { CantConnectScreen } from './src/status/CantConnectScreen';
import { MealPackSurfaceProvider } from './src/packs/MealPackSurfaceContext';
import { VersionGate } from './src/status/VersionGate';
import { ConnectivityProvider } from './src/net/ConnectivityContext';
import { OrderTargetProvider } from './src/session/OrderTargetContext';
import { SchoolFollowsRecipient } from './src/session/SchoolFollowsRecipient';
import { SelectedSchoolProvider } from './src/session/SelectedSchoolContext';
import { SessionProvider } from './src/session/SessionContext';

/**
 * Root component.
 *
 * `SafeAreaProvider` wraps everything because the tab bar and the sticky cart bar both
 * need the bottom inset, and a provider mounted below a navigator gives zero insets on
 * first render — which reads as a layout bug that fixes itself, the most expensive kind
 * to chase.
 *
 * `SessionProvider` sits **above** the navigator and defaults to signed out. Nothing about
 * the route graph is conditional on it (`AR7`): there is no authenticated navigator and no
 * unauthenticated navigator, because two graphs is how "sign in to continue" ends up in
 * front of the menu. There is one graph, and exactly one screen behind a gate.
 *
 * The status bar is `dark` (dark glyphs) because `S11` fixes the app to light mode in v1
 * and every screen behind the bar is `bg.canvas`. The one screen that is not — the green
 * splash — is drawn by the OS from `app.json`, before this component mounts.
 */
// Runs at module load, before anything renders (`E14-11`). A dev build pointed at production
// must fail here rather than three screens later, mid-checkout, having created a real order
// for a real child. A store build is production by definition and is unaffected.
guardFromEnvironment();

// Then configure the backend client, also before first render — the Menu tab fetches on
// mount, and a screen that renders before the client exists would show its error state for
// one frame and then correct itself, which reads as a flicker nobody can reproduce.
//
// Deliberately not fatal: an app with no environment still opens, shows its empty states,
// and names the problem at the call site rather than dying with a stack trace in front of
// a parent (`AR7` — nothing should be a wall in front of browsing).
const apiConfigured = configureApiFromEnvironment();

/**
 * `E15-20`. Module scope, so it fires exactly once per cold start — the funnel's first step.
 *
 * `is_first_open` is `false` here rather than guessed: telling a genuine first launch from a
 * relaunch needs persisted state, and the app has no key/value store yet (`installMenuCache`
 * has the same limitation for the same reason). A property that is sometimes wrong is worse
 * than one that is consistently conservative, and PostHog derives first-seen itself.
 */
track('app_opened', { is_first_open: false });

// And install the menu cache, which nothing did until now — `setMenuCache` existed and was
// exported and was called only from tests, so every real build ran with `cache === null` and
// the Menu tab said "this school's menu has not been published" on every school, always.
// See `installMenuCache` for why the unit suites could not see it.
installMenuCache();

export default function App() {
  /**
   * The one case where the app genuinely cannot work, said out loud.
   *
   * `configureApiFromEnvironment()` returns false when the environment is incomplete, and until
   * now nothing acted on that: the app opened, every screen failed in its own way, and an
   * unconfigured build read as an empty menu. That is what made a working staging environment
   * look like a data problem for three hours on 2026-08-10.
   *
   * Diagnostics are shown outside production only, and they name the missing VARIABLES, never
   * any value — so a screenshot of this screen is safe to paste anywhere (`R6`).
   */
  if (!apiConfigured) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <CantConnectScreen
          showDiagnostics={process.env.EXPO_PUBLIC_APP_ENV !== 'production'}
          appEnv={process.env.EXPO_PUBLIC_APP_ENV ?? 'unknown'}
          missing={missingClientEnvNames()}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {/*
        `E17-46`. Outermost of the real providers, because a build below the floor must not be
        able to reach anything — not the menu, not the cart, not a checkout that would fail
        against a schema it does not know about.

        Above `SessionProvider` on purpose: a parent does not have to be signed in to be told
        their build is too old, and the oldest builds are the ones most likely to fail at the
        auth call itself. Children render while the answer is unknown, so this is not a wall in
        front of browsing (`AR7`) — see `VersionGate`.
      */}
      <VersionGate>
      <ConnectivityProvider>
        <SessionProvider>
        <SelectedSchoolProvider>
          {/*
            The cart sits *inside* the school provider and *above* the navigator. Inside,
            because a line is priced for a school and changing school is a cart-level event;
            above, because the badge on the tab bar and the cart screen itself must read the
            same cart, and a provider mounted per-screen would give them two.

            It is deliberately not inside any session gate: `AR7` — the cart fills signed
            out, and the only gate in the app is at checkout.
          */}
          {/*
            `OrderTargetProvider` was written, exported, and **mounted nowhere** — so every
            screen read the context's DEFAULT value, `target` was permanently null, and no
            amount of fixing `setTarget` could have helped. The fifth instance this week of
            "both sides written, the wire missing, every test green"; the orphan guard
            (`src/architecture/orphans.test.ts`) exists to make the sixth impossible.

            Inside the school provider, because `SchoolFollowsRecipient` below reads both and
            makes the school follow whoever the order is for — one answer to "which school",
            instead of two that drift.
          */}
          <OrderTargetProvider>
            <SchoolFollowsRecipient>
              <CartProvider>
                {/*
                  The policy-version acceptance gate (`E20-36`). Above the navigator because
                  the cart decides whether to open it and the gate screen renders it — two
                  screens that must agree on one answer, which is what `OrderTargetProvider`
                  above did not have and why it silently read its own default for weeks.

                  Inside the session provider, because it reads `useAudience`: a visitor has
                  no user id and so can have nothing pending, and it must not fire a request
                  in front of the menu for someone who has not signed in (`AR7`).
                */}
                <PolicyGateProvider>
                  {/*
                    `E21`. Inside the school provider because the answer is per school, and
                    inside the session provider because it is also per parent — a balance is
                    theirs. Above the navigator because the Account row, the pack screens and
                    the cart strip must all read ONE answer: fetched per screen they would land
                    at different moments, and a parent could watch the Account row disappear
                    while standing on the balance screen it led to (`D2`).
                  */}
                  <MealPackSurfaceProvider>
                    <RootNavigator />
                  </MealPackSurfaceProvider>
                </PolicyGateProvider>
              </CartProvider>
            </SchoolFollowsRecipient>
          </OrderTargetProvider>
        </SelectedSchoolProvider>
        </SessionProvider>
      </ConnectivityProvider>
      </VersionGate>
    </SafeAreaProvider>
  );
}
