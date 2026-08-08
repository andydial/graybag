#!/usr/bin/env node
/**
 * Create a Razorpay TEST-mode order on the laptop, so the key secret never reaches the
 * handset (docs/payments-design.md §2.3). Prints the order id to paste into the app.
 *
 * This is also the cheapest way to answer several §12 checklist rows without a device —
 * it prints the full order object, so `receipt` handling (item 13) and `notes` limits
 * (item 14) are observable from the response.
 *
 *   export RAZORPAY_KEY_ID=rzp_test_xxxx
 *   export RAZORPAY_KEY_SECRET=xxxx
 *   node scripts/create-order.mjs --amount 100 --receipt SPIKE-1
 *
 * --amount is in PAISE. 100 = ₹1. Non-negotiable #3: money is integer paise, everywhere,
 * including in a throwaway spike.
 */
const KEY_ID = process.env.RAZORPAY_KEY_ID
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET

if (!KEY_ID || !KEY_SECRET) {
  console.error('Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (test mode) first.')
  process.exit(1)
}
if (!KEY_ID.startsWith('rzp_test_')) {
  // Refusing rather than warning: a live key here creates a real order for real money.
  console.error(`Refusing to run: ${KEY_ID.slice(0, 12)}… is not a test key (rzp_test_…).`)
  process.exit(1)
}

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i === -1 ? d : process.argv[i + 1]
}

const amount = Number(arg('amount', '100'))
const receipt = arg('receipt', `SPIKE-${Date.now()}`)

if (!Number.isInteger(amount) || amount < 100) {
  console.error('--amount must be a whole number of paise, at least 100 (₹1).')
  process.exit(1)
}

const body = {
  amount,
  currency: 'INR',
  receipt,
  // Three keys, matching what §4.1 sends, so item 14 (notes round-trip) is exercised.
  notes: { spike: 'E19-01', order_ref: receipt, correlation_id: 'spike-correlation-1' },
}

const res = await fetch('https://api.razorpay.com/v1/orders', {
  method: 'POST',
  headers: {
    Authorization: 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64'),
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
})

const json = await res.json()

if (!res.ok) {
  console.error(`HTTP ${res.status}`)
  console.error(JSON.stringify(json, null, 2))
  process.exit(1)
}

console.log(JSON.stringify(json, null, 2))
console.log('\n───────────────────────────────────────────')
console.log(`  key id   : ${KEY_ID}`)
console.log(`  order id : ${json.id}`)
console.log(`  amount   : ${json.amount} paise`)
console.log('  paste those three into the E19-01 screen')
console.log('───────────────────────────────────────────')
console.log('\nChecklist notes while you are here:')
console.log(`  item 13 — receipt "${receipt}" accepted. Re-run with the SAME --receipt to`)
console.log('            see whether Razorpay rejects duplicates or silently allows them.')
console.log(`  item 14 — notes echoed back: ${JSON.stringify(json.notes)}`)
