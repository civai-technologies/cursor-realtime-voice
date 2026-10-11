#!/usr/bin/env bash
# One-command setup: deps, Cursor extension, hooks, voice server, open browser.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "${ROOT}"

# shellcheck source=scripts/lib/platform.sh
source "${ROOT}/scripts/lib/platform.sh"
platform_detect

PORT="${CURSOR_VOICE_TOKEN_PORT:-8787}"
URL="http://127.0.0.1:${PORT}"

log() { echo "[cursor-realtime-voice] $*"; }

log "Platform: ${PLATFORM_NAME} (${PLATFORM_ID})"

if [[ "${PLATFORM_ID}" == "unknown" ]]; then
  log "Warning: unrecognized OS. Continuing anyway; report issues on GitHub."
fi

log "Installing npm dependencies…"
npm install

log "Building extension…"
npm run compile --prefix extension

log "Packaging extension…"
VSIX="/tmp/cursor-voice-bridge.vsix"
if [[ "${PLATFORM_ID}" == "windows" ]]; then
  VSIX="${TMP:-/tmp}/cursor-voice-bridge.vsix"
fi
(cd extension && npx --yes @vscode/vsce package --allow-missing-repository -o "${VSIX}")

log "Installing Cursor extension…"
CURSOR_CLI=""
if CURSOR_CLI="$(platform_find_cursor_cli)"; then
  log "Using Cursor CLI: ${CURSOR_CLI}"
  if "${CURSOR_CLI}" --install-extension "${VSIX}"; then
    log "Extension installed via Cursor CLI."
  else
    log "Warning: Cursor CLI install failed. Try manual VSIX: ${VSIX}"
  fi
else
  log "Cursor CLI not found. Manual install:"
  log "  Cursor → Extensions → … → Install from VSIX… → ${VSIX}"
  log "  Or copy the built extension folder (see ./scripts/sync-extension-to-cursor.sh)."
fi

log "Installing Cursor hooks (agent progress → voice)…"
./scripts/install-hooks.sh

if [[ ! -f "${ROOT}/.env" ]]; then
  cp "${ROOT}/.env.example" "${ROOT}/.env"
  log "Created .env from .env.example"
fi

if ! grep -qE '^OPENAI_API_KEY=sk-' "${ROOT}/.env" 2>/dev/null; then
  log "No OPENAI_API_KEY in .env yet. You can paste it in the browser UI at ${URL} after start."
fi

log "Stopping any old server on port ${PORT}…"
platform_kill_port "${PORT}"

log "Starting voice server (background)…"
npm start > "${ROOT}/.cursor-voice-server.log" 2>&1 &
SERVER_PID=$!
echo "${SERVER_PID}" > "${ROOT}/.cursor-voice-server.pid"

for _ in $(seq 1 45); do
  if curl -sf "${URL}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -sf "${URL}/api/health" >/dev/null 2>&1; then
  log "Server did not become ready. See ${ROOT}/.cursor-voice-server.log"
  exit 1
fi

log "Opening ${URL}"
platform_open_url "${URL}"

log "Done."
platform_post_install_notes
log "  Logs: ${ROOT}/.cursor-voice-server.log   Stop: kill \$(cat ${ROOT}/.cursor-voice-server.pid)"
