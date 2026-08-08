#!/usr/bin/env bash
# Nightly: run the full test suite, and hand any failures to Claude Code to fix.
#
#   ./scripts/nightly.sh                    # run now
#   START_AT=22:00 ./scripts/nightly.sh     # wait until 10pm, then run
#   ROUNDS=3 ./scripts/nightly.sh           # up to 3 fix attempts (default 3)
#
# Per-push CI runs only a ~60s smoke test. This is where the full suite lives.

set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
LOGDIR="$ROOT/logs"; mkdir -p "$LOGDIR"
ROUNDS="${ROUNDS:-3}"
START_AT="${START_AT:-}"
STAMP=$(date '+%Y%m%d-%H%M%S')
LOG="$LOGDIR/nightly-$STAMP.log"

command -v claude >/dev/null || { echo "ERROR: 'claude' not on PATH."; exit 1; }
[ -d .git ] || { echo "ERROR: no git repo here."; exit 1; }

to_epoch() {
  local hhmm="$1" today target now
  today=$(date +%Y-%m-%d); now=$(date +%s)
  if date -j -f "%Y-%m-%d %H:%M" "$today $hhmm" +%s >/dev/null 2>&1; then
    target=$(date -j -f "%Y-%m-%d %H:%M" "$today $hhmm" +%s)
  else
    target=$(date -d "$today $hhmm" +%s)
  fi
  [ "$target" -le "$now" ] && target=$((target + 86400))
  echo "$target"
}

if [ -n "$START_AT" ]; then
  E=$(to_epoch "$START_AT")
  echo "Waiting until $START_AT. Leave this terminal open. Ctrl-C to cancel."
  while [ "$(date +%s)" -lt "$E" ]; do sleep 30; done
fi

echo "Nightly run $(date '+%Y-%m-%d %H:%M')  ->  $LOG"
git add -A >/dev/null 2>&1
git commit -q -m "nightly: checkpoint before test run" >/dev/null 2>&1

for i in $(seq 1 "$ROUNDS"); do
  echo "── round $i/$ROUNDS: running full suite ──"
  if npm run test:all >"$LOG.round$i" 2>&1; then
    echo "  suite GREEN on round $i"
    git add -A >/dev/null 2>&1
    git commit -q -m "nightly: suite green (round $i)" >/dev/null 2>&1
    echo "Finished $(date '+%H:%M') — green."
    exit 0
  fi

  echo "  suite RED — handing failures to Claude Code"
  tail -n 40 "$LOG.round$i" | sed 's/^/    /'

  if grep -qiE 'usage limit|rate.?limit|quota|429' "$LOG.round$i"; then
    echo "  quota hit. Stopping."; exit 1
  fi

  claude -p "The full test suite is failing. The complete output is in $LOG.round$i — read it.

Fix the underlying causes, not the tests. Do not delete, skip or weaken a test to make it
pass; if a test is genuinely wrong, fix it and say clearly in your summary that you changed
a test and why.

Read CLAUDE.md and docs/mvp-scope.md first, plus docs/decisions.md — which is an index — then
open only the docs/decisions/<area>.md files covering what you are about to touch. Never read
the whole log, and do not read docs/decisions-archive.md at all. Stay inside the MVP scope —
do not build fast-follow work. Record anything non-obvious in docs/learnings.md.
Do not run git commit; this script handles it." --dangerously-skip-permissions >>"$LOG" 2>&1

  node scripts/sync-state.mjs push >/dev/null 2>&1
  node scripts/build-backlog.mjs   >/dev/null 2>&1
  git add -A >/dev/null 2>&1
  git commit -q -m "nightly: automated fix attempt $i" >/dev/null 2>&1
done

echo
echo "Suite still RED after $ROUNDS attempts. Needs a human — see $LOG.round$ROUNDS"
exit 1
