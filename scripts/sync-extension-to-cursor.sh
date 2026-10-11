#!/usr/bin/env bash
# Build extension and install into ~/.cursor/extensions (Cursor often ignores VSIX from CLI).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/platform.sh
source "${ROOT}/scripts/lib/platform.sh"
platform_detect

EXT_SRC="${ROOT}/extension"
VER="$(node -p "require('${EXT_SRC}/package.json').version")"
EXT_ROOT="$(platform_cursor_extensions_dir)"
DEST="${EXT_ROOT}/civai.cursor-voice-bridge-${VER}"
PALETTE="$(platform_palette_key)"

cd "${EXT_SRC}"
npm run compile

rm -rf "${DEST}"
mkdir -p "${DEST}"
cp "${EXT_SRC}/package.json" "${DEST}/"
cp -R "${EXT_SRC}/out" "${DEST}/out"

for old in "${EXT_ROOT}/civai.cursor-voice-bridge-"*; do
  [[ -d "${old}" ]] || continue
  if [[ "${old}" != "${DEST}" ]]; then
    rm -rf "${old}"
  fi
done

echo "Installed Cursor Voice Bridge ${VER} at:"
echo "  ${DEST}"
echo ""
echo "In Cursor: ${PALETTE}+Shift+P → Developer: Reload Window"
echo "Then: Cursor Voice: Send test line to Agent chat"
echo "Modal must say extension v${VER} and composer.desktopBridge.sendMessage (in-IDE command, not terminal CLI)."
