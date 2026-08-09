/**
 * The one place paise become a string.
 *
 * `design/type.ts` states the rule this file exists to satisfy: money renders with tabular
 * figures, and **neither the formatted output nor the currency symbol is ever hand-assembled
 * in a component**. A component that writes `` `₹${paise / 100}` `` produces `₹49.949999999`
 * on the first value that is not a round rupee, and it does so on one screen out of twenty.
 *
 * **Grouping is Indian, not western** (`3,2,2`): ₹1,00,000, never ₹100,000. Hand-rolled
 * rather than delegated to `Intl.NumberFormat`, because Hermes ships a reduced ICU and the
 * failure mode is a silently western-grouped total on a device nobody tested on.
 *
 * Money is integer paise everywhere (non-negotiable #3) and this function **refuses a float**
 * rather than rounding one. A fractional paise value means someone divided upstream, and
 * rendering it would turn a money bug into a plausible-looking string.
 */

export const RUPEE = '₹';

/** Indian grouping: the last three digits, then in pairs. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;

  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const pairs = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');

  return `${pairs},${last3}`;
}

/**
 * `6000` → `₹60.00`.
 *
 * Always two decimal places. A cart that shows `₹60` above `₹49.95` does not align in a
 * column even with tabular figures, and GST at 5% routinely lands on paise — so the choice
 * is between always showing them and showing them only sometimes, and only-sometimes is the
 * one that looks like a rendering bug.
 */
export function formatPaise(paise: number): string {
  if (!Number.isInteger(paise)) {
    throw new TypeError(`Money must be integer paise (non-negotiable #3), got ${paise}`);
  }

  const negative = paise < 0;
  const absolute = Math.abs(paise);

  const rupees = Math.floor(absolute / 100);
  const remainder = absolute % 100;

  const formatted = `${RUPEE}${groupIndian(String(rupees))}.${String(remainder).padStart(2, '0')}`;

  // The sign leads, ahead of the symbol: "₹-60.00" reads as a typo, "-₹60.00" reads as a
  // refund. Same order the invoice and the ledger use.
  return negative ? `-${formatted}` : formatted;
}
