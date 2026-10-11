#!/usr/bin/env bash
# Build the extension and print how to load it in Cursor (no VSIX required for local dev).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}/extension"
npm run compile
echo ""
echo "Extension built at: ${ROOT}/extension"
echo ""
echo "In Cursor (Mac): press Cmd+Shift+P, then type one of:"
echo "  • Cursor Voice: Restart Bridge  (HTTP bridge only — no full app restart)"
echo "  • Cursor Voice: Reload extension  (after you pull new extension code)"
echo "  First install:"
echo "  1. Extensions sidebar → … → Install from Location… → choose:"
echo "     ${ROOT}/extension"
echo "  3. Test: Command Palette → Cursor Voice: Test Send to Agent"
echo "  4. Then: cd ${ROOT} && npm start → http://127.0.0.1:8787"
echo ""
