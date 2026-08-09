import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CartProvider } from './src/cart/CartContext';
import { configureApiFromEnvironment } from './src/env/configure';
import { guardFromEnvironment } from './src/env/guard';
import { RootNavigator } from './src/navigation/RootNavigator';
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
configureApiFromEnvironment();

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
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
          <CartProvider>
            <RootNavigator />
          </CartProvider>
        </SelectedSchoolProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
