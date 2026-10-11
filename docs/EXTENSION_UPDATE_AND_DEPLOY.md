# Cursor Voice Bridge — update and deploy

This guide covers **installing**, **updating** the extension after you pull new code, and **releasing** changes for maintainers. Everything runs on your machine; there is no cloud extension store for this project yet.

---

## What gets updated when

| Piece | What it does | When you must refresh it |
|-------|----------------|---------------------------|
| **Extension** (`extension/`) | HTTP bridge inside Cursor; sends voice instructions to Agent | After any change under `extension/` or when the voice page says the bridge is stale |
| **Voice server + web UI** (`server/`, `web/`) | Page at `http://127.0.0.1:8787`, OpenAI token, diagnostics | After `git pull` that touches server/web; `npm start` rebuilds the web UI automatically |
| **Hooks** (`hooks/`, `scripts/install-hooks.sh`) | Agent replies and “turn finished” events to voice | After hook script changes; re-run `./scripts/install-hooks.sh` |

Updating **only** the extension does not require reinstalling hooks. Updating **only** the web UI does not require resyncing the extension if you did not change extension code.

---

## First install (extension)

Pick one path:

### A. Full setup (recommended)

```bash
git clone https://github.com/civai-technologies/cursor-realtime-voice.git
cd cursor-realtime-voice
chmod +x setup.sh && ./setup.sh
```

On Windows PowerShell: `.\setup.ps1`

Setup installs npm deps, builds the extension, installs the VSIX when the Cursor CLI is available, installs hooks, and starts the voice server.

### B. Extension folder copy (most reliable on macOS)

Cursor sometimes ignores VSIX installs from the CLI. Use the sync script:

```bash
./scripts/sync-extension-to-cursor.sh
```

This compiles TypeScript, copies the extension to:

`~/.cursor/extensions/civai.cursor-voice-bridge-<version>/`

(and removes older `civai.cursor-voice-bridge-*` folders).

Then in Cursor: **Command Palette** → **Developer: Reload Window**.

### C. Install from location (dev)

```bash
./scripts/install-extension-dev.sh
```

Follow the printed steps: **Extensions** → **…** → **Install from Location…** → choose the repo’s `extension/` folder.

---

## After `git pull` — update the extension

Use this whenever you pulled changes that include `extension/` (or you were told to update the bridge).

1. **From the repo root:**

   ```bash
   ./scripts/sync-extension-to-cursor.sh
   ```

   Or, if you prefer VSIX:

   ```bash
   npm run compile --prefix extension
   cd extension && npx @vscode/vsce package --allow-missing-repository -o /tmp/cursor-voice-bridge.vsix
   cursor --install-extension /tmp/cursor-voice-bridge.vsix
   ```

2. **In Cursor (order matters):**

   - **Cursor Voice: Reload extension** — loads new `out/` code in the extension host  
   - **Developer: Reload Window** — if behavior still looks old (full window reload)  
   - **Cursor Voice: Restart Bridge** — writes a fresh port to `~/.cursor/cursor-voice-extension.json`  
   - **Cursor Voice: Send test line to Agent chat** — confirm a new user bubble appears in Agent

3. **Refresh the voice page** in the browser (hard refresh). Status should show **Ready (extension)** with a thread count.

4. **Voice server** (only if server code or web UI changed):

   ```bash
   npm run start --prefix server
   ```

   Or `./scripts/restart-voice-server.sh`.  
   Skip this if you only updated the extension and the page at `:8787` already loads.

### Stale bridge message

If the page says the bridge is offline but a config file exists (`~/.cursor/cursor-voice-extension.json`), Cursor still has an old port on disk. Run **Reload extension** then **Restart Bridge** in Cursor; do not delete the config file by hand unless support asks you to.

---

## Verify the version Cursor is running

- Command Palette → **Cursor Voice: Send test line to Agent chat** — error/success modals include **extension vX.Y.Z** from `extension/package.json`.
- Or check the folder name under `~/.cursor/extensions/`: `civai.cursor-voice-bridge-0.1.15` (version matches `package.json`).

---

## Update hooks only

```bash
./scripts/install-hooks.sh
```

Then **Developer: Reload Window** in Cursor so hook processes pick up paths.

---

## Maintainer: ship a release

There is no automated extension marketplace publish in this repo. Release flow:

1. **Bump version** in `extension/package.json` (semver patch for fixes, minor for features).
2. **Build and smoke-test locally:**

   ```bash
   ./scripts/sync-extension-to-cursor.sh
   npm start
   ```

   Test instruct, cancel, diagnostics, and voice session on `http://127.0.0.1:8787`.

3. **Commit and push** to `main` on GitHub (`civai-technologies/cursor-realtime-voice`).
4. **Optional GitHub release:** tag `v0.1.16`, attach the VSIX built with `vsce package` for users who install from a release asset.
5. **Tell users** to `git pull`, run `./scripts/sync-extension-to-cursor.sh`, then **Reload Window** + **Restart Bridge**.

### Version and folder name

The sync script installs to `civai.cursor-voice-bridge-${version}`. Bumping `package.json` version avoids Cursor loading a mix of old and new folders.

### What not to do

- Do not copy only `extension/out` by hand without updating `package.json` in the destination folder.
- Do not rely on VSIX CLI alone on macOS without verifying the extension appears under **Extensions**; use **sync** if in doubt.
- Do not expose the voice server port on the LAN; keep `127.0.0.1`.

---

## Quick reference (Command Palette)

| Command | Use when |
|---------|----------|
| **Cursor Voice: Reload extension** | After sync or VSIX install; extension code changed |
| **Cursor Voice: Restart Bridge** | Stale port, “not ready”, or first session of the day |
| **Cursor Voice: Send test line to Agent chat** | Confirm submit path works |
| **Developer: Reload Window** | Extension still behaves like old build after Reload extension |

**Mac:** Cmd+Shift+P · **Windows/Linux:** Ctrl+Shift+P
