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
COMMIT_MESSAGE="$(git log -1 --pretty=%B 2>/dev/null || true)"

RESULT="$(
  CONTEXT="$CONTEXT" \
  COMMIT_MESSAGE="$COMMIT_MESSAGE" \
  PROMOTE_TO_PRODUCTION="${PROMOTE_TO_PRODUCTION:-}" \
  node --input-type=module -e '
    import { shouldBuild } from "./scripts/lib/netlify-gate.mjs";
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
