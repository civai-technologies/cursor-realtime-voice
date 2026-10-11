#!/usr/bin/env bash
# One-command setup: deps, Cursor extension, hooks, voice server, open browser.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "${ROOT}"

CURSOR_BIN="/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
PORT="${CURSOR_VOICE_TOKEN_PORT:-8787}"
URL="http://127.0.0.1:${PORT}"

log() { echo "[cursor-voice] $*"; }

if [[ "$(uname -s)" != "Darwin" ]]; then
  log "This script is tested on macOS. On Linux, install the VSIX manually and run npm start."
fi

log "Installing npm dependencies…"
npm install

log "Building extension…"
npm run compile --prefix extension

log "Packaging & installing Cursor extension…"
VSIX="/tmp/cursor-voice-bridge.vsix"
(cd extension && npx --yes @vscode/vsce package --allow-missing-repository -o "${VSIX}")
if [[ -x "${CURSOR_BIN}" ]]; then
  "${CURSOR_BIN}" --install-extension "${VSIX}" || log "Warning: could not install VSIX — install ${VSIX} manually in Cursor."
else
  log "Cursor CLI not found at ${CURSOR_BIN} — open Cursor → Extensions → Install from VSIX… → ${VSIX}"
fi

log "Installing Cursor hooks (agent progress → voice)…"
./scripts/install-hooks.sh

if [[ ! -f "${ROOT}/.env" ]]; then
  cp "${ROOT}/.env.example" "${ROOT}/.env"
  log "Created .env from .env.example"
fi

if ! grep -q '^OPENAI_API_KEY=sk-' "${ROOT}/.env" 2>/dev/null; then
  log "No OPENAI_API_KEY in .env yet — you can paste it in the browser UI at ${URL} after start."
fi

log "Stopping any old server on port ${PORT}…"
lsof -ti:"${PORT}" 2>/dev/null | xargs kill -9 2>/dev/null || true

log "Starting voice server (background)…"
npm start > "${ROOT}/.cursor-voice-server.log" 2>&1 &
SERVER_PID=$!
echo "${SERVER_PID}" > "${ROOT}/.cursor-voice-server.pid"

for i in $(seq 1 45); do
  if curl -sf "${URL}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -sf "${URL}/api/health" >/dev/null 2>&1; then
  log "Server did not become ready — see ${ROOT}/.cursor-voice-server.log"
  exit 1
fi

log "Opening ${URL}"
if command -v open >/dev/null; then
  open "${URL}"
fi

log "Done."
log "  1. In Cursor: Cmd+Shift+P → Cursor Voice: Restart Bridge (first install or if voice says bridge unreachable)."
log "  2. Keep an Agent chat open."
log "  3. In the browser: save OpenAI key if needed → Start voice."
log "  Logs: ${ROOT}/.cursor-voice-server.log   Stop: kill \$(cat ${ROOT}/.cursor-voice-server.pid)"
