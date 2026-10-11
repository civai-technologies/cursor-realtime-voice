#!/usr/bin/env python3
"""Restore the 3 desktop-bridge keys from a keys-only JSON backup."""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

DEFAULT_DB = Path.home() / "Library/Application Support/Cursor/User/globalStorage/state.vscdb"


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 restore-desktop-bridge-keys.py <bridge-keys-only.*.json>")
    snap_path = Path(sys.argv[1])
    data = json.loads(snap_path.read_text(encoding="utf-8"))
    keys: dict[str, str | None] = data["keys"]
    db = Path(data.get("state_vscdb_path") or DEFAULT_DB)

    con = sqlite3.connect(str(db), timeout=10)
    con.execute("PRAGMA busy_timeout = 10000")
    try:
        con.execute("BEGIN IMMEDIATE")
        for key, value in keys.items():
            if value is None:
                con.execute("DELETE FROM ItemTable WHERE key = ?", (key,))
            else:
                con.execute(
                    "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)",
                    (key, value),
                )
        con.commit()
    finally:
        con.close()
    print(f"Restored {len(keys)} keys from {snap_path}", flush=True)


if __name__ == "__main__":
    main()
