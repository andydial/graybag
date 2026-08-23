/**
 * The demo state for `/admin/alerts` — `E08-16`.
 *
 * Carries the three states worth auditing, because `check:a11y` walks this and a fixture showing
 * only a healthy list audits a page nobody has a problem with:
 *
 * - a kitchen with recipients, one of them **paused** — the difference this screen exists for;
 * - a kitchen with **nobody listed**, which means orders arrive and no one is told;
 * - a labelled and an unlabelled address, since the label is optional.
 */
import type { api } from '@graybag/shared';

export const ALERTS_FIXTURE: {
  kitchens: { id: string; name: string }[];
  recipients: api.AlertRecipient[];
} = {
  kitchens: [
    { id: 'demo-k1', name: 'Mohali Central' },
    { id: 'demo-k2', name: 'Chandigarh North' },
  ],
  recipients: [
    { id: 'demo-r1', kitchenId: 'demo-k1', email: 'kitchen@example.invalid', label: 'Kitchen lead', isEnabled: true },
    { id: 'demo-r2', kitchenId: 'demo-k1', email: 'owner@example.invalid', label: null, isEnabled: true },
    // Paused, not removed — the state the toggle exists for.
    { id: 'demo-r3', kitchenId: 'demo-k1', email: 'onleave@example.invalid', label: 'On leave until September', isEnabled: false },
    // demo-k2 has nobody: orders would arrive with no email at all.
  ],
};
