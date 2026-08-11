#!/usr/bin/env bash
# The pgTAP suite — run through `psql` against the local database, with a floor guard.
#
# =============================================================================
# WHY NOT `supabase test db`
# =============================================================================
#
# It reported success having run **nothing**. On 2026-08-11 `npm run test:all` was green while
# `Files=0, Tests=0, Result: NOTESTS` scrolled past: every database rule in the project —
# default-deny authorization, consent atomicity, the ledger invariants, recipient erasure —
# passing on zero assertions.
#
# The cause is not in this repository. `supabase test db` bind-mounts `supabase/tests` into a
# container and runs `pg_prove` inside it; this checkout lives under `/Volumes/Data`, which is
# not on Docker Desktop's file-sharing list, so the mount is **empty** and pg_prove finds no
# files. Reproduced directly:
#
#     docker run --rm -v "$PWD/supabase/tests:/t" alpine ls /t   # → nothing
#
# Adding `/Volumes/Data` in Docker Desktop → Settings → Resources → File Sharing fixes the
# mount. This script does not depend on it either way: `psql` talks to the database over TCP on
# the port `supabase status` publishes, so the host filesystem never has to cross into a
# container. That is strictly fewer moving parts, and it is how every suite in this repo was
# actually verified on this machine.
#
# CI is unaffected — `.github/workflows/integration.yml` runs on a checkout Docker can read —
# and keeps its own copy of the floor guard below.
#
# =============================================================================
# THE FLOOR
# =============================================================================
#
# `MIN_TESTS` is a floor, not the count. It exists because a suite that runs zero assertions
# and a suite that passes look identical in an exit status — which is the same failure `E02-24`
# found when a colliding fixture id killed the first insert in `authorization.test.sql` and
# that file silently contributed nothing. Raise it when the suite grows substantially. Never
# lower it to make a run pass.
set -uo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
MIN_TESTS="${MIN_TESTS:-150}"
TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/supabase/tests"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is not on PATH — install libpq (brew install libpq) or set DB_URL to a host that has it." >&2
  exit 1
fi

npx supabase db reset || exit 1

total=0
failed=0
for file in "$TESTS_DIR"/*.test.sql; do
  name="$(basename "$file")"
  out="$(psql "$DB_URL" -X -q -f "$file" 2>&1)"

  ok_count="$(printf '%s\n' "$out" | grep -cE '^ *ok [0-9]+' || true)"
  not_ok="$(printf '%s\n' "$out" | grep -E '^ *not ok [0-9]+' || true)"

  # DO NOT REMOVE THIS AS REDUNDANT. It looks like a belt-and-braces duplicate of the `not ok`
  # check above and it is the only thing that catches the commonest way a pgTAP file lies:
  #
  #   a statement raises (a typo, a function that does not exist in this pgTAP build), the
  #   transaction aborts, every remaining statement returns "current transaction is aborted",
  #   `finish()` never runs — and the output contains a run of passing `ok` lines and NOT ONE
  #   `not ok`.
  #
  # On 2026-08-11 that was 31 passes, 4 assertions never run, zero reported failures. See
  # docs/learnings.md. The absence of a failure is not the presence of a pass.
  errors="$(printf '%s\n' "$out" | grep -E '^psql:.*ERROR' || true)"

  total=$((total + ok_count))

  if [ -n "$not_ok" ] || [ -n "$errors" ]; then
    failed=1
    echo "FAIL $name"
    [ -n "$not_ok" ] && printf '%s\n' "$not_ok"
    # The first error only: the rest are "current transaction is aborted" noise following it.
    [ -n "$errors" ] && printf '%s\n' "$errors" | head -1
  else
    echo "ok   $name ($ok_count)"
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "pgTAP: failures above. $total assertions passed." >&2
  exit 1
fi

if [ "$total" -lt "$MIN_TESTS" ]; then
  echo "pgTAP ran only $total assertions, below the floor of $MIN_TESTS." >&2
  echo "That is what a silently-skipped suite looks like — see the header of this script." >&2
  exit 1
fi

echo "pgTAP: $total assertions passed (floor $MIN_TESTS)."
