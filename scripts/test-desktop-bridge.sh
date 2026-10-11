#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CURSOR_APP="/Applications/Cursor.app/Contents/MacOS/Cursor"
CLI_JS="/Applications/Cursor.app/Contents/Resources/app/out/cli.js"
BRIDGE_DIR="${HOME}/.cursor/desktop-bridge"
WAIT_SEC="${WAIT_FOR_AGENT_THREADS_SEC:-0}"
STATE_DB="${HOME}/Library/Application Support/Cursor/User/globalStorage/state.vscdb"

run_desktop() {
  ELECTRON_RUN_AS_NODE=1 "${CURSOR_APP}" "${CLI_JS}" desktop "$@"
}

bridge_enabled_in_db() {
  sqlite3 "${STATE_DB}" \
    "SELECT value FROM ItemTable WHERE key = 'cursor.desktopBridge.enabled';" 2>/dev/null \
    | grep -q '^true$'
}

echo "== Desktop bridge discovery =="
if [[ ! -d "${BRIDGE_DIR}" ]]; then
  echo "Missing ${BRIDGE_DIR} — enable bridge, quit Cursor (Cmd+Q), reopen, then retry."
  exit 1
fi
ls -la "${BRIDGE_DIR}"

if ! bridge_enabled_in_db; then
  echo ""
  echo "== Bridge flag off in state DB — runtime re-apply =="
  python3 "${ROOT}/scripts/enable-desktop-bridge.py" --runtime || {
    echo "Could not write state.vscdb (quit and re-run ./scripts/enable-after-quit-and-test.sh)."
    exit 1
  }
fi

echo ""
echo "== cursor desktop ls --json =="
OUT="$(run_desktop ls --json 2>&1)" || true
echo "${OUT}"
if [[ -z "${OUT}" ]] || [[ "${OUT}" == *"no running Cursor desktop"* ]]; then
  echo "Cursor desktop CLI cannot see a running instance."
  exit 1
fi
if [[ "${OUT}" == *"Desktop bridge is disabled"* ]]; then
  echo "Desktop bridge is disabled — run: python3 scripts/enable-desktop-bridge.py --runtime"
  exit 1
fi

pick_thread_id() {
  python3 -c "
import json, sys
raw = sys.stdin.read().strip()
start = raw.find('[')
if start < 0:
    sys.exit(2)
data = json.loads(raw[start:])
if not data:
    sys.exit(1)
print(data[0]['id'])
" <<<"${1}"
}

THREAD_ID=""
if [[ "${WAIT_SEC}" =~ ^[0-9]+$ ]] && [[ "${WAIT_SEC}" -gt 0 ]]; then
  echo ""
  echo "Waiting up to ${WAIT_SEC}s for an Agent thread (open Composer, focus chat, send one message)…"
  for ((i = 1; i <= WAIT_SEC; i += 2)); do
    OUT="$(run_desktop ls --json 2>&1)" || true
    if THREAD_ID="$(pick_thread_id "${OUT}" 2>/dev/null)"; then
      echo "Found thread after ~${i}s."
      break
    fi
    sleep 2
  done
else
  THREAD_ID="$(pick_thread_id "${OUT}" 2>/dev/null)" || true
fi

if [[ -z "${THREAD_ID}" ]]; then
  echo ""
  if python3 "${ROOT}/scripts/enable-desktop-bridge.py" --diagnose 2>/dev/null; then
    echo ""
    echo "No live Agent threads yet (ls returned [])."
    echo "In Cursor: open Agent (Composer), focus the chat, send any message, then run:"
    echo "  WAIT_FOR_AGENT_THREADS_SEC=90 ./scripts/test-desktop-bridge.sh"
  else
    diag_rc=$?
    if [[ "${diag_rc}" -eq 2 ]]; then
      exit 2
    fi
  fi
  exit 1
fi

echo ""
echo "Using thread: ${THREAD_ID}"
PROMPT='Reply with exactly the single line DESKTOP-BRIDGE-OK and nothing else.'

echo ""
echo "== cursor desktop send =="
SEND_OUT="$(run_desktop send "${THREAD_ID}" "${PROMPT}" --json 2>&1)" || true
echo "${SEND_OUT}"

if [[ "${SEND_OUT}" == *"Desktop bridge is disabled"* ]]; then
  echo "Send blocked — run: python3 scripts/enable-desktop-bridge.py --runtime"
  exit 1
fi
if [[ "${SEND_OUT}" != *"submitted"* ]] && [[ "${SEND_OUT}" != *"queued"* ]]; then
  echo "Send did not return submitted/queued."
  exit 1
fi

echo ""
echo "Check the Agent thread in Cursor for assistant text containing DESKTOP-BRIDGE-OK."
