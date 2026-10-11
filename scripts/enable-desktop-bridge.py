#!/usr/bin/env python3
"""Enable Cursor desktop bridge (CLI `cursor desktop ls|send`) on this Mac.

Does NOT copy the full state.vscdb (often tens of GB). Backs up only the 3 keys
we change to a small JSON file under ~/Documents/cursor-desktop-bridge-backups/.
"""

from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

STATSIG_GATE_HASH = "3243374860"  # Statsig gate for feature id "desktop_bridge"
GATE_KEY = "cursor.desktopBridge.enabled"
USER_KEY = "cursor/desktopBridgeUserEnabled"
BOOTSTRAP_KEY = "workbench.experiments.statsigBootstrap"
KEYS_WE_TOUCH = (BOOTSTRAP_KEY, GATE_KEY, USER_KEY)

DEFAULT_DB = Path.home() / "Library/Application Support/Cursor/User/globalStorage/state.vscdb"
BACKUP_DIR = Path.home() / "Documents" / "cursor-desktop-bridge-backups"


def log(msg: str) -> None:
    print(msg, flush=True)


def statsig_desktop_bridge_enabled(con: sqlite3.Connection) -> bool | None:
    """Whether Cursor's remote experiment has desktop_bridge on (not the same as DB mirror keys)."""
    row = con.execute(
        "SELECT value FROM ItemTable WHERE key = ?", (BOOTSTRAP_KEY,)
    ).fetchone()
    if not row or not row[0]:
        return None
    try:
        bootstrap = json.loads(row[0])
        entry = bootstrap.get("feature_gates", {}).get(STATSIG_GATE_HASH)
        if isinstance(entry, dict) and "value" in entry:
            return bool(entry["value"])
    except json.JSONDecodeError:
        return None
    return None


def diagnose_bridge_blocker(db_path: Path) -> None:
    """Explain empty `desktop ls` when Composer is open (common: Statsig gate off)."""
    if not db_path.is_file():
        raise SystemExit(f"Cursor state DB not found: {db_path}")
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2)
    try:
        keys = read_keys(con)
        gate = statsig_desktop_bridge_enabled(con)
    finally:
        con.close()
    log("== Desktop bridge diagnosis ==")
    log(f"  {GATE_KEY} (local mirror)     = {keys.get(GATE_KEY)!r}")
    log(f"  {USER_KEY} (your opt-in)      = {keys.get(USER_KEY)!r}")
    log(f"  Statsig desktop_bridge gate   = {gate!r}")
    if gate is False:
        log("")
        log("Composer can be open and `cursor desktop ls` will still show []:")
        log("Cursor only exposes Agent threads to the CLI when the remote")
        log('"desktop_bridge" experiment is ON for your account.')
        log("Editing state.vscdb cannot flip that while the app is running;")
        log("Cursor refreshes the gate from the server.")
        log("")
        log("Next steps: ask Cursor support / beta channel for desktop_bridge access,")
        log("or use the cursor-voice VS Code extension path (no desktop CLI) when we ship it.")
        raise SystemExit(2)
    if keys.get(GATE_KEY) != "true":
        log("")
        log("Local bridge mirror is off — try: python3 scripts/enable-desktop-bridge.py --runtime")
        raise SystemExit(1)
    log("Gate looks enabled; if ls is still [], focus Agent chat or try a new Agent tab.")


def state_db_unlocked(db_path: Path) -> bool:
    if not db_path.is_file():
        return False
    try:
        con = sqlite3.connect(str(db_path), timeout=0.5)
        con.execute("PRAGMA busy_timeout = 500")
        con.execute("BEGIN IMMEDIATE")
        con.rollback()
        con.close()
        return True
    except sqlite3.Error:
        return False


def cursor_app_running_macos() -> bool:
    try:
        r = subprocess.run(
            ["osascript", "-e", 'application "Cursor" is running'],
            capture_output=True,
            text=True,
            check=False,
        )
        return r.stdout.strip().lower() == "true"
    except FileNotFoundError:
        return False


def load_bootstrap(raw: str) -> dict:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise SystemExit(f"Bootstrap JSON is invalid — aborting: {e}") from e
    if not isinstance(data, dict):
        raise SystemExit("Bootstrap is not a JSON object — aborting.")
    if "feature_gates" not in data or not isinstance(data["feature_gates"], dict):
        raise SystemExit("Bootstrap missing feature_gates dict — aborting.")
    return data


def patch_bootstrap(bootstrap: dict) -> dict:
    gates = bootstrap["feature_gates"]
    entry = gates.get(STATSIG_GATE_HASH)
    if not entry:
        gates[STATSIG_GATE_HASH] = {
            "name": STATSIG_GATE_HASH,
            "rule_id": "local-enable",
            "secondary_exposures": [],
            "id_type": "userID",
            "value": True,
        }
    else:
        if not isinstance(entry, dict):
            raise SystemExit(f"Gate {STATSIG_GATE_HASH} entry is not an object — aborting.")
        entry["value"] = True
    bootstrap["feature_gates"] = gates
    json.dumps(bootstrap, separators=(",", ":"))
    return bootstrap


def read_keys(con: sqlite3.Connection) -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    for key in KEYS_WE_TOUCH:
        row = con.execute(
            "SELECT value FROM ItemTable WHERE key = ?", (key,)
        ).fetchone()
        out[key] = row[0] if row else None
    if out[BOOTSTRAP_KEY] is None:
        raise SystemExit(f"Missing {BOOTSTRAP_KEY} — open Cursor once before enabling.")
    return out


def backup_keys_only(db_path: Path, snapshot: dict[str, str | None]) -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = BACKUP_DIR / f"bridge-keys-only.{stamp}.json"
    size_gb = db_path.stat().st_size / (1024**3)
    payload = {
        "created_at_utc": stamp,
        "state_vscdb_path": str(db_path),
        "state_vscdb_size_bytes": db_path.stat().st_size,
        "note": "Restore with: python3 scripts/restore-desktop-bridge-keys.py <this-file>",
        "keys": snapshot,
    }
    dest.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    log(f"[backup] Keys-only snapshot ({dest.stat().st_size / 1024:.1f} KB): {dest}")
    log(f"[backup] Full DB on disk is ~{size_gb:.1f} GB — we do NOT copy that file.")
    return dest


def verify_only(db_path: Path) -> None:
    if not db_path.is_file():
        raise SystemExit(f"Cursor state DB not found: {db_path}")
    size_gb = db_path.stat().st_size / (1024**3)
    log(f"state.vscdb size on disk: ~{size_gb:.1f} GB")
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2)
    try:
        keys = read_keys(con)
        bootstrap = load_bootstrap(keys[BOOTSTRAP_KEY] or "")
        patch_bootstrap(json.loads(json.dumps(bootstrap)))
        log("verify: OK — bootstrap parses; gate entry can be patched safely.")
        log(f"  current {GATE_KEY} = {keys[GATE_KEY]!r}")
        log(f"  current {USER_KEY} = {keys[USER_KEY]!r}")
        gate_entry = bootstrap["feature_gates"].get(STATSIG_GATE_HASH)
        log(
            f"  current statsig gate {STATSIG_GATE_HASH} value = "
            f"{gate_entry.get('value') if isinstance(gate_entry, dict) else 'missing'!r}"
        )
        if cursor_app_running_macos():
            log("  note: Cursor app is running — quit before enable.")
        elif not state_db_unlocked(db_path):
            log("  note: state.vscdb is locked — quit Cursor.")
        else:
            log("  note: safe to enable (keys-only backup, no full DB copy).")
    finally:
        con.close()


def apply_bridge_keys(con: sqlite3.Connection) -> None:
    """Patch statsig gate + desktop bridge flags in an open DB connection."""
    before = read_keys(con)
    bootstrap = patch_bootstrap(load_bootstrap(before[BOOTSTRAP_KEY] or ""))
    new_bootstrap = json.dumps(bootstrap, separators=(",", ":"))
    load_bootstrap(new_bootstrap)
    con.execute("BEGIN IMMEDIATE")
    con.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)",
        (BOOTSTRAP_KEY, new_bootstrap),
    )
    con.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)",
        (GATE_KEY, "true"),
    )
    con.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)",
        (USER_KEY, "true"),
    )
    con.commit()
    after = read_keys(con)
    if after[GATE_KEY] != "true" or after[USER_KEY] != "true":
        raise SystemExit("Post-write verification failed.")


def apply_runtime(db_path: Path) -> None:
    """Re-apply bridge keys while Cursor is running (Statsig resets gate on launch)."""
    log("[runtime] Re-applying bridge keys in state.vscdb…")
    if not db_path.is_file():
        raise SystemExit(f"Cursor state DB not found: {db_path}")
    con = sqlite3.connect(str(db_path), timeout=5)
    con.execute("PRAGMA busy_timeout = 5000")
    try:
        apply_bridge_keys(con)
    except sqlite3.OperationalError as e:
        raise SystemExit(f"state.vscdb busy — retry in a few seconds: {e}") from e
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()
    log("[runtime] Done — cursor.desktopBridge.enabled should be true until next Statsig refresh.")


def enable(db_path: Path) -> None:
    log("[enable] Preflight…")
    if sys.platform == "darwin" and cursor_app_running_macos():
        raise SystemExit(
            "Cursor is still running. Cmd+Q the app, then run again.\n"
            "Check: ./scripts/cursor-quit-ready.sh --check"
        )
    if not state_db_unlocked(db_path):
        raise SystemExit(
            "state.vscdb is locked. Quit Cursor (Cmd+Q), then:\n"
            "  ./scripts/cursor-quit-ready.sh --check"
        )
    if not db_path.is_file():
        raise SystemExit(f"Cursor state DB not found: {db_path}")

    con = sqlite3.connect(str(db_path), timeout=10)
    con.execute("PRAGMA busy_timeout = 10000")
    try:
        before = read_keys(con)
        bak = backup_keys_only(db_path, before)

        log("[enable] Writing 3 keys (bootstrap gate + bridge flags)…")
        apply_bridge_keys(con)
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()

    log("[enable] Done — desktop_bridge gate + user flags set.")
    log("Undo (only these 3 keys):")
    log(f"  python3 scripts/restore-desktop-bridge-keys.py \"{bak}\"")


def main() -> None:
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    verify = "--verify" in flags
    runtime = "--runtime" in flags
    diagnose = "--diagnose" in flags
    db = Path(args[0]) if args else DEFAULT_DB
    if diagnose:
        diagnose_bridge_blocker(db)
        return
    if verify:
        verify_only(db)
        return
    if runtime:
        apply_runtime(db)
        return
    enable(db)
    log("Next: open Cursor, then ./scripts/test-desktop-bridge.sh")


if __name__ == "__main__":
    main()
