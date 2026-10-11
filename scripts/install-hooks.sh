#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_SRC="${REPO_ROOT}/hooks/emit_event.py"
USER_HOOKS_DIR="${HOME}/.cursor/hooks"
USER_HOOKS_JSON="${HOME}/.cursor/hooks.json"
DEST="${USER_HOOKS_DIR}/cursor-voice-emit_event.py"

mkdir -p "${USER_HOOKS_DIR}"
chmod +x "${HOOKS_SRC}"
cp "${HOOKS_SRC}" "${DEST}"

export CURSOR_VOICE_HOOK_DEST="${DEST}"
export CURSOR_VOICE_HOOKS_JSON="${USER_HOOKS_JSON}"

python3 <<'PY'
import json
import os
from pathlib import Path

dest = Path(os.environ["CURSOR_VOICE_HOOK_DEST"])
hooks_json = Path(os.environ["CURSOR_VOICE_HOOKS_JSON"])

events = ["sessionStart", "sessionEnd", "postToolUse", "stop", "afterAgentResponse"]
entries_for = {
    ev: [{"command": f'python3 "{dest}" {ev}'}] for ev in events
}

if hooks_json.is_file():
    data = json.loads(hooks_json.read_text(encoding="utf-8"))
else:
    data = {"version": 1, "hooks": {}}

data.setdefault("version", 1)
merged = data.setdefault("hooks", {})

for ev, new_entries in entries_for.items():
    existing = merged.get(ev, [])
    cmds = {e.get("command") for e in existing if isinstance(e, dict)}
    for entry in new_entries:
        if entry["command"] not in cmds:
            existing.append(entry)
    merged[ev] = existing

hooks_json.parent.mkdir(parents=True, exist_ok=True)
hooks_json.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
print(f"Updated {hooks_json}")
PY

echo "Hooks installed. Restart Cursor if hooks.json was new."
