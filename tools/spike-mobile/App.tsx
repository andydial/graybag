/**
 * GrayBag spike harness — E19-01 (Razorpay + UPI) and E19-02 (Android performance).
 *
 * One app, two spikes, one EAS build and one device session. Throwaway by design:
 * nothing here is meant to survive into apps/mobile. What survives is the answers,
 * which go into docs/spike-results.md.
 *
 * Deliberately has no navigation library. A spike that fails because of the router
 * has told you nothing about Razorpay or about frame timing.
 */
import { useState } from 'react'
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { PaymentSpike } from './src/PaymentSpike'
import { PerfSpike } from './src/PerfSpike'
import { msSinceJsStart } from './src/coldStart'

type Screen = 'home' | 'pay' | 'perf'

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  // Captured once, on first render, before any interaction can skew it.
  const [jsReadyMs] = useState(() => msSinceJsStart())

  return (
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaView style={styles.fill}>
        <StatusBar style="auto" />
        {screen === 'home' ? (
          <View style={styles.home}>
            <Text style={styles.h1}>GrayBag spikes</Text>
            <Text style={styles.sub}>
              First render {jsReadyMs} ms after JS bundle start.{'\n'}
              Real cold start comes from `adb shell am start -W` — see the runbook.
            </Text>

            <Pressable style={styles.btn} onPress={() => setScreen('pay')}>
              <Text style={styles.btnText}>E19-01 · Razorpay + UPI</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={() => setScreen('perf')}>
              <Text style={styles.btnText}>E19-02 · Performance</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.fill}>
            <Pressable style={styles.back} onPress={() => setScreen('home')}>
              <Text style={styles.backText}>‹ back</Text>
            </Pressable>
            {screen === 'pay' ? <PaymentSpike /> : <PerfSpike />}
          </View>
        )}
      </SafeAreaView>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#fff' },
  home: { flex: 1, justifyContent: 'center', padding: 24, gap: 14 },
  h1: { fontSize: 28, fontWeight: '700' },
  sub: { fontSize: 13, color: '#666', marginBottom: 16, lineHeight: 19 },
  btn: { backgroundColor: '#111', borderRadius: 12, padding: 18 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  back: { padding: 14 },
  backText: { fontSize: 16, color: '#0a58ca' },
})
