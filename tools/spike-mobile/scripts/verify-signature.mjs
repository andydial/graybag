#!/usr/bin/env node
/**
 * Verify the checkout CALLBACK signature — §12 checklist item 9, and the thing that makes
 * `POST /checkout/:group/verify` either work or reject every legitimate payment.
 *
 * The design states: HMAC-SHA256(key_secret, `${order_id}|${payment_id}`), hex.
 * This script proves or disproves exactly that, using a real payment from the spike.
 *
 *   export RAZORPAY_KEY_SECRET=xxxx
 *   node scripts/verify-signature.mjs --order order_xxx --payment pay_xxx --signature abc123
 *
 * Note this is the CALLBACK signature, which is a different construction and a different
 * secret from the WEBHOOK signature (item 8: HMAC-SHA256(webhook_secret, raw_body)).
 * §5.6 exists because confusing the two is indistinguishable from an attack in the logs.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const SECRET = process.env.RAZORPAY_KEY_SECRET
if (!SECRET) {
  console.error('Set RAZORPAY_KEY_SECRET (the same test secret that created the order).')
  process.exit(1)
}

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`)
  return i === -1 ? null : process.argv[i + 1]
}

const orderId = arg('order')
const paymentId = arg('payment')
const signature = arg('signature')

if (!orderId || !paymentId || !signature) {
  console.error('Usage: --order order_xxx --payment pay_xxx --signature <hex>')
  process.exit(1)
}

const expected = createHmac('sha256', SECRET).update(`${orderId}|${paymentId}`).digest('hex')

const a = Buffer.from(expected, 'utf8')
const b = Buffer.from(signature, 'utf8')
const match = a.length === b.length && timingSafeEqual(a, b)

console.log(`payload   ${orderId}|${paymentId}`)
console.log(`expected  ${expected}`)
console.log(`received  ${signature}`)
console.log(`\n${match ? 'MATCH — item 9 confirmed as specified.' : 'NO MATCH'}`)

if (!match) {
  console.log('\nIf this does not match, the design is wrong about item 9 and every')
  console.log('/verify call would reject a legitimate payment. Before concluding that,')
  console.log('check the obvious: is this the secret belonging to the key that created')
  console.log('the order, and are the ids pasted whole?')
  process.exitCode = 1
}
