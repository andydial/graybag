import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { scrub, scrubText, scrubUser, scrubBreadcrumb, DENIED_KEYS, REDACTED } from './scrub.js';

/**
 * Andy, 2026-08-16: *"assert no child's name, class, section or allergy can reach it. That guard
 * matters more than the reporting."*
 *
 * The asymmetry is the whole design. Losing a crash report costs a debugging session. A child's
 * name and allergies in a third-party error tracker is a reportable personal-data breach about a
 * minor, under the DPDP Act, in a product whose compliance story is that this cannot happen.
 *
 * So the interesting tests here are the ones that fail *closed*: a realistic payload built from
 * the shapes this app actually passes around, asserted to contain none of the child's details
 * anywhere in its serialised form.
 */
const CHILD = {
  first_name: 'Aarav',
  last_name: 'Sharma',
  class_label: '5',
  section_label: 'B',
  allergy_note: 'severe peanut allergy, carries an epipen',
  allergen_ids: ['a1000000-0000-0000-0000-000000000003'],
};

/** Every string a scrubbed payload must never contain, whatever the shape. */
const FORBIDDEN = ['Aarav', 'Sharma', 'peanut', 'epipen', 'a1000000-0000-0000-0000-000000000003'];

const contains = (value: unknown, needle: string) => JSON.stringify(value).includes(needle);

describe('scrub — nothing about a child leaves the device', () => {
  it('removes every tier P and tier S field from a realistic recipient', () => {
    const out = scrub(CHILD);
    for (const needle of FORBIDDEN) expect(contains(out, needle)).toBe(false);
  });

  it('removes them at depth, inside the shapes this app really passes around', () => {
    // An error report is never a bare recipient. It is a request context with the child buried
    // several levels down, which is exactly where a shallow filter fails.
    const event = {
      screen: 'cart',
      request: {
        url: '/functions/v1/checkout',
        body: {
          idempotency_key: 'abc-123',
          lines: [
            { recipient: CHILD, menu_item_id: 'm-1', quantity: 2, unit_price_paise: 6900 },
          ],
        },
      },
      user: { id: 'u-1', email: 'parent@example.com', phone_e164: '+919876543210' },
    };

    const out = scrub(event);
    for (const needle of FORBIDDEN) expect(contains(out, needle)).toBe(false);
    expect(contains(out, 'parent@example.com')).toBe(false);
    expect(contains(out, '9876543210')).toBe(false);
  });

  it('keeps what makes a report worth having', () => {
    // A scrubber that removes everything is indistinguishable from no reporting, and it is the
    // version somebody quietly disables.
    const out = scrub({
      screen: 'cart',
      code: 'price_changed',
      status: 409,
      order_ref: 'GB-APGY7Q',
      total_paise: 7246,
      dish_name_snapshot: 'Wheat Jaggery Cake',
    }) as Record<string, unknown>;

    expect(out.screen).toBe('cart');
    expect(out.code).toBe('price_changed');
    expect(out.status).toBe(409);
    expect(out.order_ref).toBe('GB-APGY7Q');
    expect(out.total_paise).toBe(7246);
    expect(out.dish_name_snapshot).toBe('Wheat Jaggery Cake');
  });

  it('redacts a child named in free text only when it looks like contact detail', () => {
    // Stated as a LIMIT, not a capability. "Aarav" in a message is indistinguishable from any
    // other word, and pretending otherwise would give false confidence. The defence for free
    // text is that we do not put a child's name into messages — asserted by the schema-key test
    // below, and by R6 in review.
    const out = scrubText('checkout failed for Aarav, contact parent@example.com or 9876543210');
    expect(out).toContain('Aarav');
    expect(out).not.toContain('parent@example.com');
    expect(out).not.toContain('9876543210');
  });
});

describe('scrub — the mechanics that make it safe to run during a crash', () => {
  it('survives a cycle instead of hanging', () => {
    // A crash reporter that hangs on a crash is worse than none.
    const a: Record<string, unknown> = { screen: 'cart' };
    a.self = a;
    expect(() => scrub(a)).not.toThrow();
    expect(contains(scrub(a), 'cart')).toBe(true);
  });

  it('keeps an Error usable — message and stack survive, non-enumerably', () => {
    // Spreading an Error loses exactly the parts a report exists for.
    const out = scrub(new Error('checkout failed for parent@example.com')) as Record<string, unknown>;
    expect(out.name).toBe('Error');
    expect(String(out.message)).toContain('checkout failed');
    expect(String(out.message)).not.toContain('parent@example.com');
    expect(typeof out.stack).toBe('string');
  });

  it('bounds depth rather than recursing for ever', () => {
    let deep: Record<string, unknown> = { first_name: 'Aarav' };
    for (let i = 0; i < 40; i += 1) deep = { nested: deep };
    const out = scrub(deep);
    expect(contains(out, 'Aarav')).toBe(false);
  });

  it('redacts values it cannot reason about rather than passing them through', () => {
    const out = scrub({ fn: () => 'x', sym: Symbol('s') }) as Record<string, unknown>;
    expect(out.fn).toBe(REDACTED);
    expect(out.sym).toBe(REDACTED);
  });
});

describe('DENIED_KEYS covers the schema', () => {
  /**
   * **The failure mode this guards.** The list is by field name, so a migration that adds a new
   * personal column and does not add it here silently opens a hole. This reads the real schema
   * and fails when a column whose name says it holds a child's identity is not covered.
   */
  it('covers every recipient column that carries a name, class, section or allergy', () => {
    // ESM: no `__dirname`. The path is resolved from this module's own URL.
    const schema = readFileSync(
      fileURLToPath(new URL('../../../../supabase/migrations/0001_initial_schema.sql', import.meta.url)),
      'utf8',
    );

    const table = schema.slice(
      schema.indexOf('create table recipient'),
      schema.indexOf(');', schema.indexOf('create table recipient')),
    );
    expect(table.length).toBeGreaterThan(50); // the slice found the table, not nothing

    // `m[1]` is `string | undefined` under `noUncheckedIndexedAccess`; the filter is the
    // narrowing, not a cast.
    const columns = [...table.matchAll(/^\s{2}([a-z_]+)\s/gm)]
      .map((m) => m[1])
      .filter((c): c is string => typeof c === 'string');
    const sensitive = columns.filter((c) =>
      /name|class|section|allerg|phone|email/.test(c) && !/school_id|kitchen_id/.test(c),
    );

    expect(sensitive.length).toBeGreaterThan(0);
    const denied = new Set(DENIED_KEYS.map((k) => k.toLowerCase()));
    expect(sensitive.filter((c) => !denied.has(c))).toEqual([]);
  });
});

describe('the three doors into Sentry', () => {
  const CHILD = {
    first_name: 'Aarav',
    class_label: '5',
    section_label: 'B',
    allergy_note: 'severe peanut allergy',
  };

  it('breadcrumb data is scrubbed — the trail is where a screen’s props end up', () => {
    // "opened dish detail" with the whole recipient attached is the realistic version of this.
    const crumb = scrubBreadcrumb({
      category: 'navigation',
      message: 'opened order detail',
      data: { screen: 'order-detail', recipient: CHILD },
    });
    const text = JSON.stringify(crumb);
    for (const needle of ['Aarav', 'peanut']) expect(text).not.toContain(needle);
    expect(text).toContain('order-detail');
  });

  it('a breadcrumb message loses contact details', () => {
    const crumb = scrubBreadcrumb({ message: 'signed in as parent@example.com' });
    expect(String(crumb?.message)).not.toContain('parent@example.com');
  });

  it('user context is reduced to an id — the door with the longest reach', () => {
    // setUser is attached to EVERY subsequent event in the session, so an email here is an email
    // on everything.
    expect(scrubUser({ id: 'u-1', email: 'parent@example.com', username: 'Aarav’s dad' }))
      .toEqual({ id: 'u-1' });
  });

  it('user context with no id yields nothing rather than guessing', () => {
    expect(scrubUser({ email: 'parent@example.com' })).toEqual({});
    expect(scrubUser(null)).toEqual({});
  });
});
