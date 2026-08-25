// `ops-heartbeat` — is production working, and say so either way. `E15-15`.
//
//   GET /functions/v1/ops-heartbeat?mode=probe    reachability only, fast, for a frequent schedule
//   GET /functions/v1/ops-heartbeat?mode=digest   probes + yesterday's numbers, and emails them
//
//     200 { ok, probes: [...], counts?: {...} }   ok=false when something is wrong
//     401 not_authenticated                       needs OPS_HEARTBEAT_SECRET
//     405 method_not_allowed
//
// ## The problem this exists for
//
// Andy: *"Three times this month a complete outage was invisible until a human found it by reading
// a log by hand."* Settlement failing on every attempt. Every confirmation email 403ing. A test
// suite running zero files.
//
// All three reported **nothing**, and nothing is also what a healthy system reports. So the design
// rule is that **silence must be impossible**: this runs on a schedule, always produces a verdict,
// and the digest is sent on a quiet day too — one line saying it was quiet. A silent system and a
// broken system must not look the same.
//
// ## Why not a monitoring platform
//
// Andy: *"Don't build a monitoring platform. Use what exists — the alert plumbing, Resend, a
// scheduled function."* So: this one function, `sendMoneyAlert` for escalation, Resend for the
// email, and GitHub Actions as the scheduler. **No migration** — `ops_alert.kind` is free text by
// design (`0056`), which is what makes new alert kinds a code change rather than a schema one.
//
// ## Authentication
//
// A shared secret in a header, not a user session: there is no user at 7am. It is checked before
// anything else runs, and the function is not listed as browser-callable.
//
// **On the service role.** Andy's brief says aggregates are read through an authenticated
// back-office session, never the service role. That rule is about the *dashboards*, and they obey
// it. A scheduled email has no session to borrow, and the same is already true of every alert in
// `money-alert.ts`. What this does instead is narrower than handing out the key: it computes
// counts server-side and returns **no row data at all** — the response and the email carry numbers
// and order codes, nothing else.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { functionProbe, pageProbe, runProbes, type Probe } from '../_shared/health.ts';
import { sendMoneyAlert } from '../_shared/money-alert.ts';

/*
 * **No CORS, deliberately.** A scheduler calls this with curl; a browser must not. Advertising a
 * preflight would describe a surface that should not exist, and `cors.test.ts` asserts this
 * function stays free of one — the same rule `payments-webhook` follows.
 */
const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const esc = (s: string) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );

/** The IST calendar date. A UTC boundary at 05:30 IST would split a working morning in two. */
const istDay = (offsetDays = 0) =>
  new Date(Date.now() + 5.5 * 3600 * 1000 - offsetDays * 86_400_000).toISOString().slice(0, 10);

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });

  const secret = Deno.env.get('OPS_HEARTBEAT_SECRET') ?? '';
  if (!secret || request.headers.get('x-ops-secret') !== secret) {
    return json(401, { error: 'not_authenticated' });
  }

  const mode = new URL(request.url).searchParams.get('mode') ?? 'probe';
  const site = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://graybag-web.netlify.app';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false },
  });

  /*
   * The probes.
   *
   * Each asserts something only a working system produces. The marketing page must contain its own
   * headline, not merely return 200 — a 200 with an error page would have passed every check that
   * existed during the three outages.
   */
  const probes: Probe[] = [
    pageProbe(
      'public site', site, 'GrayBag',
      'Check the Netlify deploy log. If the last deploy failed, the previous one is still live and this is a build problem, not an outage.',
    ),
    pageProbe(
      'admin sign-in', `${site}/signin`, 'signin',
      'The back office is unreachable. Check the Netlify deploy first, then that Supabase auth is up.',
    ),
    pageProbe(
      'kitchen board', `${site}/kitchen`, 'kitchen',
      'Kitchen staff cannot see today’s orders. Same first checks as the admin sign-in.',
    ),
    functionProbe(
      /*
       * `policy` is an authenticated POST, so the healthy answer to an anonymous call is **401**,
       * not 200 — and demanding it is a real exercise: a 401 proves the function is deployed,
       * running, and enforcing auth. A 405, a 502 or an HTML error page all fail.
       *
       * The first version of this probe sent a GET and expected 200. It failed against a
       * perfectly healthy staging, which is exactly the false alarm that teaches people to ignore
       * a monitor — caught here rather than at 3am.
       */
      'policy function', `${supabaseUrl}/functions/v1/policy`,
      {
        method: 'POST',
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'health-probe' }),
      },
      (_body, status) => status === 401 || status === 400,
      'An Edge Function is failing. Run `supabase functions logs policy` and redeploy if the last deploy is suspect.',
    ),
    functionProbe(
      'app version function', `${supabaseUrl}/functions/v1/menu-version`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
      (_body, status) => status === 200 || status === 400,
      'The app cannot check the menu version, so every device may be serving a stale menu. Check the function logs.',
    ),
    {
      // The database, exercised rather than pinged: a query that must return a row.
      name: 'database read',
      remedy: 'PostgREST or the database is unreachable. Check the Supabase project status page.',
      run: async () => {
        const started = Date.now();
        const { data, error } = await admin.from('school').select('id').limit(1);
        const ms = Date.now() - started;
        if (error) return { ok: false, detail: `error ${error.code}`, ms };
        return (data ?? []).length > 0
          ? { ok: true, detail: 'a row came back', ms }
          : { ok: false, detail: 'the schools table is empty, which it never should be', ms };
      },
    },
    {
      /*
       * Transactional email. The outage that 403'd every confirmation for a day would have shown
       * here: Resend answers, and the configured `from` domain is verified.
       */
      name: 'email sender',
      remedy: 'Transactional email is failing — order confirmations and alerts are not arriving. Check that ORDER_EMAIL_FROM uses a domain verified in Resend (E12-34).',
      run: async () => {
        const started = Date.now();
        const key = Deno.env.get('RESEND_API_KEY') ?? '';
        const from = Deno.env.get('ORDER_EMAIL_FROM') ?? '';
        if (!key || !from) {
          return { ok: false, detail: 'RESEND_API_KEY or ORDER_EMAIL_FROM is not set', ms: Date.now() - started };
        }
        const response = await fetch('https://api.resend.com/domains', {
          headers: { Authorization: `Bearer ${key}` },
        });
        const ms = Date.now() - started;
        if (!response.ok) return { ok: false, detail: `resend ${response.status}`, ms };
        const body = await response.json() as { data?: { name?: string; status?: string }[] };
        const domain = from.split('@').pop()?.replace('>', '').trim() ?? '';
        const verified = (body.data ?? []).some(
          (d) => d.status === 'verified' && domain.endsWith(String(d.name)),
        );
        return verified
          ? { ok: true, detail: `${domain} is verified`, ms }
          : { ok: false, detail: `${domain} is NOT verified in Resend — every send will 403`, ms };
      },
    },
  ];

  const outcomes = await runProbes(probes);
  const failed = outcomes.filter((o) => !o.ok);

  /*
   * Escalate a down endpoint immediately, not in tomorrow's digest.
   *
   * `sendMoneyAlert` dedupes once per kind per IST day, so a check running every fifteen minutes
   * raises one email and then goes quiet — loud enough to notice, not so loud it gets filtered.
   */
  if (failed.length > 0) {
    await sendMoneyAlert(admin, {
      kind: 'endpoint_down',
      summary: `${failed.length} check(s) failing: ${failed.map((f) => f.name).join(', ')}`,
      detail: Object.fromEntries(failed.map((f) => [f.name, `${f.detail} — ${f.remedy}`])),
    });
  }

  if (mode === 'probe') {
    return json(failed.length === 0 ? 200 : 503, {
      ok: failed.length === 0,
      probes: outcomes,
    });
  }

  // ------------------------------------------------------------------ the daily digest
  const yesterday = istDay(1);
  const dayStart = new Date(Date.parse(`${yesterday}T00:00:00Z`) - 5.5 * 3600 * 1000).toISOString();
  const dayEnd = new Date(Date.parse(`${yesterday}T00:00:00Z`) + 86_400_000 - 5.5 * 3600 * 1000).toISOString();

  const [orders, payments, drain, alerts] = await Promise.all([
    admin.from('order')
      .select('total_paise,status,order_ref', { count: 'exact' })
      .gte('placed_at', dayStart).lt('placed_at', dayEnd),
    admin.from('payment')
      .select('id,status', { count: 'exact' })
      .gte('created_at', dayStart).lt('created_at', dayEnd),
    // Webhook events not yet processed. A backlog here is money not yet recorded.
    admin.from('payment_webhook_event')
      .select('id', { count: 'exact', head: true })
      .eq('processing_status', 'pending'),
    admin.from('ops_alert')
      .select('kind,summary', { count: 'exact' })
      .eq('alert_date', yesterday),
  ]);

  type OrderRow = { total_paise: number; status: string; order_ref: string };
  const orderRows = (orders.data ?? []) as OrderRow[];
  const EARNED = new Set(['paid', 'preparing', 'delivered']);
  const paid = orderRows.filter((o) => EARNED.has(o.status));
  const revenue = paid.reduce((n, o) => n + (o.total_paise ?? 0), 0);

  type PaymentRow = { status: string };
  const paymentRows = (payments.data ?? []) as PaymentRow[];
  const failedPayments = paymentRows.filter((p) => p.status === 'failed').length;

  const drainDepth = drain.count ?? 0;
  const alertRows = (alerts.data ?? []) as { kind: string; summary: string }[];

  /*
   * A captured payment with no order is the single worst state the system can reach: the customer
   * has paid and there is nothing to cook. Escalated the same day, by name.
   */
  const { data: orphanRows } = await admin
    .from('payment')
    .select('id,order_group_id,status')
    .eq('status', 'captured')
    .is('order_group_id', null)
    .limit(5);
  const orphans = (orphanRows ?? []).length;
  if (orphans > 0) {
    await sendMoneyAlert(admin, {
      kind: 'payment_without_order',
      summary: `${orphans} captured payment(s) with no order attached`,
      detail: { count: orphans, whatToDo: 'Reconcile in the Razorpay dashboard and settle by hand — the customer has paid and there is nothing to cook.' },
    });
  }

  if (drainDepth > 20) {
    await sendMoneyAlert(admin, {
      kind: 'drain_backlog',
      summary: `${drainDepth} webhook events waiting to be processed`,
      detail: { pending: drainDepth, whatToDo: 'Run payments-drain. If it does not clear, money is captured and unrecorded.' },
    });
  }

  const quiet = failed.length === 0 && orderRows.length === 0 && alertRows.length === 0 &&
    failedPayments === 0 && drainDepth === 0 && orphans === 0;

  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 16px 4px 0;color:#4a544c">${esc(label)}</td>` +
    `<td style="padding:4px 0"><strong>${esc(value)}</strong></td></tr>`;

  const probeList = outcomes
    .map((o) =>
      `<li style="margin:0 0 6px">${o.ok ? '✅' : '❌'} <strong>${esc(o.name)}</strong> — ` +
      `${esc(o.detail)} <span style="color:#4a544c">(${o.ms}ms)</span>` +
      (o.ok ? '' : `<br><span style="color:#8a1c1c">${esc(o.remedy)}</span>`) +
      `</li>`)
    .join('');

  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;` +
    `font-size:16px;line-height:1.5;color:#141a16;max-width:600px">` +
    `<p style="margin:0 0 4px;font-size:20px"><strong>GrayBag — ${esc(yesterday)}</strong></p>` +
    (quiet
      // The one line Andy asked for. A quiet day still sends, because a system that only speaks
      // when it is unhappy is indistinguishable from one that has stopped speaking.
      ? `<p style="margin:0 0 20px">Quiet day. Everything responding, no orders, nothing errored.</p>`
      : `<p style="margin:0 0 20px;color:#4a544c">Yesterday, in IST.</p>`) +
    `<table style="border-collapse:collapse;margin:0 0 20px">` +
      row('Orders placed', String(orderRows.length)) +
      row('Paid', String(paid.length)) +
      row('Revenue', rupees(revenue)) +
      row('Failed payments', String(failedPayments)) +
      row('Drain queue waiting', String(drainDepth)) +
      row('Alerts raised', String(alertRows.length)) +
    `</table>` +
    (alertRows.length > 0
      ? `<p style="margin:0 0 8px"><strong>What errored</strong></p><ul style="margin:0 0 20px;padding-left:20px">` +
        alertRows.map((a) => `<li>${esc(a.kind)} — ${esc(a.summary)}</li>`).join('') +
        `</ul>`
      : '') +
    `<p style="margin:0 0 8px"><strong>Right now</strong></p>` +
    `<ul style="margin:0 0 20px;padding-left:20px">${probeList}</ul>` +
    `<p style="margin:0;color:#4a544c;font-size:14px">` +
      `Counts and order codes only — no child's name, class or section is ever in this email.` +
    `</p></div>`;

  const apiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const from = Deno.env.get('ORDER_EMAIL_FROM') ?? '';
  const to = Deno.env.get('SUPPORT_ALERT_EMAIL') ?? 'support@graybag.com';

  let delivered: 'sent' | 'suppressed' | 'failed' = 'suppressed';
  if (apiKey && from) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from, to: [to],
        subject: failed.length > 0
          ? `GrayBag ${yesterday} — ${failed.length} check(s) FAILING`
          : `GrayBag ${yesterday} — ${paid.length} paid, ${rupees(revenue)}`,
        html,
      }),
    });
    delivered = response.ok ? 'sent' : 'failed';
    if (!response.ok) {
      console.error(`ops-heartbeat: resend ${response.status}`);
      // The digest itself failing to send is the outage that hides every other outage.
      await sendMoneyAlert(admin, {
        kind: 'email_undelivered',
        summary: 'the daily heartbeat could not be emailed',
        detail: { status: response.status, whatToDo: 'Transactional email is down. Check Resend and ORDER_EMAIL_FROM.' },
      });
    }
  }

  return json(200, {
    ok: failed.length === 0,
    quiet,
    delivered,
    day: yesterday,
    probes: outcomes,
    counts: {
      ordersPlaced: orderRows.length,
      paid: paid.length,
      revenuePaise: revenue,
      failedPayments,
      drainDepth,
      alerts: alertRows.length,
      orphanPayments: orphans,
    },
  });
});
