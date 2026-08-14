// Whether Netlify should build a given context — `E12-30`.
//
// Netlify's `ignore` command has **inverted exit codes**: exit 0 means "nothing changed, SKIP the
// build", exit 1 means "build it". Getting that backwards fails open — production would publish
// on every push, which is the exact thing this gate exists to prevent — so the decision lives
// here as a pure function with a test, and `scripts/netlify-should-build.sh` does nothing but
// translate the answer into the exit code.
//
// ## Why a build gate rather than "stop auto publishing"
//
// Netlify's dashboard has an auto-publishing switch, and it works. It is also invisible from the
// repository, silently reversible by anyone with the dashboard, and it leaves a built deploy
// sitting one click from live. This gate is in the repository, is reviewed like code, and means
// production is not *built* — there is nothing to accidentally publish.
//
// The two mechanisms are complementary, not alternatives. The dashboard switch is still worth
// setting; it is `E12-31`, and it is Andy's because it needs the Netlify account.
//
// ## What counts as approval
//
// A commit whose **subject line** carries `[promote]`, or an explicitly set
// `PROMOTE_TO_PRODUCTION=true` on a manually triggered deploy. Both are deliberate acts by a
// person. Neither can happen by merging a pull request that did not ask for it.
//
// The marker is read from the subject line only. A `[promote]` appearing in a commit body — a
// quoted review comment, a pasted log, this file's own name in a message — must not ship a
// release, and body text is exactly where such a string turns up by accident.

/** Contexts that always build. Previews are the point of previews. */
const ALWAYS_BUILD = new Set(['deploy-preview', 'branch-deploy', 'dev']);

const PROMOTE_MARKER = '[promote]';

/**
 * @param {object} input
 * @param {string} input.context           Netlify's CONTEXT — production, deploy-preview, …
 * @param {string} input.commitMessage     The full commit message. Only its first line is read.
 * @param {string|undefined} input.promoteFlag  PROMOTE_TO_PRODUCTION, if set.
 * @returns {{build: boolean, reason: string}}
 */
export function shouldBuild({ context, commitMessage = '', promoteFlag }) {
  if (ALWAYS_BUILD.has(context)) {
    return { build: true, reason: `${context} always builds — previews are the point of previews` };
  }

  if (context !== 'production') {
    // An unrecognised context builds. A new Netlify context that silently stopped building would
    // be a broken preview nobody could explain, and the failure this gate guards is the opposite
    // one: production shipping when nobody asked.
    return { build: true, reason: `unrecognised context "${context}" — building, since only production is gated` };
  }

  if (String(promoteFlag).toLowerCase() === 'true') {
    return { build: true, reason: 'PROMOTE_TO_PRODUCTION=true was set on this deploy' };
  }

  const subject = commitMessage.split('\n', 1)[0] ?? '';
  if (subject.toLowerCase().includes(PROMOTE_MARKER)) {
    return { build: true, reason: `the commit subject carries ${PROMOTE_MARKER}` };
  }

  return {
    build: false,
    reason:
      'production is gated. Nothing was built, and the live site is unchanged. To promote, ' +
      `either push a commit whose subject contains ${PROMOTE_MARKER}, or trigger a deploy with ` +
      'PROMOTE_TO_PRODUCTION=true. See docs/netlify-deploys.md.',
  };
}
