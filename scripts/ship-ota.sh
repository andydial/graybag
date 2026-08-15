#!/usr/bin/env bash
#
# Ship a JS-only fix to every production install. `E17-55`.
#
#     npm run ship:ota -- "what changed"
#
# ## Why this is a script and not a one-liner in package.json
#
# It was `cd apps/mobile && npx eas update --branch production --message`, and that fails in two
# ways that both look like something else:
#
#   1. **The message loses its quoting.** `npm run ship:ota -- "build label names the JS"`
#      appends the words unquoted, so `eas` receives `--message build` followed by four stray
#      positionals. The error it prints is about the flags, not about quoting. npm does this
#      regardless of how the caller quotes, which is why this script joins `"$*"` rather than
#      trusting `"$1"`.
#   2. **`--environment` is required whenever stdin is not a TTY**, which includes every CI run
#      and every invocation from a tool. `eas` exits with
#      "The `--environment` flag must be set when running in `--non-interactive` mode".
#
# Both are fixed here rather than in documentation, so the documented command is the working one.
set -euo pipefail

message="$*"
if [ $# -lt 1 ] || [ -z "${message// /}" ]; then
  cat >&2 <<'USAGE'
A message is required.

    npm run ship:ota -- "what changed"

It is the only description of this update anyone will ever see — it is what
`eas update:list` shows when you are deciding what to roll back to.
USAGE
  exit 2
fi

cd "$(dirname "$0")/.."

# The commit is appended rather than left to the caller: a message like "fix the cart" is
# unrecoverable a week later, and the sha is the only thing that ties a published bundle back to
# a diff. `--quiet` is deliberately absent — the output includes the update group id, which is
# what the Account screen's `OTA …` segment is matched against.
sha=$(git rev-parse --short HEAD)
dirty=""
git diff --quiet || dirty=" +uncommitted"

# `cd` + `npx`, not `npm --prefix … exec`: eas-cli is not a dependency of apps/mobile, so
# `npm exec --prefix` answers "could not determine executable to run". `npx` from inside the
# directory resolves the workspace root's copy, and `eas` needs that cwd anyway — it reads
# app.json and eas.json relative to it.
cd apps/mobile
exec npx eas update \
  --branch production \
  --environment production \
  --message "$message ($sha$dirty)"
