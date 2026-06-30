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
set -uo pipefail   # NOT -e: we handle errors ourselves so we always log.

# This script is for LINUX servers (EC2). It needs flock + xvfb-run, which do
# NOT exist on Windows/Git Bash. On Windows just run: npm run login -- --batched
case "$(uname -s)" in
  Linux*) : ;;
  *)
    echo "run.sh is for Linux servers (needs flock + xvfb-run)."
    echo "On this OS, run directly:  npm run login -- ${*:---batched}"
    exit 1
    ;;
esac

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

# Single-instance lock (skip cleanly if flock is unavailable).
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "[$(date -Is)] Another run is in progress; skipping." | tee -a "$LOG_FILE"
    exit 0
  fi
fi

# Run headed Chromium under a virtual display if xvfb-run exists.
RUNNER=()
if command -v xvfb-run >/dev/null 2>&1; then
  RUNNER=(xvfb-run -a)
else
  echo "[$(date -Is)] WARNING: xvfb-run not found — running without a virtual display." | tee -a "$LOG_FILE"
fi

echo "[$(date -Is)] Starting: npm run login -- ${ARGS[*]}" | tee -a "$LOG_FILE"

# `tee` so output appears on the terminal AND is saved to the log file.
"${RUNNER[@]}" npm run login -- "${ARGS[@]}" 2>&1 | tee -a "$LOG_FILE"
STATUS=${PIPESTATUS[0]}

echo "[$(date -Is)] Finished with exit code $STATUS" | tee -a "$LOG_FILE"

# Keep only the latest 50 run logs.
ls -1t "$LOG_DIR"/run-*.log 2>/dev/null | tail -n +51 | xargs -r rm -f

exit "$STATUS"
