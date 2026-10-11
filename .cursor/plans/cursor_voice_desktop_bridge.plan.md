# Cursor voice — Phase 0: Desktop bridge (CLI control of IDE Agent)

## Objective

Prove end-to-end control of **the IDE Agent thread** (not headless `cursor-agent`) via:

```bash
cursor desktop ls --json
cursor desktop send <thread-id> "..." --json
```

## Prerequisites (what must be true)

| Requirement | Where it lives | How we satisfy it |
|-------------|----------------|-------------------|
| Feature gate `desktop_bridge` | Statsig bootstrap in `state.vscdb` (`feature_gates["3243374860"].value`) | `scripts/enable-desktop-bridge.py` sets gate to `true` |
| User opt-in | Application storage `cursor/desktopBridgeUserEnabled` | Same script sets `true` |
| Gate mirror flag | `cursor.desktopBridge.enabled` in same DB | Same script sets `true` |
| Main-process HTTP bridge | Electron main `desktopBridgeMainService` | Starts after **full app restart** when both flags are true |
| Discovery files | `~/.cursor/desktop-bridge/<hash>.json` | Written by main when bridge starts |
| CLI routing | `cli.js` only parses `desktop` when discovery files exist (or dev build) | Appears after discovery exists |

**Restart rule:** Changing storage is not enough while Cursor is running — **Cmd+Q**, reopen, then test.

## UI mockup (operator flow)

```text
┌─────────────────────────────────────────────────────────────┐
│ Cursor → Settings → Beta                                    │
│   [x] Allow CLI to access desktop agents   (if visible)      │
│   (Optional if using enable-desktop-bridge.py)              │
└─────────────────────────────────────────────────────────────┘
         │ quit + reopen
         ▼
┌─────────────────────────────────────────────────────────────┐
│ Terminal                                                    │
│ $ ls ~/.cursor/desktop-bridge/                              │
│   a1b2c3d4e5f67890.json                                     │
│ $ cursor desktop ls --json                                  │
│   [ { "id": "…", "title": "…", "status": "idle" } ]         │
│ $ cursor desktop send <id> "Say DESKTOP-BRIDGE-OK" --json   │
│   { "status": "submitted", "threadId": "…" }                │
└─────────────────────────────────────────────────────────────┘
         ▼
┌─────────────────────────────────────────────────────────────┐
│ IDE Agent panel — new user message + assistant reply          │
└─────────────────────────────────────────────────────────────┘
```

## Deliverables

### D1 — Enable script (done)

- `scripts/enable-desktop-bridge.py` — backup DB, flip Statsig gate hash `3243374860` (`desktop_bridge`), set `cursor.desktopBridge.enabled` and `cursor/desktopBridgeUserEnabled`.
- **Must run while Cursor is fully quit** — `state.vscdb` is locked while the app is open.
- Backups: **keys-only JSON** (~few KB) in `~/Documents/cursor-desktop-bridge-backups/` — **not** a full copy of `state.vscdb` (often 50–80+ GB on disk).
- Restore: `python3 scripts/restore-desktop-bridge-keys.py <backup.json>`
- Preflight: `python3 scripts/enable-desktop-bridge.py --verify` (read-only).

### D2 — Test script (done)

- `scripts/test-desktop-bridge.sh` — verify discovery dir, `ls`, `send` with structured JSON.
- `scripts/enable-after-quit-and-test.sh` — wait for quit → enable → reopen → test (one-shot operator path).

### D3 — Successful live test (acceptance)

- [ ] `~/.cursor/desktop-bridge/*.json` exists after restart
- [ ] `desktop ls --json` returns at least one thread
- [ ] `desktop send` returns `submitted` or `queued`
- [ ] Assistant message in IDE contains `DESKTOP-BRIDGE-OK`

### D4 — Voice harness (later, blocked on D3)

- Extension loopback HTTP + hooks only if bridge is insufficient (cancel/SSE); prefer bridge for send/list when available.

## Guardrails

- Do not patch `Cursor.app` binaries; storage + official CLI only.
- Do not commit `state.vscdb` backups.
- Headless `cursor-agent` is out of scope for “control this IDE session.”
- No BrowserGPT Realtime until D3 passes.

## Todos

1. **§ Prerequisites** — Run `python3 scripts/enable-desktop-bridge.py`, Cmd+Q Cursor, reopen.
2. **§ D3** — Run `./scripts/test-desktop-bridge.sh`; confirm IDE reply.
3. **§ D4** — Resume `cursor-voice` extension/WebRTC plan only after D3.
