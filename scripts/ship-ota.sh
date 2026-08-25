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
#   3. **`apps/mobile/.env` silently wins.** That file names the STAGING project and a
#      `rzp_test` key — it is what a developer wants locally and is catastrophic in a
#      production bundle, because every install on the channel would quietly change backend
#      and payment key. The first update published by this script went out with
#      `"appEnv":"local"` for exactly this reason. `EXPO_NO_DOTENV=1` stops the bundler
#      reading it, so the values come from the EAS `production` environment and nowhere else.
#   4. **`APP_ENV` is not an `EXPO_PUBLIC_` variable**, so it is not in the EAS environment at
#      all. `app.config.js` reads it to pick the app identity and stamps `extra.appEnv`;
#      unset, it falls back to `local`. It has to be passed explicitly.
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

# `EXPO_NO_DOTENV=1` and an explicit `APP_ENV` are both load-bearing — see notes 3 and 4 above.
# Verify afterwards with:
#   curl -s https://u.expo.dev/<project> -H "expo-platform: ios" \
#     -H "expo-runtime-version: 4.0.0" -H "expo-channel-name: production" \
#     -H "expo-protocol-version: 1" -H "expo-api-version: 1" -H "accept: multipart/mixed" \
#     | grep -o '"appEnv":"[a-z]*"'
# It must say `production`. If it says `local`, the bundle is pointing at staging.
#   5. **A stale bundler cache re-uses the PREVIOUS build's environment.** Demonstrated
#      2026-08-26, and it is the same failure as note 3 wearing a different coat. A local
#      `expo export` was run with deliberate control values for the PostHog key, the Supabase URL
#      and the anon key; the bundle came out carrying the **real production key and the real
#      production project ref** instead, because Metro reused cached modules from an earlier
#      export and `EXPO_PUBLIC_*` values are inlined into those modules at transform time. Every
#      control string was absent. Re-running with `--clear` produced all three controls and none
#      of the stale values.
#
#      The direction that bit us before was staging leaking into production. This is the same
#      mechanism pointing the other way, and it is worse to reason about because *nothing on the
#      command line is wrong* — the env is correct, the flags are correct, and the bundle still
#      carries values from whenever the cache was last warm. `--clear-cache` costs a couple of
#      minutes per publish and removes the entire class.
APP_ENV=production EXPO_NO_DOTENV=1 exec npx eas update \
  --branch production \
  --environment production \
  --clear-cache \
  --message "$message ($sha$dirty)"
