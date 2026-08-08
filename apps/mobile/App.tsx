import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from './src/navigation/RootNavigator';
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
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SessionProvider>
        <RootNavigator />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
