/**
 * Who is emailed when an order is paid — `E08-16`.
 *
 * Reads go through PostgREST under the caller's own session and are scoped by
 * `kitchen_alert_recipient_read_admin`, which requires `kitchen.edit` on that kitchen or
 * wider. Writes go through the `admin-alert-recipients` Edge Function (`A4`) — the table has no
 * write policy at all.
 */
import { invokeFunction, runQuery } from './client.js';

export const ALERT_RECIPIENT_COLUMNS = 'id,kitchen_id,email,label,is_enabled,created_at';

export interface AlertRecipient {
  id: string;
  kitchenId: string;
  email: string;
  /** Optional note — "Vivek, kitchen lead". Null when nobody bothered. */
  label: string | null;
  /** `false` pauses the alerts without losing the address. */
  isEnabled: boolean;
}

export class AlertRecipientError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'AlertRecipientError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const toRecipient = (r: Record<string, unknown>): AlertRecipient => ({
  id: str(r.id),
  kitchenId: str(r.kitchen_id),
  email: str(r.email),
  label: typeof r.label === 'string' && r.label !== '' ? r.label : null,
  isEnabled: r.is_enabled === true,
});

/** Every recipient the caller may see, across every kitchen they hold the grant on. */
export async function fetchAlertRecipients(): Promise<AlertRecipient[]> {
  const rows = await runQuery<unknown>((t) =>
    t.from('kitchen_alert_recipient').select(ALERT_RECIPIENT_COLUMNS).order('email'),
  );
  return rows.filter(isRecord).map(toRecipient);
}

/**
 * Add an address to a kitchen's list.
 *
 * Lower-cased here as well as in the function, because the column is `citext` and the unique
 * index means it: showing `Andy@` in the list and storing `andy@` would make the same address
 * look like two different rows to whoever is reading the screen.
 */
export async function addAlertRecipient(input: {
  kitchenId: string;
  email: string;
  label?: string | null;
}): Promise<AlertRecipient> {
  const email = input.email.trim().toLowerCase();
  if (email === '') throw new AlertRecipientError('An address is required.');

  const payload = await invokeFunction<unknown>('admin-alert-recipients', {
    add: { kitchenId: input.kitchenId, email, label: input.label ?? null },
  });
  if (!isRecord(payload) || !isRecord(payload.recipient)) {
    throw new AlertRecipientError('The address was not added.');
  }
  return toRecipient(payload.recipient);
}

/** Pause or resume without losing the address. */
export async function setAlertRecipientEnabled(
  id: string,
  isEnabled: boolean,
): Promise<AlertRecipient> {
  const payload = await invokeFunction<unknown>('admin-alert-recipients', {
    toggle: { id, isEnabled },
  });
  if (!isRecord(payload) || !isRecord(payload.recipient)) {
    throw new AlertRecipientError('The change was not saved.');
  }
  return toRecipient(payload.recipient);
}

/** Remove an address entirely. Pausing is `setAlertRecipientEnabled`; these are different acts. */
export async function removeAlertRecipient(id: string): Promise<void> {
  await invokeFunction<unknown>('admin-alert-recipients', { remove: { id } });
}
