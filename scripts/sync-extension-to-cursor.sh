#!/usr/bin/env bash
# Build extension and install into ~/.cursor/extensions (Cursor often ignores VSIX from CLI).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT_SRC="${ROOT}/extension"
VER="$(node -p "require('${EXT_SRC}/package.json').version")"
DEST="${HOME}/.cursor/extensions/civai.cursor-voice-bridge-${VER}"

cd "${EXT_SRC}"
npm run compile

rm -rf "${DEST}"
mkdir -p "${DEST}"
cp "${EXT_SRC}/package.json" "${DEST}/"
cp -R "${EXT_SRC}/out" "${DEST}/out"

# Drop stale folders so Cursor does not keep loading 0.1.0–0.1.3.
for old in "${HOME}/.cursor/extensions/civai.cursor-voice-bridge-"*; do
  [[ -d "${old}" ]] || continue
  if [[ "${old}" != "${DEST}" ]]; then
    rm -rf "${old}"
  fi
done

echo "Installed Cursor Voice Bridge ${VER} at:"
echo "  ${DEST}"
echo ""
echo "In Cursor: Cmd+Shift+P → Developer: Reload Window"
echo "Then: Cursor Voice: Send test line to Agent chat"
echo "Modal must say extension v${VER} and composer.desktopBridge.sendMessage (in-IDE command, not terminal CLI)."
