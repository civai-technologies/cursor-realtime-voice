#!/usr/bin/env python3
"""Post Cursor hook stdin JSON to the local cursor-voice bridge as HarnessEvent."""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

CONFIG = Path.home() / ".cursor" / "cursor-voice-bridge.json"

# Hooks fire for every Agent tool — skip IDE/browser noise so voice is not spammed.
_NOISE_TOOL_RE = re.compile(
    r"(?i)(browser[_-]?snapshot|browser[_-]?click|browser[_-]|mcp:browser|"
    r"cursor-ide-browser|take_screenshot|browser_navigate|browser_cdp)"
)


def load_bridge() -> Optional[Dict[str, Any]]:
    if not CONFIG.is_file():
        return None
    try:
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _composer_id(payload: Dict[str, Any]) -> Optional[str]:
    composer = (
        payload.get("composer_id")
        or payload.get("composerId")
        or payload.get("session_id")
        or payload.get("sessionId")
    )
    if isinstance(composer, dict):
        composer = composer.get("id")
    return str(composer) if composer else None


def should_skip_tool(tool_name: str) -> bool:
    return bool(_NOISE_TOOL_RE.search(tool_name or ""))


def map_hook(
    hook_name: str, payload: Dict[str, Any]
) -> Optional[Tuple[str, str, Optional[str], Optional[str], bool]]:
    """Returns (kind, summary, composer_id, detail, voice_relevant) or None to skip."""
    composer_s = _composer_id(payload)

    if hook_name == "sessionStart":
        return "session_start", "Agent session started", composer_s, None, True
    if hook_name == "sessionEnd":
        return "session_end", "Agent session ended", composer_s, None, True
    if hook_name == "stop":
        return "run_done", "Agent finished its turn", composer_s, None, True
    if hook_name == "afterAgentResponse":
        text = payload.get("text") or payload.get("response") or ""
        full = str(text).strip()
        if not full:
            return None
        first_line = full.split("\n", 1)[0][:200]
        return (
            "assistant_chunk",
            first_line or "Agent responded",
            composer_s,
            full[:12000],
            True,
        )
    if hook_name == "postToolUse":
        tool = str(
            payload.get("tool_name") or payload.get("toolName") or payload.get("tool") or "tool"
        )
        if should_skip_tool(tool):
            return None
        return "tool_end", f"Agent used tool: {tool}", composer_s, None, False
    return None


def main() -> int:
    hook_name = sys.argv[1] if len(sys.argv) > 1 else "unknown"
    try:
        raw = sys.stdin.read()
        payload: Dict[str, Any] = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        payload = {}

    mapped = map_hook(hook_name, payload)
    if mapped is None:
        return 0

    kind, summary, composer_id, detail, voice_relevant = mapped

    cfg = load_bridge()
    if not cfg:
        return 0

    event: Dict[str, Any] = {
        "kind": kind,
        "summary": summary,
        "voice_relevant": voice_relevant,
    }
    if composer_id:
        event["composer_id"] = composer_id
    if detail:
        event["detail"] = detail
    if hook_name == "postToolUse":
        tool = payload.get("tool_name") or payload.get("toolName")
        if tool:
            event["tool_name"] = str(tool)

    url = f"http://{cfg['host']}:{cfg['port']}/v1/events"
    req = urllib.request.Request(
        url,
        data=json.dumps(event).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cfg['token']}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            resp.read()
    except (urllib.error.URLError, TimeoutError):
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
