#!/usr/bin/env bash
#
# run.sh — server entrypoint for the BLS bot.
#
#  - loads .env (so cron has the secrets)
#  - runs headed Chromium under a virtual display (xvfb-run) so the browser
#    fingerprint matches local headed runs (fewer /account/bot blocks)
#  - single-instance lock via flock, so a slow run never overlaps the next
#    cron tick
#
# Usage:
#   scripts/run.sh                 # default: --batched
#   scripts/run.sh --all           # pass any login CLI flags through
#
set -euo pipefail

# Resolve the project root (this script lives in <root>/scripts).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Default args if none given.
ARGS=("$@")
if [ ${#ARGS[@]} -eq 0 ]; then
  ARGS=(--batched)
fi

LOCK_FILE="/tmp/bls-bot.run.lock"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/run-$TS.log"

# Single-instance: acquire an exclusive, non-blocking lock. If another run holds
# it, exit quietly (the next cron tick will try again).
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -Is)] Another run is in progress; skipping." >> "$LOG_FILE"
  exit 0
fi

echo "[$(date -Is)] Starting: npm run login -- ${ARGS[*]}" | tee -a "$LOG_FILE"

# npm scripts already load .env via --env-file-if-exists; xvfb-run provides the
# virtual display for headed Chromium. -a picks a free display number.
xvfb-run -a npm run login -- "${ARGS[@]}" >> "$LOG_FILE" 2>&1
STATUS=$?

echo "[$(date -Is)] Finished with exit code $STATUS" | tee -a "$LOG_FILE"

# Keep only the latest 50 run logs.
ls -1t "$LOG_DIR"/run-*.log 2>/dev/null | tail -n +51 | xargs -r rm -f

exit $STATUS
