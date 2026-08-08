/**
 * E19-01 — Razorpay Standard Checkout via the official RN SDK, native UPI intent.
 *
 * What this screen is trying to find out, in priority order:
 *
 *  1. Does the UPI **app chooser** appear with the installed PSP apps listed? (§3.3)
 *     If it silently degrades to collect/QR, `E06-29` is a launch blocker and the whole
 *     of `E06-02` needs re-planning. This is the single most important observation.
 *  2. Does the app **come back** cleanly after the PSP app-switch, and does the success
 *     handler fire? (§3.5)
 *  3. **Wall-clock** from tapping Pay to the callback firing — sets the waiting-state
 *     design under `S5` (§12, "two further things").
 *  4. Does the app **survive** the app-switch under memory pressure, or is it killed?
 *     (§3.4 — this decides how often the recovery path actually runs.)
 *
 * The order_id is created on the laptop by `scripts/create-order.mjs` and pasted in. The
 * key secret never reaches the device — that is not spike hygiene, it is §2.3, and doing
 * it the lazy way here would be rehearsing the wrong thing.
 */
import { useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import RazorpayCheckout from 'react-native-razorpay'

/** Filled from `scripts/create-order.mjs` output. Test-mode key id only — never a secret. */
const DEFAULTS = {
  keyId: '',
  orderId: '',
  amountPaise: '100',
}

type LogLine = { t: number; msg: string }

export function PaymentSpike() {
  const [keyId, setKeyId] = useState(DEFAULTS.keyId)
  const [orderId, setOrderId] = useState(DEFAULTS.orderId)
  const [amount, setAmount] = useState(DEFAULTS.amountPaise)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<LogLine[]>([])
  const startedAt = useRef<number>(0)

  const t0 = log.length ? log[0].t : 0
  const say = (msg: string) => setLog((l) => [...l, { t: Date.now(), msg }])

  async function pay() {
    if (!keyId || !orderId) {
      say('ERROR: paste a key id and an order id first (scripts/create-order.mjs)')
      return
    }
    setBusy(true)
    setLog([])
    startedAt.current = Date.now()
    say(`open checkout · order ${orderId}`)

    try {
      // Deliberately minimal. Anything added here is a variable in the experiment.
      // `method` is left unrestricted so the SDK shows its own method list — the point
      // is to observe what IT offers, not to force UPI and learn nothing.
      const data = await RazorpayCheckout.open({
        key: keyId,
        order_id: orderId,
        amount: Number(amount),
        currency: 'INR',
        name: 'GrayBag spike',
        description: 'E19-01',
        prefill: { email: 'spike@example.com', contact: '' },
        notes: { spike: 'E19-01', order_ref: 'SPIKE-1' },
        theme: { color: '#111111' },
      })
      const ms = Date.now() - startedAt.current
      say(`SUCCESS after ${ms} ms`)
      say(`payment_id  ${data.razorpay_payment_id ?? '(none)'}`)
      say(`order_id    ${data.razorpay_order_id ?? '(none)'}`)
      say(`signature   ${data.razorpay_signature ? data.razorpay_signature.slice(0, 16) + '…' : '(none)'}`)
      say('→ paste all three into scripts/verify-signature.mjs (checklist item 9)')
    } catch (e: unknown) {
      const ms = Date.now() - startedAt.current
      const err = e as { code?: number | string; description?: string; message?: string }
      say(`FAILED after ${ms} ms`)
      say(`code        ${String(err?.code ?? '(none)')}`)
      say(`description ${err?.description ?? err?.message ?? '(none)'}`)
      // A cancel is a legitimate result here: it still proves the sheet opened and the
      // app came back, which is observation 2.
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <Text style={styles.h}>E19-01 · Razorpay + UPI intent</Text>

      <Text style={styles.label}>key id (rzp_test_…)</Text>
      <TextInput style={styles.input} value={keyId} onChangeText={setKeyId}
        autoCapitalize="none" autoCorrect={false} placeholder="rzp_test_xxxxxxxx" />

      <Text style={styles.label}>order id (order_…) — from scripts/create-order.mjs</Text>
      <TextInput style={styles.input} value={orderId} onChangeText={setOrderId}
        autoCapitalize="none" autoCorrect={false} placeholder="order_xxxxxxxxxxxx" />

      <Text style={styles.label}>amount in paise — must equal the order's amount</Text>
      <TextInput style={styles.input} value={amount} onChangeText={setAmount}
        keyboardType="number-pad" />

      <Pressable style={[styles.btn, busy && styles.btnOff]} onPress={pay} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Pay</Text>}
      </Pressable>

      <View style={styles.checklist}>
        <Text style={styles.checkH}>While the sheet is open, note:</Text>
        <Text style={styles.check}>1. Does a UPI <Text style={styles.b}>app chooser</Text> list your installed PSP apps? (the whole spike)</Text>
        <Text style={styles.check}>2. Or does it only offer <Text style={styles.b}>collect / QR</Text>? (that is the silent-degradation failure)</Text>
        <Text style={styles.check}>3. After paying in the PSP app, does this app come back and log SUCCESS?</Text>
        <Text style={styles.check}>4. Is the payment <Text style={styles.b}>captured</Text> or only <Text style={styles.b}>authorized</Text> in the Razorpay dashboard? (item 4)</Text>
      </View>

      <View style={styles.log}>
        {log.map((l, i) => (
          <Text key={i} style={styles.logLine}>
            {String(l.t - t0).padStart(6, ' ')}ms  {l.msg}
          </Text>
        ))}
        {!log.length && <Text style={styles.logEmpty}>no run yet</Text>}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  wrap: { padding: 20, gap: 8, paddingBottom: 60 },
  h: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  label: { fontSize: 12, color: '#666', marginTop: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 15 },
  btn: { backgroundColor: '#111', borderRadius: 12, padding: 16, marginTop: 16, minHeight: 52, justifyContent: 'center' },
  btnOff: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  checklist: { backgroundColor: '#fff8e1', borderRadius: 10, padding: 14, marginTop: 18, gap: 6 },
  checkH: { fontWeight: '700', fontSize: 13 },
  check: { fontSize: 13, lineHeight: 18 },
  b: { fontWeight: '700' },
  log: { backgroundColor: '#111', borderRadius: 10, padding: 12, marginTop: 18, minHeight: 90 },
  logLine: { color: '#7CFC98', fontFamily: 'monospace', fontSize: 11, lineHeight: 16 },
  logEmpty: { color: '#666', fontFamily: 'monospace', fontSize: 11 },
})
