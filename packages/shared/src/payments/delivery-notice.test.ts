import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatBreakTime,
  sendDeliveryNotice,
  TEMPLATE_ORDER_DELIVERED,
} from '../../../../supabase/functions/_shared/delivery-notice.js';

/**
 * `E21-99`. **The delivery email, tested by running it.**
 *
 * `order-confirmation.test.ts` reads its module's source, because that one is reachable only
 * through two Edge Functions and there is no runtime here that can drive it. This one does not
 * need that compromise: `sendDeliveryNotice` takes its Supabase client as an argument and its
 * only other dependencies are `fetch` and `Deno.env`, both of which are stubbable. So these are
 * behavioural assertions — what it sends, what it does not send, and what it leaves behind —
 * which is what Andy asked for:
 *
 *   * *"a second delivered transition sends nothing"*
 *   * *"a failed send still leaves a visible row"*
 *
 * Reading the source would have proved neither.
 */

// --------------------------------------------------------------------------- the fake backend

interface Recorded {
  inserted: Record<string, unknown>[];
  updated: { patch: Record<string, unknown>; filters: [string, unknown][] }[];
}

/** What each table answers. `claimError` makes the unique index fire. */
interface Fixture {
  order?: Record<string, unknown> | null;
  user?: Record<string, unknown> | null;
  recipient?: Record<string, unknown> | null;
  lines?: Record<string, unknown>[];
  school?: Record<string, unknown> | null;
  platform?: Record<string, unknown> | null;
  breakTime?: Record<string, unknown> | null;
  claimError?: { code: string } | null;
}

/**
 * A thenable query builder.
 *
 * `select`, `eq` and `order` chain; `maybeSingle` resolves; and `order` is sometimes the LAST call
 * (the `order_line` read awaits it directly), so the builder itself has to be awaitable. That is
 * why `then` is here rather than a plain object being returned.
 */
function makeAdmin(fixture: Fixture, log: Recorded) {
  const rowsFor = (table: string): { data: unknown } => {
    switch (table) {
      case 'order':
        return { data: fixture.order === undefined ? ORDER : fixture.order };
      case 'app_user':
        return { data: fixture.user === undefined ? USER : fixture.user };
      case 'recipient':
        return { data: fixture.recipient === undefined ? RECIPIENT : fixture.recipient };
      case 'order_line':
        return { data: fixture.lines ?? LINES };
      case 'school':
        return { data: fixture.school === undefined ? SCHOOL : fixture.school };
      case 'platform_config':
        return { data: fixture.platform === undefined ? PLATFORM : fixture.platform };
      case 'break_time':
        return { data: fixture.breakTime === undefined ? BREAK : fixture.breakTime };
      default:
        return { data: null };
    }
  };

  return {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        maybeSingle: () => Promise.resolve(rowsFor(table)),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(rowsFor(table)).then(resolve),
        insert: (row: Record<string, unknown>) => {
          log.inserted.push(row);
          return Promise.resolve({ error: fixture.claimError ?? null });
        },
        update: (patch: Record<string, unknown>) => {
          const filters: [string, unknown][] = [];
          const chain = {
            eq: (col: string, val: unknown) => {
              filters.push([col, val]);
              return chain;
            },
            then: (resolve: (v: unknown) => unknown) => {
              log.updated.push({ patch, filters });
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return chain;
        },
      };
      return builder;
    },
  } as never;
}

const ORDER = {
  id: 'o-1',
  order_ref: 'GB-AB12CD',
  service_date: '2026-09-18',
  delivered_at: '2026-09-18T05:12:00.000Z',
  customer_user_id: 'u-1',
  recipient_id: 'r-1',
  school_id: 's-1',
  break_time_id: 'b-1',
  correlation_id: 'c-1',
};
const USER = { id: 'u-1', email: 'parent@example.com', first_name: 'Priya' };
const RECIPIENT = { first_name: 'Aarav', is_self: false };
const LINES = [
  { line_no: 1, quantity: 2, dish_name_snapshot: 'Idli Sambar' },
  { line_no: 2, quantity: 1, dish_name_snapshot: 'Masala Dosa' },
];
const SCHOOL = { name: 'Amity International School' };
const PLATFORM = { timezone: 'Asia/Kolkata' };
const BREAK = { label: 'Morning break', starts_at: '10:30:00', ends_at: '11:00:00' };

let log: Recorded;
let fetchMock: ReturnType<typeof vi.fn>;

const run = (fixture: Fixture = {}) => sendDeliveryNotice(makeAdmin(fixture, log), { orderId: 'o-1' });
/** The JSON body of the one provider call, for the content assertions. */
const sentBody = (): { to: string[]; subject: string; html: string } =>
  JSON.parse(String((fetchMock.mock.calls[0]?.[1] as { body: string }).body));
/**
 * The claim row, asserted to exist first.
 *
 * `noUncheckedIndexedAccess` is on, and that is doing real work here rather than being appeased:
 * `log.inserted[0]` really can be absent — that is precisely the `E21-93` failure these tests are
 * about — so a helper that says "there is a row, and here it is" reads better than a non-null
 * assertion that silently turns the interesting case into a crash.
 */
const claimed = (): Record<string, unknown> => {
  const row = log.inserted[0];
  expect(row, 'no notification_delivery row was written at all').toBeDefined();
  return row as Record<string, unknown>;
};

beforeEach(() => {
  log = { inserted: [], updated: [] };
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ id: 'resend-1' }),
    text: async () => '',
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('Deno', {
    env: {
      get: (k: string) =>
        ({ RESEND_API_KEY: 're_test', ORDER_EMAIL_FROM: 'kitchen@graybag.com' })[k] ?? '',
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --------------------------------------------------------------------------- exactly once

describe('exactly once per order, keyed on the state change', () => {
  it('SENDS NOTHING on a second delivered transition', async () => {
    /*
     * Andy's first required test. The kitchen can press *Mark all delivered* and press it again,
     * and `23505` on `uq_notification_one_per_order` is what makes the second press inert even if
     * the caller's own `updated`/`skipped` split were bypassed — two independent guarantees, and
     * this is the one that does not depend on the caller behaving.
     */
    const outcome = await run({ claimError: { code: '23505' } });

    expect(outcome).toBe('already_sent');
    expect(fetchMock).not.toHaveBeenCalled();
    // And it did not paper over its own claim by rewriting the first attempt's row.
    expect(log.updated).toHaveLength(0);
  });

  it('claims BEFORE calling the provider, so a crash mid-send cannot double up', async () => {
    await run();
    expect(log.inserted).toHaveLength(1);
    expect(claimed().status).toBe('queued');
    expect(claimed().template_code).toBe(TEMPLATE_ORDER_DELIVERED);
  });

  it('does NOT key the row on the order GROUP, or a three-day cart emails once', async () => {
    /*
     * The trap, and it is why this does not copy `cancellation-notice.ts` wholesale.
     * `uq_notification_one_per_order_group` is unique on `(order_group_id, template_code,
     * channel)`, and a cart spanning three days is ONE group with THREE orders. Setting the group
     * here would claim once and then collide twice, each collision read as `already_sent`, and two
     * of the three children's meals would go unreported — exactly the digest Andy ruled out.
     */
    await run();
    expect(claimed().order_group_id).toBeNull();
    expect(claimed().order_id).toBe('o-1');
  });
});

// --------------------------------------------------------------------------- always a row

describe('the attempt is always on the record', () => {
  it('A FAILED SEND STILL LEAVES A VISIBLE ROW', async () => {
    // Andy's second required test. `E21-93` was this failure in its worst form: an email that was
    // never attempted, leaving nothing at all in the one table built to make that visible.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'upstream unavailable',
      json: async () => ({}),
    });

    const outcome = await run();

    expect(outcome).toBe('failed');
    expect(log.inserted).toHaveLength(1);
    const last = log.updated.at(-1);
    expect(last?.patch.status).toBe('failed');
    expect(last?.patch.error_text).toContain('resend_502');
    expect(last?.patch.failed_at).toBeTruthy();
  });

  it('records a row when the send is NEVER ATTEMPTED — no provider configured', async () => {
    vi.stubGlobal('Deno', { env: { get: () => '' } });

    const outcome = await run();

    expect(outcome).toBe('suppressed');
    expect(fetchMock).not.toHaveBeenCalled();
    // The row exists and resolves. `queued` for ever would be the same invisibility in a
    // different costume — a reader would think the send was still in flight.
    expect(log.inserted).toHaveLength(1);
    expect(log.updated.at(-1)?.patch.suppressed_reason).toBe('email_provider_not_configured');
  });

  it('records a row when there is no address to send to', async () => {
    // An Apple private-relay opt-out leaves `email` null (`0018`). Not a failure — a customer we
    // cannot email, recorded as such.
    const outcome = await run({ user: { id: 'u-1', email: null, first_name: 'Priya' } });

    expect(outcome).toBe('suppressed');
    expect(log.updated.at(-1)?.patch.suppressed_reason).toBe('no_email_on_account');
  });

  it('never throws, whatever the backend does — the delivery must not depend on it', async () => {
    // Andy: "If the email fails, the order is still delivered." The caller swallows the result;
    // this asserts there is nothing to swallow in the first place.
    const exploding = {
      from() {
        throw new Error('postgrest is down');
      },
    } as never;

    await expect(sendDeliveryNotice(exploding, { orderId: 'o-1' })).resolves.toBe('failed');
  });
});

// --------------------------------------------------------------------------- what it says

describe('what the parent reads', () => {
  it('names the child, the items, the school and the break', async () => {
    const outcome = await run();
    expect(outcome).toBe('sent');

    const body = sentBody();
    expect(body.to).toEqual(['parent@example.com']);
    expect(body.html).toContain('Hi Priya,');
    expect(body.html).toContain('Aarav’s lunch was delivered');
    expect(body.html).toContain('Amity International School');
    expect(body.html).toContain('Morning break');
    expect(body.html).toContain('10:30 am–11:00 am');
    // Quantities, because "2 × Idli Sambar" is how a parent checks the right food arrived.
    expect(body.html).toContain('2 × Idli Sambar');
    expect(body.html).toContain('Masala Dosa');
    expect(body.html).toContain('GB-AB12CD');
    expect(body.html).toContain('For <strong>2026-09-18</strong>');
  });

  it('carries NO DELIVERY TIME — it was the moment the button was pressed', async () => {
    /*
     * `E21-103`. `delivered_at` is when the kitchen reconciled the board, not when the child ate.
     * Andy's read **6:46 pm for a morning break**. A precise wrong time is worse than none, and
     * the break window above already answers the question a parent is asking.
     *
     * The fixture's `delivered_at` is 05:12 UTC — 10:42 in Mohali — so a leaked timestamp would
     * show up here as `10:42`, which is deliberately close to the break window and would be easy
     * to mistake for it by eye.
     */
    await run();

    const body = sentBody();
    expect(body.html).not.toContain('10:42');
    expect(body.html).not.toMatch(/delivered at <strong>/);
    // The break window is still there and is still the only time in the email.
    expect(body.html).toContain('10:30 am–11:00 am');
  });

  it('signs off warmly and asks nothing of the reader', async () => {
    await run();

    const body = sentBody();
    expect(body.html).toContain('Thanks for using GrayBag.');
    // The old line invited a reply to a message nobody needs to answer. On the hundredth read an
    // email that asks something of you is worse than one that does not.
    expect(body.html).not.toContain('sort it out');
    expect(body.html).not.toContain('reply to this email');
  });

  it('reads as Andy’s target shape, in order, once the markup is stripped', async () => {
    /*
     * The whole email as a parent sees it. Asserted as one block rather than as six `toContain`s,
     * because the thing being reviewed is the *shape* — what is present, in what order, and what
     * is absent between the lines. Six independent assertions all pass while the sentences are in
     * the wrong order or a stray phrase sits between them.
     */
    await run();

    const text = sentBody()
      .html.replace(/<li[^>]*>/g, '\n• ')
      .replace(/<\/p>|<\/ul>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{2,}/g, '\n')
      .trim();

    expect(text).toBe(
      [
        'Hi Priya,',
        'Aarav’s lunch was delivered at Amity International School, at Morning break (10:30 am–11:00 am).',
        '• 2 × Idli Sambar',
        '• Masala Dosa',
        'For 2026-09-18. Order GB-AB12CD.',
        'Thanks for using GrayBag.',
      ].join('\n'),
    );
  });

  it('carries NO PRICES — this is a delivery receipt, not an invoice', async () => {
    await run();
    // Andy: "No prices needed." The invoice already exists and carries the money.
    expect(sentBody().html).not.toContain('₹');
    expect(sentBody().html).not.toMatch(/\bpaise\b|\btotal\b/i);
  });

  it('keeps the child’s name OUT of the subject line', async () => {
    await run();
    // Subjects are the part of an email most likely to be read over a shoulder or shown on a
    // lock screen.
    expect(sentBody().subject).toBe('Lunch delivered — order GB-AB12CD');
    expect(sentBody().subject).not.toContain('Aarav');
  });

  it('keeps the child’s name OUT of notification_delivery — non-negotiable #4', async () => {
    /*
     * `0001`'s comment on that table names this exact email as the reason the rule exists: *"A
     * push telling a parent 'Aarav's lunch has been delivered' contains a child's name, and
     * storing it multiplies the copies of children's PII for no operational gain."*
     */
    await run();
    const everythingWritten = JSON.stringify([log.inserted, log.updated]);
    expect(everythingWritten).not.toContain('Aarav');
    expect(everythingWritten).not.toContain('Idli');
  });

  it('says "Your lunch" for an adult ordering for themselves', async () => {
    await run({ recipient: { first_name: 'Priya', is_self: true } });
    expect(sentBody().html).toContain('Your lunch was delivered');
  });

  it('escapes a name rather than letting it become markup', async () => {
    await run({ recipient: { first_name: '<script>x</script>', is_self: false } });
    expect(sentBody().html).not.toContain('<script>');
    expect(sentBody().html).toContain('&lt;script&gt;');
  });

  it('omits what it does not know instead of inventing it', async () => {
    // §5.21. A missing break window, school or delivery time costs those phrases and nothing else
    // — never a blank, never a guess.
    await run({ breakTime: null, school: null, order: { ...ORDER, delivered_at: null } });

    const html = sentBody().html;
    expect(html).toContain('lunch was delivered');
    // No dangling "at", no comma with nothing after it, and nothing stringified into the copy.
    expect(html).not.toContain(' at .');
    expect(html).not.toContain(', .');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('null');
    // The sign-off survives when everything optional is missing.
    expect(html).toContain('Thanks for using GrayBag.');
  });
});

// --------------------------------------------------------------------------- the formatters

describe('the break-time formatter', () => {
  it('renders a break window in the twelve-hour form a parent reads', () => {
    expect(formatBreakTime('10:30:00')).toBe('10:30 am');
    expect(formatBreakTime('13:05:00')).toBe('1:05 pm');
    expect(formatBreakTime('00:15:00')).toBe('12:15 am');
    expect(formatBreakTime('12:00:00')).toBe('12:00 pm');
  });

  it('returns nothing for a time it cannot read', () => {
    for (const bad of [null, undefined, '', 'lunchtime', '99:99']) {
      expect(formatBreakTime(bad)).toBe('');
    }
  });

});
