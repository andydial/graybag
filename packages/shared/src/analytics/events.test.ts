import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  ALLOWED_EVENTS,
  COMMON_PROPERTIES,
  EVENT_PROPERTIES,
  FORBIDDEN_KEYS,
  ENUM_VALUES,
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

describe('E15-21 — property VALUES are a closed vocabulary, not just keys', () => {
  it('refuses a screen name that is not on the list', () => {
    // The reason this check exists. `screen` is the schema's first string property, and a screen
    // name is exactly where a child's name reaches a vendor. A key check passes this happily.
    const rejections = checkEvent('screen_viewed', { distinct_id: 'u-1', screen: "Aarav's orders" });
    expect(rejections).toEqual([{ reason: 'forbidden_value', detail: 'screen' }]);
  });

  it('names the key and never the value it refused', () => {
    // A rejection is a log line. Echoing the offending value would write the child's name into
    // the log to explain why it was kept out of the vendor.
    const [rejection] = checkEvent('screen_viewed', { distinct_id: 'u-1', screen: 'Aarav' });
    expect(JSON.stringify(rejection)).not.toContain('Aarav');
  });

  it('catches an interpolated screen name, which is the subtler version', () => {
    const child = 'Aarav';
    expect(isEventSafe('screen_viewed', { screen: `orders_for_${child}` })).toBe(false);
  });

  it('accepts every name that is on the list', () => {
    for (const screen of ENUM_VALUES.screen ?? []) {
      expect(isEventSafe('screen_viewed', { distinct_id: 'u-1', screen })).toBe(true);
    }
  });

  it('checks the other enumerated properties too', () => {
    expect(isEventSafe('payment_sheet_closed', { outcome: 'dismissed' })).toBe(true);
    expect(isEventSafe('payment_sheet_closed', { outcome: 'whatever' })).toBe(false);
    expect(isEventSafe('signin_started', { method: 'email_otp' })).toBe(true);
    expect(isEventSafe('signin_started', { method: 'magic_wand' })).toBe(false);
  });

  it('leaves non-enumerated properties alone', () => {
    // `line_count` is a number and has no vocabulary; the check must not become a general
    // whitelist of values or every count would need declaring.
    expect(isEventSafe('add_to_cart_tapped', { line_count: 7 })).toBe(true);
  });

  it('still carries no dish on the cart events', () => {
    // The event that would most naturally carry one, and the obvious product question.
    expect(isEventSafe('add_to_cart_tapped', { line_count: 1, dish_name: 'Wheat Jaggery Cake' }))
      .toBe(false);
    expect(isEventSafe('add_to_cart_tapped', { line_count: 1, dish_id: 'd-1' })).toBe(false);
  });

  it('add_child_submitted carries nothing, like child_added', () => {
    expect(EVENT_PROPERTIES.add_child_submitted).toEqual([]);
    expect(isEventSafe('add_child_submitted', { distinct_id: 'u-1', class_label: '5' })).toBe(false);
  });
});

describe('session replay can never be turned on through this client', () => {
  /**
   * Andy, twice, and worth pinning next to a change that adds screen tracking: replay records
   * the screen, which on this app means **children's names and allergy notes as video**. It is
   * the thing the whole design avoids.
   *
   * The allowlist already refuses it — PostHog's replay payloads arrive as `$snapshot` — but
   * "already refuses it" is a property of today's list. This makes it a property of the suite.
   */
  it('refuses $snapshot, which is how replay data would arrive', () => {
    expect(isEventSafe('$snapshot', {})).toBe(false);
    expect(checkEvent('$snapshot', {})[0]?.reason).toBe('unknown_event');
  });

  it('refuses every PostHog reserved event, not just that one', () => {
    for (const reserved of ['$snapshot', '$pageview', '$autocapture', '$rageclick', '$exception']) {
      expect(isEventSafe(reserved, {})).toBe(false);
    }
  });

  it('and the allowlist contains nothing beginning with $', () => {
    // Autocapture, pageviews and replay all arrive under `$`-prefixed names. If one ever appears
    // in ALLOWED_EVENTS, somebody has turned on a vendor feature rather than declared an event.
    expect(ALLOWED_EVENTS.filter((e) => e.startsWith('$'))).toEqual([]);
  });
});
