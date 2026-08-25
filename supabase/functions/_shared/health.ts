/**
 * Is production actually working — `E15-15`.
 *
 * Andy: *"Three times this month a complete outage was invisible until a human found it by reading
 * a log by hand — settlement failing on every attempt, every confirmation email 403ing, an entire
 * test suite running zero files."*
 *
 * All three share one shape: **the system reported nothing, and nothing is what a healthy system
 * reports.** So the rule these checks are built on is that silence must be impossible — every run
 * produces a verdict, and the verdict is delivered whether or not anything is wrong.
 *
 * ## The probes exercise, they do not ping
 *
 * A ping proves a server accepted a connection. Every one of the three outages would have passed a
 * ping: the site was up and 403ing on mail, the functions were deployed and failing inside, the
 * test runner started and ran nothing.
 *
 * So each probe asserts something only a **working** system can produce — a known string in the
 * page, a JSON shape from a function, a row count that has to be there. `check` carries the
 * assertion, not just the URL.
 *
 * ## Every result names what to do
 *
 * Andy: *"Every alert must name what to do about it. An alert I can't act on gets ignored, and
 * then so do the real ones."* `remedy` is not optional on a failure, and the type makes it
 * awkward to add a probe without one.
 *
 * ## Nothing here reads a child
 *
 * Counts and order codes only. The digest is forwarded and pasted into chat far more casually
 * than a customer email, which is the same reasoning `ops_alert.detail` carries.
 */

export interface Probe {
  /** Short, stable, and readable in a subject line. */
  name: string;
  /** What a person should do if this fails. Required — an unactionable alert trains people to ignore alerts. */
  remedy: string;
  run: () => Promise<ProbeResult>;
}

export interface ProbeResult {
  ok: boolean;
  /** What happened, in a few words. Shown whether it passed or failed. */
  detail: string;
  /** Milliseconds. Recorded so a slow-but-up service is visible before it becomes a down one. */
  ms: number;
}

export interface ProbeOutcome extends ProbeResult {
  name: string;
  remedy: string;
}

const timed = async (fn: () => Promise<{ ok: boolean; detail: string }>): Promise<ProbeResult> => {
  const started = Date.now();
  try {
    const { ok, detail } = await fn();
    return { ok, detail, ms: Date.now() - started };
  } catch (thrown) {
    return { ok: false, detail: `threw: ${String(thrown).slice(0, 120)}`, ms: Date.now() - started };
  }
};

/**
 * Fetch with a deadline.
 *
 * Without one, a hung endpoint makes the health check hang too — and a monitor that stops
 * reporting because the thing it monitors is broken is the failure mode this whole file exists to
 * remove.
 */
async function get(url: string, init: RequestInit = {}, ms = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A page must contain something only a rendered page contains.
 *
 * `must` is the assertion. A 200 alone would have passed while the site served an error page or
 * an empty shell, which is exactly the class of outage being guarded against.
 */
export function pageProbe(name: string, url: string, must: string, remedy: string): Probe {
  return {
    name,
    remedy,
    run: () =>
      timed(async () => {
        const response = await get(url);
        if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
        const body = await response.text();
        return body.includes(must)
          ? { ok: true, detail: `HTTP 200, ${body.length} bytes` }
          : { ok: false, detail: `HTTP 200 but the page did not contain "${must}"` };
      }),
  };
}

/**
 * An Edge Function must answer in the shape its callers expect.
 *
 * `accept` gets the parsed body and decides. A function returning 200 with the wrong shape is how
 * a client breaks silently, and it is indistinguishable from health at the HTTP layer.
 */
export function functionProbe(
  name: string,
  url: string,
  init: RequestInit,
  accept: (body: unknown, status: number) => boolean,
  remedy: string,
): Probe {
  return {
    name,
    remedy,
    run: () =>
      timed(async () => {
        const response = await get(url, init);
        let body: unknown = null;
        try {
          body = JSON.parse(await response.text());
        } catch {
          return { ok: false, detail: `HTTP ${response.status} with a non-JSON body` };
        }
        return accept(body, response.status)
          ? { ok: true, detail: `HTTP ${response.status}, shape ok` }
          : { ok: false, detail: `HTTP ${response.status}, unexpected shape` };
      }),
  };
}

/** Run them all, in parallel, and never let one failure stop the rest. */
export async function runProbes(probes: readonly Probe[]): Promise<ProbeOutcome[]> {
  return Promise.all(
    probes.map(async (p) => ({ name: p.name, remedy: p.remedy, ...(await p.run()) })),
  );
}
