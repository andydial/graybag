#!/usr/bin/env bash
# Netlify's `ignore` command for this site — `E12-30`.
#
# **The exit codes are inverted.** Netlify runs this to ask "can I skip the build?":
#
#   exit 0  → SKIP the build. The currently published deploy stays live, untouched.
#   exit 1  → BUILD.
#
# That inversion is why the decision is not made here. `scripts/lib/netlify-gate.mjs` decides and
# is unit-tested; this file only translates. Getting it backwards fails OPEN — production would
# publish on every push to `main`, which is precisely what this gate exists to stop.
#
# Netlify sets CONTEXT, COMMIT_REF and CACHED_COMMIT_REF in the build environment.
set -uo pipefail

CONTEXT="${CONTEXT:-production}"

# The commit message is not in Netlify's environment, so it is read from the checkout. `|| true`
# because a shallow or missing clone must not crash the gate — an empty message simply means no
# promote marker, which fails closed.
# An already-exported `COMMIT_MESSAGE` wins. That is not a convenience: without it this script
# reads whatever the repository's HEAD happens to say, so its own test passed only while HEAD
# did not contain `[promote]` — and broke the moment a real promote was merged. A gate whose
# test depends on today's commit message is the trap `docs/learnings.md` names: assert the
# behaviour, not the contents.
COMMIT_MESSAGE="${COMMIT_MESSAGE:-$(git log -1 --pretty=%B 2>/dev/null || true)}"

# Resolved from **this file's** location, never from the working directory — `E12-43`.
#
# It was `import "./scripts/lib/netlify-gate.mjs"`, which is relative to the CWD. Netlify runs the
# `ignore` command from the site's **base directory** (`apps/web`), where that path does not
# exist, so `node` threw `ERR_MODULE_NOT_FOUND` on every production build. `DECISION` came back
# empty and the "do not freeze the site" fallback below chose BUILD — so **the gate has been open
# since it was written**, and every merge to `main` published straight to production.
#
# The unit test did not catch it because it invoked this script with `cwd: ROOT`, where the
# relative path happens to resolve. It asserted the right behaviour from the wrong directory.
# `netlify-gate.test.mjs` now runs it from `apps/web` as well, which is the case that was broken.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE_MODULE="file://$SCRIPT_DIR/lib/netlify-gate.mjs"

RESULT="$(
  CONTEXT="$CONTEXT" \
  COMMIT_MESSAGE="$COMMIT_MESSAGE" \
  PROMOTE_TO_PRODUCTION="${PROMOTE_TO_PRODUCTION:-}" \
  GATE_MODULE="$GATE_MODULE" \
  node --input-type=module -e '
    const { shouldBuild } = await import(process.env.GATE_MODULE);
    const d = shouldBuild({
      context: process.env.CONTEXT,
      commitMessage: process.env.COMMIT_MESSAGE ?? "",
      promoteFlag: process.env.PROMOTE_TO_PRODUCTION,
    });
    console.log(`${d.build ? "BUILD" : "SKIP"}\t${d.reason}`);
  '
)"

DECISION="${RESULT%%$'\t'*}"
REASON="${RESULT#*$'\t'}"

# If node failed for any reason the decision is empty. Build in that case: a gate that cannot run
# must not silently stop deploying. The failure it guards is production shipping unasked, and a
# broken gate is loud either way — but a site frozen by a typo in this file is worse.
if [ -z "$DECISION" ]; then
  echo "netlify-gate: could not evaluate the gate — building rather than freezing the site." >&2
  exit 1
fi

echo "netlify-gate [$CONTEXT]: $DECISION — $REASON"

if [ "$DECISION" = "BUILD" ]; then
  exit 1
fi
exit 0
