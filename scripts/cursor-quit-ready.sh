#!/usr/bin/env bash
# True when it is safe to patch state.vscdb (Cursor not holding the DB lock).
set -euo pipefail

cursor_app_running() {
  osascript -e 'application "Cursor" is running' 2>/dev/null | grep -qi '^true$'
}

state_db_unlocked() {
  python3 - <<'PY'
import sqlite3
import sys
from pathlib import Path

p = Path.home() / "Library/Application Support/Cursor/User/globalStorage/state.vscdb"
if not p.is_file():
    sys.exit(1)
try:
    con = sqlite3.connect(str(p), timeout=0.5)
    con.execute("PRAGMA busy_timeout = 500")
    con.execute("BEGIN IMMEDIATE")
    con.rollback()
    con.close()
except sqlite3.Error:
    sys.exit(1)
PY
}

run_check() {
  if cursor_app_running; then
    echo "Cursor app: still running — use Cmd+Q (not only close windows)."
    echo "  osascript -e 'tell application \"Cursor\" to quit'"
    return 1
  fi
  if ! state_db_unlocked; then
    echo "state.vscdb: locked — quit Cursor (Cmd+Q), then: killall Cursor"
    return 1
  fi
  echo "OK: Cursor not running and state.vscdb is writable."
  return 0
}

if [[ "${1:-}" == "--check" ]]; then
  run_check
  exit $?
fi

if [[ "${1:-}" == "--wait" ]]; then
  if [[ "${SKIP_CURSOR_WAIT:-}" == "1" ]]; then
    exit 0
  fi
  if run_check >/dev/null 2>&1; then
    run_check
    exit 0
  fi
  echo "Waiting until safe to patch state.vscdb (quit Cursor with Cmd+Q)…"
  for n in $(seq 1 90); do
    if run_check >/dev/null 2>&1; then
      run_check
      exit 0
    fi
    if cursor_app_running; then
      echo "  [$n/90] Cursor app still running — Cmd+Q required."
    else
      echo "  [$n/90] state.vscdb still locked…"
    fi
    sleep 2
  done
  echo "Timed out. Try: killall Cursor"
  run_check
  exit 1
fi

echo "Usage: $0 --check | --wait" >&2
exit 2
