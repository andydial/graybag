/**
 * "Is this build still allowed to operate?" `E17-46`.
 *
 * The mandatory update on 19 August is a store listing and an email unless something in the
 * product enforces it. This is that something — and the enforcement lives in the **app**, because
 * a server that hard-refuses every call from an old build turns "please update" into an app that
 * appears broken, and the first parent to see it is one mid-order on the morning of the cutover.
 *
 * ## The floor is data
 *
 * `platform_config.min_supported_app_version`, not a constant. A constant can only be raised by
 * shipping a build, and the population this exists to control is exactly the one that has not
 * taken the new build. Raising the floor on the 19th is an UPDATE, not a deploy.
 *
 * ## The comparison happens once, on the server
 *
 * `app_version_support` is an RPC rather than a config read plus a client-side comparison,
 * because two comparators that must agree is `E20-50`'s bug waiting for a second home — there,
 * `'9' > '10'` as text recorded a parent's consent against superseded wording, invisibly. The
 * server answers; the app renders the answer.
 */
import { runRpc } from './client.js';

export interface VersionSupport {
  /**
   * `false` only when the server is certain this build is below the floor.
   *
   * **Unknown is `true`.** A build that could not state its version, or stated one the server
   * cannot parse, is admitted — see `reason`. The safe direction for a compatibility floor is the
   * opposite of the safe direction for an authorisation check: a parent wrongly locked out has no
   * route back (the screen says update, the store says they are current), while a parent wrongly
   * admitted gets an app that mostly works.
   */
  supported: boolean;
  /** The floor the server compared against. `null` when no config row exists. */
  minimumVersion: string | null;
  /** The configured sentence, when unsupported. `null` otherwise — the screen has its own. */
  message: string | null;
  /** `version_not_stated` when the build was admitted because its version was unreadable. */
  reason: string | null;
}

/**
 * Ask the server. **Never throws** — it resolves to `supported: true` on any failure.
 *
 * That is deliberate and is the same argument as `supported` defaulting true. This call sits in
 * front of the whole app; if it threw on a flaky connection the parent would be blocked from
 * ordering by the thing whose entire job is to tell them how to keep ordering. An outage must
 * degrade to "carry on", not to "you are locked out".
 *
 * It is the one read in this module that swallows its error, and the exception is worth stating:
 * everywhere else, collapsing a failure into a plausible answer is what §5.21 forbids. Here the
 * plausible answer *is* the correct one — we do not know that this build is too old, and
 * "too old" is a claim that needs evidence.
 */
export async function fetchVersionSupport(appVersion: string | null): Promise<VersionSupport> {
  try {
    const row = await runRpc<Record<string, unknown>>('app_version_support', {
      p_version: appVersion,
    });

    return {
      // `!== false` rather than `=== true`: a malformed response is an unknown, and unknown is
      // admitted. Only an explicit `false` from the server blocks anybody.
      supported: row?.supported !== false,
      minimumVersion: typeof row?.minimum_version === 'string' ? row.minimum_version : null,
      message: typeof row?.message === 'string' ? row.message : null,
      reason: typeof row?.reason === 'string' ? row.reason : null,
    };
  } catch {
    return { supported: true, minimumVersion: null, message: null, reason: 'check_failed' };
  }
}
