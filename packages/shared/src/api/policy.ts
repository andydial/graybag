/**
 * The policy-version acceptance gate — `E20-36`, `E20-03`, `docs/ux-spec.md` §5.19.
 *
 * ## What was actually wrong
 *
 * `PolicyGateScreen` was written, styled, tested and **mounted nowhere**. It is one of the six
 * compliance controls in v1, and it had never run once — while both the code and the handover
 * notes read as though it were in place. The screen was never the missing part; this module and
 * its caller are.
 *
 * ## The rule it enforces
 *
 * `user_policy_acceptance`'s own column comment states it: ordering is blocked until, for every
 * `policy_version` that is published, `blocks_ordering`, in effect, and the latest of its
 * policy, the customer has a matching acceptance row.
 *
 * **It blocks writes, never browsing** (`AR7`). A parent whose accepted version is out of date
 * opens the app, browses and fills a cart exactly as before; what they cannot do is place an
 * order. That is why this is a read taken at the point of a write rather than a redirect on
 * launch, and why "Not now" is a supported answer instead of a courtesy.
 *
 * ## One query, because the acceptance table is already scoped to the caller
 *
 * The caller's acceptances arrive as a PostgREST **embed** on `policy_version` rather than a
 * second round trip. `user_policy_acceptance_read_self` restricts that table to
 * `user_id = auth.uid()`, so the embedded array is *by construction* this user's rows and only
 * this user's — no user id is sent from the client, and none could be honoured if it were.
 * An empty array therefore means "not accepted", which is exactly the question being asked.
 *
 * ## Latest-per-policy is decided here, not in the query
 *
 * PostgREST cannot express "the newest row per group" without a view or an RPC, and inventing
 * either would put the definition of *current version* in a second place. The rows are few —
 * one per policy per publication — so the newest effective version per `policy_code` is picked
 * in memory, from `effective_from`, with `version` as the tie-break.
 *
 * ## Empty is the honest answer today
 *
 * `policy_version` is deliberately unseeded (`0001`, and `E20-12`): a consent record pointing
 * at wording nobody approved is evidence of the wrong thing, and the approved wording is
 * blocked on `E20-01` with the lawyer. So this returns "nothing pending" in every environment
 * right now, and the gate mounts without firing. That is correct behaviour, and not the same
 * thing as the gate not existing — the wiring was the defect, the wording is Andy's blocker,
 * and the tests drive the firing path with fixtures rather than waiting for it.
 */
import { runQuery, invokeFunction } from './client.js';

/** A published policy version a user has not yet accepted. */
export interface PendingPolicy {
  /** `policy_version.id` — what an acceptance row points at. */
  versionId: string;
  /** `privacy_policy`, `terms_of_service`, … */
  policyCode: string;
  /** Monotonic within a policy: `1`, `2`, `2.1`. */
  version: string;
  /**
   * `policy_version.summary_of_changes` — what the gate shows.
   *
   * Null when a version was published without one. The screen requires a summary, so the
   * caller substitutes a plain fallback rather than rendering an empty panel: a parent asked
   * to re-accept needs to know what changed, and "" tells them nothing.
   */
  summaryOfChanges: string | null;
}

/** Raised when the backend returns policy rows that are not the agreed shape. */
export class PolicyPayloadError extends Error {
  constructor(detail: string) {
    super(`The policy list is not usable: ${detail}`);
    this.name = 'PolicyPayloadError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Exactly what may leave `policy_version`.
 *
 * Spelled out for the same reason `SCHOOL_COLUMNS` is: a policy filters rows, never columns.
 * `policy_version` also carries `content_md`, `content_url`, `content_sha256` and
 * `created_by_user_id` — the full document text and the identity of whoever published it —
 * none of which the gate needs in order to decide whether to open.
 *
 * The embed selects only `policy_version_id`. `user_policy_acceptance` also holds `ip_hash`
 * and `user_agent_hash`, and there is no reason for evidence-of-acceptance to travel to a
 * handset in order to answer a yes/no question.
 */
export const POLICY_VERSION_COLUMNS =
  'id,policy_code,version,effective_from,summary_of_changes,user_policy_acceptance(policy_version_id)';

/**
 * Compare two version strings the way the column means them: monotonic within a policy,
 * dot-separated, numeric. `2.10` is above `2.9`, which a string compare gets wrong.
 *
 * Only ever a tie-break on identical `effective_from`, but two versions of one policy sharing
 * an effective date is exactly the case where picking the wrong one gates on stale wording.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The policy versions this user must accept before their next order.
 *
 * An empty array means the gate stays shut and ordering proceeds.
 *
 * `now` is injected so a test can sit either side of an `effective_from` without waiting for
 * a clock. A version that is published but not yet in effect must not gate anyone.
 */
export async function fetchPendingPolicies(now: Date = new Date()): Promise<PendingPolicy[]> {
  const rows = await runQuery<unknown>((t) =>
    t
      .from('policy_version')
      .select(POLICY_VERSION_COLUMNS)
      // Enforced by `policy_version_read_published` too. Stated here because the admin policy
      // beside it (`policy_version_read_admin`) can see drafts, and a staff member with
      // `config.platform_edit` must not be gated on wording that is not published yet.
      .not('published_at', 'is', null)
      .eq('blocks_ordering', true)
      .lte('effective_from', now.toISOString())
      .order('effective_from', { ascending: false }),
  );

  const parsed = rows.map((row, i) => {
    if (
      !isRecord(row) ||
      typeof row.id !== 'string' ||
      typeof row.policy_code !== 'string' ||
      typeof row.version !== 'string' ||
      typeof row.effective_from !== 'string'
    ) {
      throw new PolicyPayloadError(`policy version ${i} is missing a required field`);
    }
    return {
      versionId: row.id,
      policyCode: row.policy_code,
      version: row.version,
      effectiveFrom: row.effective_from,
      summaryOfChanges:
        typeof row.summary_of_changes === 'string' ? row.summary_of_changes : null,
      // A to-many embed is an array. Absent or malformed is treated as *not accepted*, which
      // is the safe direction: the failure mode is asking a parent to accept something they
      // already did, not letting an order past a policy they never saw.
      accepted: Array.isArray(row.user_policy_acceptance)
        ? row.user_policy_acceptance.length > 0
        : false,
    };
  });

  // The current version of each policy, and only that one. An older version that also blocks
  // ordering is superseded, not additionally required — asking a parent to accept version 1
  // and version 2 of the same document is a bug that looks like diligence.
  const current = new Map<string, (typeof parsed)[number]>();
  for (const row of parsed) {
    const held = current.get(row.policyCode);
    if (
      held === undefined ||
      row.effectiveFrom > held.effectiveFrom ||
      (row.effectiveFrom === held.effectiveFrom && compareVersions(row.version, held.version) > 0)
    ) {
      current.set(row.policyCode, row);
    }
  }

  return [...current.values()]
    .filter((row) => !row.accepted)
    .map(({ versionId, policyCode, version, summaryOfChanges }) => ({
      versionId,
      policyCode,
      version,
      summaryOfChanges,
    }));
}

/**
 * Record that this user accepts a policy version.
 *
 * A **write**, so it goes through an Edge Function (`A4`, non-negotiable #1) even though
 * `user_policy_acceptance_insert_self` would permit the insert directly. The server owns
 * `source`, `app_version`, `ip_hash` and `user_agent_hash` — a client that supplied its own
 * `source` could write `migration`, which the table's comment reserves for a pre-cutover
 * acceptance carried over *with evidence* and says must never be used to fabricate consent
 * nobody gave.
 *
 * The table is append-only with a uniqueness constraint on `(user_id, policy_version_id)`, so
 * accepting twice is not an error a parent should ever see — the function treats a duplicate
 * as already-accepted.
 */
export async function acceptPolicyVersion(versionId: string): Promise<void> {
  await invokeFunction<{ ok: true }>('policy', { action: 'accept', versionId });
}
