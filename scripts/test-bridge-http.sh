#!/usr/bin/env bash
# Live check: bridge extension must be running in Cursor.
set -euo pipefail

CFG="${HOME}/.cursor/cursor-voice-bridge.json"
if [[ ! -f "${CFG}" ]]; then
  echo "Missing ${CFG} — open Cursor with Cursor Voice Bridge extension loaded."
  exit 1
fi

PORT="$(python3 -c "import json; print(json.load(open('${CFG}'))['port'])")"
TOKEN="$(python3 -c "import json; print(json.load(open('${CFG}'))['token'])")"

curl -sf "http://127.0.0.1:${PORT}/v1/health" | python3 -m json.tool
curl -sf -H "Authorization: Bearer ${TOKEN}" "http://127.0.0.1:${PORT}/v1/status" | python3 -m json.tool

echo "OK — bridge HTTP reachable"
