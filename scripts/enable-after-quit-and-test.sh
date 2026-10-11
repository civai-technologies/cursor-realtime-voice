#!/usr/bin/env bash
# Run from Terminal.app / iTerm with Cursor fully quit (Cmd+Q).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

log() {
  echo "[$(date '+%H:%M:%S')] $*"
}

log "=== enable-after-quit-and-test ==="

if [[ "${SKIP_CURSOR_WAIT:-}" == "1" ]]; then
  log "SKIP_CURSOR_WAIT=1 — still running preflight --check (Cursor must be quit)."
  "${SCRIPT_DIR}/cursor-quit-ready.sh" --check
else
  "${SCRIPT_DIR}/cursor-quit-ready.sh" --wait
fi

log "Running enable-desktop-bridge.py (progress lines below)…"
PYTHONUNBUFFERED=1 python3 -u "${ROOT}/scripts/enable-desktop-bridge.py"

log "Opening Cursor…"
open -a Cursor

log "Waiting for ~/.cursor/desktop-bridge/ (up to 90s)…"
BRIDGE_DIR="${HOME}/.cursor/desktop-bridge"
for i in $(seq 1 45); do
  if [[ -d "${BRIDGE_DIR}" ]] && [[ -n "$(ls -A "${BRIDGE_DIR}" 2>/dev/null || true)" ]]; then
    log "Bridge discovery found: $(ls "${BRIDGE_DIR}")"
    break
  fi
  log "  … still waiting (${i}/45)"
  sleep 2
done

log "Re-applying bridge keys (Cursor often resets them on launch)…"
python3 "${ROOT}/scripts/enable-desktop-bridge.py" --runtime || {
  log "Runtime re-apply failed — will retry inside test-desktop-bridge.sh"
}

log "Running test-desktop-bridge.sh (waits up to 90s for an Agent thread)…"
WAIT_FOR_AGENT_THREADS_SEC="${WAIT_FOR_AGENT_THREADS_SEC:-90}" \
  "${ROOT}/scripts/test-desktop-bridge.sh"

log "=== finished ==="
