import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppShell } from './src/AppShell';

/**
 * Root component.
 *
 * `SafeAreaProvider` wraps everything because the tab bar and the sticky cart bar both
 * need the bottom inset, and a provider mounted below a navigator gives zero insets on
 * first render — which reads as a layout bug that fixes itself, the most expensive kind
 * to chase.
 *
 * The status bar is `dark` (dark glyphs) because `S11` fixes the app to light mode in v1
 * and every screen behind the bar is `bg.canvas`. The one screen that is not — the green
 * splash — is drawn by the OS from `app.json`, before this component mounts.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AppShell />
    </SafeAreaProvider>
  );
}
