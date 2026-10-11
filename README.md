# Cursor Voice

**Cursor Voice** by [CIVAI Technologies](https://civai.co) lets you talk to your **Cursor IDE Agent** instead of typing every instruction. [OpenAI Realtime](https://platform.openai.com/docs/guides/realtime) handles speech in the browser; a small **Cursor extension** sends instructions into Composer; optional **hooks** stream agent replies back into voice.

Everything runs on **your machine** (loopback `127.0.0.1` only). Your OpenAI API key stays in local `.env` or the web UI. It is not sent to CIVAI or any third party except OpenAI.

**License:** [MIT](LICENSE) · **Website:** [civai.co](https://civai.co)

---

## Quick start

**Requirements:** [Node.js](https://nodejs.org/) 18+, [Cursor](https://cursor.com/) with an Agent (Composer) chat open, OpenAI API key with Realtime access. Works on **macOS**, **Linux**, and **Windows** (see platform notes below).

### Install (detects your OS)

| Platform | Command |
|----------|---------|
| **macOS / Linux / Git Bash on Windows** | `chmod +x setup.sh && ./setup.sh` |
| **Windows (PowerShell)** | `.\setup.ps1` |

`setup.sh` detects Darwin, Linux, or Windows (MSYS/Git Bash), finds the Cursor CLI when possible, installs the VSIX or prints manual steps, installs hooks with `python3` or `python`, frees the voice port the right way for your OS, and opens the browser.

### macOS: allow Cursor to send Agent messages

On most accounts Cursor’s in-IDE **desktop bridge** experiment is off, so the extension sends your prompt with **paste + Return** into the Agent box you already have focused. macOS must allow that:

1. Open **System Settings** → **Privacy & Security** → **Accessibility**
2. Turn **ON** for **Cursor** (unlock with your password if prompted)
3. **Quit and reopen Cursor** if the toggle was off before (macOS sometimes needs a restart)
4. In Cursor: **Cmd+Shift+P** (macOS) or **Ctrl+Shift+P** (Linux/Windows) → **Developer: Reload Window**

Before voice or **Test Send**, click the **Agent chat you want** and focus the **message box** at the bottom. Voice does not switch Agent tabs for you.

If submit fails with **error 1002** or “blocked simulated keys”, repeat the steps above or use **⌘⇧P** → **Cursor Voice: Send test line to Agent chat** → **Open Accessibility Settings**.

```bash
git clone https://github.com/civai-technologies/cursor-realtime-voice.git
cd cursor-realtime-voice
chmod +x setup.sh
./setup.sh
```

Then in the browser (opened automatically at **http://127.0.0.1:8787**):

1. Paste your **OpenAI API key** → **Save key**
2. **Start voice**
3. Say e.g. “Tell the agent to run the tests and summarize the result.”

### Linux and Windows

- **Agent send** uses Cursor's in-IDE `composer.desktopBridge.sendMessage` when enabled. If it is off, macOS falls back to Accessibility paste+Return; on Linux/Windows use `scripts/enable-desktop-bridge.py` (with Cursor quit) or install the extension from the VSIX `setup` produces.
- **Hooks** need Python 3 on your `PATH` (`python3` or `python`).
- **Extension folder copy:** `./scripts/sync-extension-to-cursor.sh` works on all platforms and picks `~/.cursor/extensions` (or `%USERPROFILE%\.cursor\extensions` on Windows).

**First-time Cursor setup:** Command Palette (**Cmd+Shift+P** / **Ctrl+Shift+P**) → **Cursor Voice: Restart Bridge** if diagnostics say the extension is not ready.

---

## What you see

```text
┌──────────────────────────────────────────────────────────────┐
│  Cursor Voice                                                │
├──────────────────────────────────────────────────────────────┤
│  user: What's the last agent message?                        │
│  cursor_voice_get_status  call  {"spoken_summary":"…"}       │
│  cursor_voice_get_status  result → running=false preview=…   │
│  assistant: The agent said …                                 │
│  cursor_voice_submit_instruction  call  text: …              │
│  system: Instruction sent to Agent (workbench.action…)       │
│  agent: (hook) Latest agent reply preview                    │
│  system: Agent finished its turn                             │
├──────────────────────────────────────────────────────────────┤
│  ( round voice button )  [ Copy transcript ]                 │
│  Live transcript · Settings in header                        │
└──────────────────────────────────────────────────────────────┘
```

---

## Architecture

```text
  Mic + speakers          Browser (WebRTC)          OpenAI Realtime API
       │                        │                            │
       └────────────────────────┴────────────────────────────┘
                                │
                    cursor-voice server :8787
                    · ephemeral Realtime token
                    · /v1/instruct · /v1/status · /v1/events
                                │
                    HTTP 127.0.0.1 (Bearer token)
                                │
                    Cursor Voice Bridge (VS Code extension)
                    · In-IDE send when enabled; else macOS Accessibility (paste+Return)
                                │
                    Cursor Agent (Composer)

  Optional hooks (~/.cursor/hooks.json) → afterAgentResponse, stop
```

| Component | Role |
|-----------|------|
| **Web UI** | WebRTC client, live captions, tool call/result lines |
| **Server** | Static UI, OpenAI `client_secrets`, IDE bridge proxy |
| **Extension** | `POST /v1/instruct` → focus Composer + submit prompt |
| **Hooks** | Agent text + turn finished → voice server SSE |

Config files (local only):

| File | Written by |
|------|------------|
| `~/.cursor/cursor-voice-bridge.json` | Voice server (`:8787` + token) |
| `~/.cursor/cursor-voice-extension.json` | Extension (random port + token) |

---

## Updating the extension (after `git pull`)

The voice page talks to a **Cursor extension** on your machine. Code updates do not apply until you reinstall that extension and reload Cursor.

**Recommended (all platforms):**

```bash
git pull
./scripts/sync-extension-to-cursor.sh
```

Then in Cursor (**Cmd+Shift+P** / **Ctrl+Shift+P**):

1. **Cursor Voice: Reload extension**
2. **Cursor Voice: Restart Bridge**
3. Optional: **Cursor Voice: Send test line to Agent chat**

Hard-refresh `http://127.0.0.1:8787`. If you changed server or web code too, run `npm run start --prefix server` (or `./scripts/restart-voice-server.sh`).

Full detail (VSIX, hooks, releases): **[docs/EXTENSION_UPDATE_AND_DEPLOY.md](docs/EXTENSION_UPDATE_AND_DEPLOY.md)**.

---

## Install without `setup.sh`

```bash
npm install
npm start
# → http://127.0.0.1:8787

./scripts/install-hooks.sh          # agent replies + completion
./scripts/install-extension-dev.sh  # print manual install steps
./scripts/sync-extension-to-cursor.sh  # build + copy to ~/.cursor/extensions (recommended)
```

After installing or pulling extension changes: **Reload extension** → **Restart Bridge** (see doc above).

Restart server only:

```bash
./scripts/restart-voice-server.sh
```

---

## Environment

Copy [`.env.example`](.env.example) to `.env` or set the key in the web UI.

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENAI_API_KEY` | — | Required for Realtime |
| `OPENAI_REALTIME_VOICE_MODEL` | `gpt-realtime-mini` | Realtime model |
| `OPENAI_REALTIME_VOICE` | `alloy` | TTS voice |
| `CURSOR_VOICE_TOKEN_PORT` | `8787` | Bind port |
| `CURSOR_VOICE_HOST` | `127.0.0.1` | Bind host (keep loopback) |

---

## Security

- Bridge and extension accept **loopback** connections only.
- Random Bearer tokens in config files; treat `~/.cursor/cursor-voice-*.json` like secrets on shared machines.
- Do not expose `:8787` to the network. See [SECURITY.md](SECURITY.md).

---

## Troubleshooting

| Symptom | What to do |
|---------|------------|
| `extension_bridge_unreachable` but Composer still gets the prompt | Extension was slow; update to latest (longer HTTP timeout). Run **⌘⇧P** → **Cursor Voice: Restart Bridge**. If captions show `Instruction sent`, the send worked—ignore a stale tool error. |
| Test submit opens a bar at the **top** (“test prompt from workbench.action.chat.open”) | Extension used a bad focus fallback—update to latest, **⌘⇧P** → **Cursor Voice: Reload extension**, then **Test Send to Agent**. Text must land in the **Agent** box on the right, not the top bar. |
| Test Send succeeds but **no user bubble** in Agent | Focus the Agent input first; reload extension (`./scripts/sync-extension-to-cursor.sh` then **Reload Window**). Success = new **user** message in the thread, not only text in the input box. |
| **macOS blocked simulated keys** (1002) | **System Settings** → **Privacy & Security** → **Accessibility** → enable **Cursor**, reload Cursor, retry. |
| Modal shows `macos-accessibility-paste+Return` | Expected when desktop bridge is off; Accessibility for Cursor must be on (see macOS section above). |
| Modal shows `composer.desktopBridge.sendMessage` | Cursor’s bridge experiment is on for your account; no Accessibility needed for send. |
| `get_status` preview is your instruction text | That was a bug (instruction mistaken for agent reply)—update extension + hooks. Preview should be **agent** output from hooks. |
| Voice says “reload Cursor” | **⌘⇧P** → **Cursor Voice: Restart Bridge** (not a menu item). |
| `extension_bridge_unreachable` on submit | Extension HTTP is down or config port is stale — **⌘⇧P** → **Reload extension**, then **Restart Bridge**. Reinstall with `./setup.sh` if needed. |
| No agent completion speech | Run `./scripts/install-hooks.sh`, keep Agent chat in the same Cursor window. |
| Server won’t start | `kill $(cat .cursor-voice-server.pid)` or `./scripts/restart-voice-server.sh`; read `.cursor-voice-server.log`. |

---

## Development

```bash
npm run build          # extension + web
npm run test:realtime  # token shape test (needs OPENAI_API_KEY)
```

Extension commands (**⌘⇧P**):

- **Cursor Voice: Restart Bridge**
- **Cursor Voice: Reload extension** (after pulling extension code)
- **Cursor Voice: Send test line to Agent chat**

---

## Contributing & release

- **Extension update / deploy (users and maintainers):** [docs/EXTENSION_UPDATE_AND_DEPLOY.md](docs/EXTENSION_UPDATE_AND_DEPLOY.md)
- **Open-source readiness checklist:** [docs/PUBLIC_RELEASE_REPORT.md](docs/PUBLIC_RELEASE_REPORT.md)

Issues and PRs welcome on GitHub.

---

## Developer

Maintained by **Kayode Femi Amoo** ([@usecodenaija on X](https://x.com/usecodenaija)) for CIVAI Technologies.
