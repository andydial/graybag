/**
 * E19-02 — mid-range Android performance.
 *
 * Three measurements, matching the task:
 *
 *  1. **Cold start** — not measured here. `adb shell am start -W` is the only honest
 *     source; the home screen shows the JS-side half so the two can be compared.
 *  2. **50-item list scroll with images** — the real menu shape. Uses `expo-image`
 *     (not RN `Image`) because that is what `E14` will ship, and a spike that measures
 *     a component we will not use has measured nothing.
 *  3. **A shared-element-style transition** — a hero image expanding from its row into a
 *     detail view, driven on the UI thread by Reanimated.
 *
 * The on-screen FPS counter is a *smoke alarm*, not the measurement. It samples on the JS
 * thread, so it cannot see UI-thread jank — which on Android is most of it. The number
 * that goes in the report comes from `adb shell dumpsys gfxinfo <pkg>`, which counts
 * janky frames on the render thread. The runbook has the commands.
 *
 * Skia is imported and drawn deliberately: `E13-05`'s framework choice assumes it can be
 * on screen during a scroll without costing frames. If that is false, better to know now.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Dimensions, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { Image } from 'expo-image'
import Animated, {
  useAnimatedStyle, useSharedValue, withTiming, Easing, runOnJS,
} from 'react-native-reanimated'
import { Canvas, Circle, Group } from '@shopify/react-native-skia'

const { width: SCREEN_W } = Dimensions.get('window')
const ROW_H = 96

/**
 * 50 rows, remote images, sized as the menu will size them. Picsum is used because it
 * serves real JPEGs at an arbitrary size over a real connection — a local asset would
 * measure decode only and hide the network cost that actually dominates on this audience.
 */
const ITEMS = Array.from({ length: 50 }, (_, i) => ({
  id: String(i),
  name: `Menu item ${i + 1}`,
  price: 40 + ((i * 7) % 100),
  uri: `https://picsum.photos/seed/graybag${i}/160/160`,
}))

function FpsMeter() {
  const [fps, setFps] = useState(0)
  const frames = useRef(0)
  const since = useRef(Date.now())

  useEffect(() => {
    let raf: number
    const tick = () => {
      frames.current++
      const dt = Date.now() - since.current
      if (dt >= 1000) {
        setFps(Math.round((frames.current * 1000) / dt))
        frames.current = 0
        since.current = Date.now()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <View style={styles.fps}>
      <Text style={styles.fpsText}>{fps} fps (JS thread — smoke alarm only)</Text>
    </View>
  )
}

/** A cheap always-animating Skia layer, to see whether it costs frames during scroll. */
function SkiaLayer({ on }: { on: boolean }) {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => setT((x) => x + 0.08), 16)
    return () => clearInterval(id)
  }, [on])
  if (!on) return null
  return (
    <Canvas style={styles.skia} pointerEvents="none">
      <Group>
        <Circle cx={30 + 20 * Math.sin(t)} cy={30} r={16} color="#0a58ca" opacity={0.55} />
        <Circle cx={30 + 20 * Math.cos(t)} cy={30} r={10} color="#e0592a" opacity={0.55} />
      </Group>
    </Canvas>
  )
}

export function PerfSpike() {
  const [skiaOn, setSkiaOn] = useState(false)
  const [detail, setDetail] = useState<(typeof ITEMS)[number] | null>(null)
  const [lastTransitionMs, setLastTransitionMs] = useState<number | null>(null)

  // Shared-element-style hero expansion, entirely on the UI thread.
  const progress = useSharedValue(0)
  const originY = useSharedValue(0)
  const startedAt = useRef(0)

  const finish = useCallback((ms: number) => setLastTransitionMs(ms), [])

  const heroStyle = useAnimatedStyle(() => {
    const p = progress.value
    return {
      position: 'absolute',
      left: 16 + (0 - 16) * p,
      top: originY.value + (0 - originY.value) * p,
      width: 64 + (SCREEN_W - 64) * p,
      height: 64 + (260 - 64) * p,
      borderRadius: 8 * (1 - p),
    }
  })

  const open = (item: (typeof ITEMS)[number], y: number) => {
    originY.value = y
    setDetail(item)
    startedAt.current = Date.now()
    progress.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }, (done) => {
      'worklet'
      if (done) runOnJS(finish)(Date.now() - startedAt.current)
    })
  }

  const close = () => {
    progress.value = withTiming(0, { duration: 260, easing: Easing.in(Easing.cubic) }, (done) => {
      'worklet'
      if (done) runOnJS(setDetail)(null)
    })
  }

  return (
    <View style={styles.fill}>
      <View style={styles.bar}>
        <Pressable onPress={() => setSkiaOn((v) => !v)} style={styles.toggle}>
          <Text style={styles.toggleText}>Skia layer: {skiaOn ? 'ON' : 'off'}</Text>
        </Pressable>
        {lastTransitionMs !== null && (
          <Text style={styles.stat}>transition {lastTransitionMs} ms</Text>
        )}
      </View>

      <FlatList
        data={ITEMS}
        keyExtractor={(i) => i.id}
        // Left at defaults on purpose. Tuning windowSize/initialNumToRender first would
        // measure the tuning, not the framework. Tune only if the default is too slow.
        getItemLayout={(_, index) => ({ length: ROW_H, offset: ROW_H * index, index })}
        renderItem={({ item, index }) => (
          <Pressable style={styles.row} onPress={() => open(item, index * ROW_H)}>
            <Image
              source={{ uri: item.uri }}
              style={styles.thumb}
              contentFit="cover"
              transition={120}
              cachePolicy="memory-disk"
            />
            <View style={styles.rowText}>
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowPrice}>₹{item.price}</Text>
            </View>
          </Pressable>
        )}
      />

      {detail && (
        <Pressable style={styles.detail} onPress={close}>
          <Animated.View style={heroStyle}>
            <Image source={{ uri: detail.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          </Animated.View>
          <Text style={styles.detailHint}>tap anywhere to close</Text>
        </Pressable>
      )}

      <SkiaLayer on={skiaOn} />
      <FpsMeter />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  toggle: { backgroundColor: '#eee', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  toggleText: { fontSize: 13, fontWeight: '600' },
  stat: { fontSize: 12, color: '#666' },
  row: { flexDirection: 'row', alignItems: 'center', height: ROW_H, paddingHorizontal: 16, gap: 14 },
  thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: '#eee' },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600' },
  rowPrice: { fontSize: 13, color: '#666', marginTop: 2 },
  detail: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.98)' },
  detailHint: { position: 'absolute', bottom: 40, alignSelf: 'center', color: '#666', fontSize: 13 },
  skia: { position: 'absolute', right: 8, bottom: 44, width: 60, height: 60 },
  fps: { position: 'absolute', left: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  fpsText: { color: '#7CFC98', fontFamily: 'monospace', fontSize: 11 },
})
