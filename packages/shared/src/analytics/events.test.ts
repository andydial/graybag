import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  ALLOWED_EVENTS,
  COMMON_PROPERTIES,
  EVENT_PROPERTIES,
  FORBIDDEN_KEYS,
  checkEvent,
  checkIdentify,
  isEventSafe,
  type AllowedEvent,
} from './events.js';

/**
 * `E15-17`. **A test that fails if a child field can be attached to any event, property, or
 * person profile** — Andy's words, and the shape he asked for.
 *
 * The asymmetry is the design. A missing funnel step costs a question nobody can answer this
 * month. A child's name in a third-party analytics dashboard is behavioural monitoring of a
 * child under DPDP **s.9(3)**, about a minor, in a product whose whole compliance story is that
 * this cannot happen. So the default is refusal and the burden is on the sender.
 */
const CHILD_FIELDS = {
  first_name: 'Aarav',
  last_name: 'Sharma',
  class_label: '5',
  section_label: 'B',
  allergy_note: 'severe peanut allergy',
  allergen_ids: ['a1'],
  recipient_id: 'r-1',
  dish_name: 'Wheat Jaggery Cake',
  date_of_birth: '2018-04-02',
};

describe('no child field reaches an event', () => {
  it.each(Object.entries(CHILD_FIELDS))('refuses %s on every allowed event', (key, value) => {
    for (const event of ALLOWED_EVENTS) {
      const rejections = checkEvent(event, { distinct_id: 'u-1', [key]: value });
      expect(rejections.length).toBeGreaterThan(0);
      expect(rejections[0]?.reason).toBe('forbidden_property');
    }
  });

  it('refuses a child field on a person profile, which is the sharper edge', () => {
    // An event property rides one event. A person property is attached to every event that
    // identity ever sends, past and future — a permanent label on a profile.
    const rejections = checkIdentify('u-1', { first_name: 'Aarav' });
    expect(rejections).toEqual([{ reason: 'forbidden_property', detail: 'first_name' }]);
  });

  it('refuses ANY person property, not only the forbidden ones', () => {
    // identify() takes an id and nothing else. A property that looks innocent today is what a
    // profile quietly accumulates.
    expect(checkIdentify('u-1', { favourite_school: 'Amity' })).toHaveLength(1);
    expect(checkIdentify('u-1')).toEqual([]);
  });

  it('is case-insensitive, because camelCase is what a component would send', () => {
    // The API layer speaks snake_case and the components speak camelCase; both occur in this
    // codebase, and a guard that knew only one would be half a guard.
    expect(isEventSafe('child_added', { distinct_id: 'u-1', firstName: 'Aarav' })).toBe(false);
    expect(isEventSafe('child_added', { distinct_id: 'u-1', className: 'x' })).toBe(false);
  });
});

describe('the allowlist fails closed', () => {
  it('refuses an event that is not declared', () => {
    expect(checkEvent('dish_viewed', { distinct_id: 'u-1' })).toEqual([
      { reason: 'unknown_event', detail: 'dish_viewed' },
    ]);
  });

  it('refuses a property nobody declared, even a harmless-looking one', () => {
    // This is the case a denylist misses. `school_name` is not a child's name and is still not
    // on the schema, so it is refused rather than quietly sent — the failure mode that matters
    // is the convenient property added in six months by somebody solving a real problem.
    const rejections = checkEvent('menu_browsed', { distinct_id: 'u-1', school_name: 'Amity' });
    expect(rejections).toEqual([{ reason: 'undeclared_property', detail: 'school_name' }]);
  });

  it('accepts exactly what the schema declares', () => {
    expect(isEventSafe('payment_started', {
      distinct_id: 'u-1', app_version: '4.0.0', platform: 'ios', app_env: 'production',
      attempt_no: 2, resumed: true,
    })).toBe(true);
  });

  it('child_added carries no properties beyond the common set, deliberately', () => {
    // The one event whose name invites a property — which school, which class, how many children
    // now. Every one of those is an attribute of a child; the funnel question is only whether
    // the step happened.
    expect(EVENT_PROPERTIES.child_added).toEqual([]);
    expect(isEventSafe('child_added', { distinct_id: 'u-1', child_count: 2 })).toBe(false);
  });

  it('never sends an email, even though a parent’s email is not a child’s data', () => {
    expect(isEventSafe('signin_completed', { distinct_id: 'u-1', email: 'a@b.com' })).toBe(false);
  });
});

describe('the schema and the documentation agree', () => {
  /**
   * The failure this guards: the table in `docs/posthog.md` is what a human reads before adding
   * an event, and code that has drifted from it is worse than no documentation — it is confident
   * and wrong. Every allowed event must appear in the doc.
   */
  it('every allowed event appears in docs/posthog.md', () => {
    const doc = readFileSync(
      fileURLToPath(new URL('../../../../docs/posthog.md', import.meta.url)),
      'utf8',
    );
    const missing = ALLOWED_EVENTS.filter((e) => !doc.includes(`\`${e}\``));
    expect(missing).toEqual([]);
  });

  it('every declared property appears in the doc too', () => {
    const doc = readFileSync(
      fileURLToPath(new URL('../../../../docs/posthog.md', import.meta.url)),
      'utf8',
    );
    const declared = new Set<string>([
      ...COMMON_PROPERTIES,
      ...Object.values(EVENT_PROPERTIES).flat(),
    ]);
    const missing = [...declared].filter((p) => !doc.includes(`\`${p}\``));
    expect(missing).toEqual([]);
  });

  it('the forbidden list covers the fields the recipient table actually has', () => {
    // Same coupling as the Sentry scrubber: a migration adding a personal column must not be able
    // to open a hole here by nobody noticing.
    const schema = readFileSync(
      fileURLToPath(new URL('../../../../supabase/migrations/0001_initial_schema.sql', import.meta.url)),
      'utf8',
    );
    const table = schema.slice(
      schema.indexOf('create table recipient'),
      schema.indexOf(');', schema.indexOf('create table recipient')),
    );
    const columns = [...table.matchAll(/^\s{2}([a-z_]+)\s/gm)]
      .map((m) => m[1])
      .filter((c): c is string => typeof c === 'string');
    const sensitive = columns.filter(
      (c) => /name|class|section|allerg|phone|email|birth/.test(c) && !/school_id|kitchen_id/.test(c),
    );

    expect(sensitive.length).toBeGreaterThan(0);
    const forbidden = new Set<string>(FORBIDDEN_KEYS.map((k) => k.toLowerCase()));
    expect(sensitive.filter((c) => !forbidden.has(c))).toEqual([]);
  });
});

describe('an unknown event name cannot smuggle a child field', () => {
  it('reports the unknown event rather than silently passing its properties', () => {
    // Belt and braces: the event is refused first, so the properties are never examined — but a
    // future refactor that reordered those checks would be caught here.
    const rejections = checkEvent('child_profile_viewed', { first_name: 'Aarav' } as Record<string, unknown>);
    expect(rejections.some((r) => r.reason === 'unknown_event')).toBe(true);
    expect(isEventSafe('child_profile_viewed', { first_name: 'Aarav' })).toBe(false);
  });

  it('every allowed event is a known key in EVENT_PROPERTIES', () => {
    for (const event of ALLOWED_EVENTS) {
      expect(EVENT_PROPERTIES[event as AllowedEvent]).toBeDefined();
    }
  });
});
