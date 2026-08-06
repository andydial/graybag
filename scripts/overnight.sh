#!/usr/bin/env bash
# Runs the overnight-queue.md through Claude Code unattended.
#
#   ./scripts/overnight.sh                              # run until the queue is empty
#   START_AT=20:00 STOP_AT=11:30 ./scripts/overnight.sh  # wait until 8pm, stop after 11:30
#   GAP=1800 ./scripts/overnight.sh                      # 30 min between tasks (default 0)
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

past_stop() {
  [ -z "$STOP_AT" ] && return 1
  [ "$(date +%H:%M)" \> "$STOP_AT" ] && return 0 || return 1
}

if [ -n "$START_AT" ]; then
  echo "Waiting until $START_AT to begin. Leave this terminal open. Ctrl-C to cancel."
  while [ "$(date +%H:%M)" \< "$START_AT" ]; do sleep 30; done
  echo "It is $START_AT — starting."
fi

echo "Overnight run started $(date '+%Y-%m-%d %H:%M')"
[ -n "$STOP_AT" ] && echo "Will not start new tasks after $STOP_AT"
echo

while true; do
  if past_stop; then echo "Reached STOP_AT ($STOP_AT). Stopping."; break; fi

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
    RESULT="ok"
  else
    RESULT="FAILED (see log)"
  fi

  # tick the queue item
  awk -v n="$NUM" 'NR==n{sub(/^- \[ \]/,"- [x]")}1' "$QUEUE" > "$QUEUE.tmp" && mv "$QUEUE.tmp" "$QUEUE"

  git add -A >/dev/null 2>&1
  git commit -q -m "overnight $ID: ${TASK:0:60}" -m "Result: $RESULT. Log: logs/$(basename "$LOG")" >/dev/null 2>&1 \
    && echo "[$(date '+%H:%M')] $ID $RESULT — committed" \
    || echo "[$(date '+%H:%M')] $ID $RESULT — nothing to commit"

  tail -n 12 "$LOG" | sed 's/^/    /'
  echo

  [ "$GAP" -gt 0 ] && { echo "sleeping ${GAP}s…"; sleep "$GAP"; }
done

echo "Finished $(date '+%Y-%m-%d %H:%M'). Logs in logs/, one commit per task."
