#!/usr/bin/env bash
# Runs the overnight-queue.md through Claude Code unattended.
#
#   ./scripts/overnight.sh                              # run until the queue is empty
#   START_AT=20:00 STOP_AT=11:30 ./scripts/overnight.sh  # wait until 8pm, stop after 11:30
#   GAP=1800 ./scripts/overnight.sh                      # 30 min between tasks (default 0)
#
# Stops on its own when: the queue empties, STOP_AT passes, the plan's token quota
# is exhausted, or two tasks fail in a row. Failed tasks are NOT ticked off.
#
# Each task: hand to Claude Code -> log -> git commit -> next.
# Ctrl-C stops after the current task.

set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
QUEUE="$ROOT/planning/overnight-queue.md"
LOGDIR="$ROOT/logs"
GAP="${GAP:-0}"
STOP_AT="${STOP_AT:-}"
START_AT="${START_AT:-}"
mkdir -p "$LOGDIR"

command -v claude >/dev/null || { echo "ERROR: 'claude' not on PATH. Install Claude Code first."; exit 1; }
command -v git    >/dev/null || { echo "ERROR: git not found."; exit 1; }
[ -d .git ] || { echo "ERROR: no git repo here. Run:  git init && git add -A && git commit -m 'baseline'"; exit 1; }

# Turn an HH:MM into an absolute epoch. If that time has already passed today,
# it means tomorrow — so an 11pm start with STOP_AT=11:00 runs through the night.
to_epoch() {
  local hhmm="$1" today target now
  today=$(date +%Y-%m-%d)
  now=$(date +%s)
  if date -j -f "%Y-%m-%d %H:%M" "$today $hhmm" +%s >/dev/null 2>&1; then
    target=$(date -j -f "%Y-%m-%d %H:%M" "$today $hhmm" +%s)          # BSD / macOS
  else
    target=$(date -d "$today $hhmm" +%s)                              # GNU
  fi
  [ "$target" -le "$now" ] && target=$((target + 86400))
  echo "$target"
}

STOP_EPOCH=""
[ -n "$STOP_AT" ] && STOP_EPOCH=$(to_epoch "$STOP_AT")

past_stop() {
  [ -z "$STOP_EPOCH" ] && return 1
  [ "$(date +%s)" -ge "$STOP_EPOCH" ] && return 0 || return 1
}

if [ -n "$START_AT" ]; then
  START_EPOCH=$(to_epoch "$START_AT")
  echo "Waiting until $(date -r "$START_EPOCH" '+%a %H:%M' 2>/dev/null || date -d "@$START_EPOCH" '+%a %H:%M') to begin."
  echo "Leave this terminal open. Ctrl-C to cancel."
  while [ "$(date +%s)" -lt "$START_EPOCH" ]; do sleep 30; done
  echo "Starting."
fi

FAILS=0

echo "Overnight run started $(date '+%Y-%m-%d %H:%M')"
[ -n "$STOP_EPOCH" ] && echo "Will not start new tasks after $(date -r "$STOP_EPOCH" '+%a %d %b %H:%M' 2>/dev/null || date -d "@$STOP_EPOCH" '+%a %d %b %H:%M')"
echo

while true; do
  if past_stop; then echo "Reached the $STOP_AT cut-off. Stopping."; break; fi

  LINE=$(grep -n -m1 '^- \[ \] `Q' "$QUEUE" || true)
  [ -z "$LINE" ] && { echo "Queue empty. Done."; break; }

  NUM="${LINE%%:*}"
  TEXT="${LINE#*:}"
  ID=$(echo "$TEXT" | sed -n 's/^- \[ \] `\([A-Z0-9]*\)`.*/\1/p')
  TASK=$(echo "$TEXT" | sed 's/^- \[ \] `[A-Z0-9]*` //')
  STAMP=$(date '+%Y%m%d-%H%M%S')
  LOG="$LOGDIR/overnight-$ID-$STAMP.log"

  echo "──────────────────────────────────────────────"
  echo "[$(date '+%H:%M')] $ID starting  ->  $LOG"

  PROMPT="You are working unattended on the GrayBag rebuild. Read CLAUDE.md, docs/decisions.md, docs/open-questions.md and the relevant files in backlog/ before you start.

TASK $ID:
$TASK

Rules for this unattended run:
- Produce the file(s) named in the task. Do not start unrelated work.
- Where a decision is genuinely open, write the options and a recommendation, and add it to docs/open-questions.md. Never invent an answer and proceed as if it were settled.
- Do not touch any task tagged (owner:andy) in backlog/.
- Do not run git commit — the wrapper script handles that.
- Do not attempt anything needing network credentials, accounts, or a deployed service.
- Record anything non-obvious you learned in docs/learnings.md.
- Finish with a short summary of what you produced and what a human needs to check."

  if claude -p "$PROMPT" --permission-mode acceptEdits >"$LOG" 2>&1; then
    OK=1; RESULT="ok"
  else
    OK=0; RESULT="FAILED (see log)"
  fi

  # Out of quota / rate limited -> stop now. Do not burn the queue on failures.
  if grep -qiE 'usage limit|rate.?limit|quota|out of credit|insufficient credit|429|too many requests' "$LOG"; then
    echo
    echo "  ── Quota or rate limit hit. Stopping. ──"
    echo "  $ID was NOT completed and stays unticked; rerun the same command later"
    echo "  and it will resume from $ID."
    tail -n 15 "$LOG" | sed 's/^/    /'
    git add -A >/dev/null 2>&1
    git commit -q -m "overnight $ID: partial (quota reached)" >/dev/null 2>&1
    break
  fi

  if [ "$OK" -eq 1 ]; then
    # only tick on success
    awk -v n="$NUM" 'NR==n{sub(/^- \[ \]/,"- [x]")}1' "$QUEUE" > "$QUEUE.tmp" && mv "$QUEUE.tmp" "$QUEUE"
    FAILS=0
  else
    FAILS=$((FAILS+1))
  fi

  git add -A >/dev/null 2>&1
  git commit -q -m "overnight $ID: ${TASK:0:60}" -m "Result: $RESULT. Log: logs/$(basename "$LOG")" >/dev/null 2>&1 \
    && echo "[$(date '+%H:%M')] $ID $RESULT — committed" \
    || echo "[$(date '+%H:%M')] $ID $RESULT — nothing to commit"

  tail -n 12 "$LOG" | sed 's/^/    /'
  echo

  if [ "$FAILS" -ge 2 ]; then
    echo "  ── Two tasks failed in a row. Stopping rather than burning the queue. ──"
    echo "  Check the last two logs in logs/ before rerunning."
    break
  fi

  if [ "$OK" -eq 0 ]; then
    echo "  $ID failed and stays unticked — it will be retried on the next run."
    echo
  fi

  [ "$GAP" -gt 0 ] && { echo "sleeping ${GAP}s…"; sleep "$GAP"; }
done

echo "Finished $(date '+%Y-%m-%d %H:%M'). Logs in logs/, one commit per task."
