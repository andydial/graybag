/**
 * Effective-config cache (E02-10).
 *
 * Every screen in the app needs the resolved config for the current school — the
 * cutoff time, the tax rates, whether cancellation is allowed. Resolving it is a
 * round trip, and the audience is on mid-range Androids over unreliable connections
 * (CLAUDE.md, "Performance priorities": the constraint is network, not CPU). Fetching
 * it per screen is the kind of thing that makes an app feel broken on a bad line.
 *
 * Three properties this cache has deliberately, each because getting it wrong is
 * quiet rather than loud:
 *
 * 1. **A null resolution is never cached as a value.** `resolve_effective_config`
 *    returns a NULL composite for an unknown school, and a composite-returning
 *    function in FROM position yields one row regardless — so "no config" and
 *    "config full of nulls" look identical to a naive caller. Caching that for the
 *    TTL would pin a broken state for minutes. See `supabase/tests/config_resolution.test.sql` §6.
 *
 * 2. **Errors are never cached.** A failed fetch on a flaky connection must be
 *    retried on the next call, not remembered as "no config" until the TTL expires.
 *
 * 3. **Concurrent gets share one in-flight request.** Six components mounting at once
 *    must not issue six identical round trips on a connection that is the bottleneck.
 */

/** The customer-facing subset, mirroring `effective_config_public` (§7.6). */
export interface EffectiveConfig {
  timezone: string;
  orderCutoffTime: string;
  orderCutoffDaysBefore: number;
  maxAdvanceOrderDays: number;
  minAdvanceOrderDays: number;
  defaultDeliveryMode: 'classroom' | 'counter';
  allowClassroomDelivery: boolean;
  allowCounterPickup: boolean;
  pickupCodeEnabled: boolean;
  /** False for v1: prices are GST-exclusive and 5% is added at checkout (SC2). */
  priceIsTaxInclusive: boolean;
  cgstRateBps: number;
  sgstRateBps: number;
  igstRateBps: number;
  refundDefaultDestination: 'wallet' | 'source';
  walletAtCheckoutEnabled: boolean;
  allergenWarningEnabled: boolean;
  customerCancellationAllowed: boolean;
  customerCancellationCutoffMinutes: number;
  /**
   * How long a `pending_payment` checkout is held before the sweeper cancels it (`[OL-03]`).
   *
   * **Provisional at 30.** Its floor is how long Razorpay lets a UPI collect stay pending, which
   * is `E19-07` row 3 — config rather than a constant so that answer costs an UPDATE. The
   * sweeper reconciles against Razorpay before cancelling rather than trusting this clock
   * (`E06-17`): it decides when to go and ask, not what the answer is.
   */
  pendingPaymentTtlMinutes: number;
  /**
   * `L9`. A settlement landing within `cutoff_at + this` is honoured; after it the capture is
   * refused and auto-refunded. Default 15.
   *
   * **Never render this, and never count it down at anyone.** It is a server tolerance, not a
   * deadline a parent can act on, and putting it on screen invites racing it. A kitchen that
   * cannot absorb late orders sets it to 0 and gets a hard cutoff.
   */
  paymentInFlightGraceMinutes: number;
  /**
   * How long a failed attempt may be retried against the same `order_group`. Matched to the TTL
   * deliberately — a longer window lets a retry succeed against a checkout the sweeper already
   * cancelled, which is the late-capture path by another door.
   */
  paymentRetryWindowMinutes: number;
}

export class ConfigUnavailableError extends Error {
  readonly schoolId: string;
  constructor(schoolId: string) {
    super(
      `No effective config for school ${schoolId}. The resolver returned nothing, ` +
      `which means the school does not exist or is not readable by this caller — ` +
      `never that platform defaults apply.`,
    );
    this.name = 'ConfigUnavailableError';
    this.schoolId = schoolId;
  }
}

/** Returns the resolved config, or null/undefined when the school did not resolve. */
export type ConfigFetcher = (schoolId: string) => Promise<EffectiveConfig | null | undefined>;

export interface ConfigCacheOptions {
  fetch: ConfigFetcher;
  /** How long a resolved config stays fresh. Default 5 minutes. */
  ttlMs?: number;
  /** Injectable clock, so the tests do not sleep. */
  now?: () => number;
}

export interface ConfigCache {
  get(schoolId: string): Promise<EffectiveConfig>;
  /** Drop one school, e.g. after an admin edits its config. */
  invalidate(schoolId: string): void;
  clear(): void;
  /** Number of currently-cached schools. For tests and diagnostics. */
  size(): number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface Entry {
  value: EffectiveConfig;
  expiresAt: number;
}

export function createConfigCache(options: ConfigCacheOptions): ConfigCache {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;

  const entries = new Map<string, Entry>();
  const inFlight = new Map<string, Promise<EffectiveConfig>>();

  async function load(schoolId: string): Promise<EffectiveConfig> {
    const resolved = await options.fetch(schoolId);

    // Property 1: a null resolution is an error, not a cacheable value. Treating it
    // as one would pin "this school has no config" for the whole TTL.
    if (resolved === null || resolved === undefined) {
      throw new ConfigUnavailableError(schoolId);
    }

    entries.set(schoolId, { value: resolved, expiresAt: now() + ttlMs });
    return resolved;
  }

  return {
    async get(schoolId: string): Promise<EffectiveConfig> {
      const hit = entries.get(schoolId);
      if (hit && hit.expiresAt > now()) return hit.value;
      if (hit) entries.delete(schoolId); // expired

      // Property 3: share one in-flight request per school.
      const existing = inFlight.get(schoolId);
      if (existing) return existing;

      // Property 2: the in-flight entry is removed whether the load succeeds or
      // fails, so a failure is retried rather than remembered.
      const pending = load(schoolId).finally(() => {
        inFlight.delete(schoolId);
      });
      inFlight.set(schoolId, pending);
      return pending;
    },

    invalidate(schoolId: string): void {
      entries.delete(schoolId);
    },

    clear(): void {
      entries.clear();
    },

    size(): number {
      return entries.size;
    },
  };
}

/**
 * v1 is Mohali only, so GST is always intra-state: CGST + SGST, never IGST (SC1).
 * Exposed here so no call site has to decide, and so the invariant has one home.
 */
export function gstSplitBps(config: EffectiveConfig): { cgstBps: number; sgstBps: number; igstBps: number } {
  return { cgstBps: config.cgstRateBps, sgstBps: config.sgstRateBps, igstBps: config.igstRateBps };
}
