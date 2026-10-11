# Cursor Voice

Talk to your **Cursor IDE Agent** with your voice. [OpenAI Realtime](https://platform.openai.com/docs/guides/realtime) handles speech in the browser; a small **Cursor extension** sends instructions into Composer; optional **hooks** stream agent replies back into voice.

Everything runs on **your machine** (loopback `127.0.0.1` only). Your OpenAI API key stays in local `.env` or the web UI—never sent to CivAI or any third party except OpenAI.

**License:** [MIT](LICENSE) · **Copyright:** CIVAI Technologies

---

## Quick start

**Requirements:** macOS (tested) or Linux, [Node.js](https://nodejs.org/) 18+, [Cursor](https://cursor.com/) with an Agent (Composer) chat open, OpenAI API key with Realtime access.

```bash
git clone https://github.com/civai-technologies/cursor-voice.git
cd cursor-voice
chmod +x setup.sh
./setup.sh
```

Then in the browser (opened automatically at **http://127.0.0.1:8787**):

1. Paste your **OpenAI API key** → **Save key**
2. **Start voice**
3. Say e.g. “Tell the agent to run the tests and summarize the result.”

**First-time Cursor setup:** press **⌘⇧P** (Command Palette) → run **Cursor Voice: Restart Bridge** if diagnostics say the extension is not ready. You do **not** need the optional `cursor desktop` CLI.

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
│  [ Start voice ]  [ Stop agent run ]  [ End voice ]          │
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
                    · Composer commands (no screen automation)
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

## Install without `setup.sh`

```bash
npm install
npm start
# → http://127.0.0.1:8787

./scripts/install-hooks.sh          # agent replies + completion
./scripts/install-extension-dev.sh  # or install VSIX from setup.sh
```

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
| Voice says “reload Cursor” | **⌘⇧P** → **Cursor Voice: Restart Bridge** (not a menu item). |
| `success:false` on submit + desktop CLI in the error | Install/reinstall extension via `./setup.sh`; extension path must be used when `cursor-voice-extension.json` exists. |
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
- **Cursor Voice: Test Send to Agent**

---

## Legacy: `cursor desktop` CLI

Optional fallback when the extension is **not** installed. Requires Cursor’s desktop bridge experiment. Most users should use the extension only.

---

## Contributing & release

See [docs/PUBLIC_RELEASE_REPORT.md](docs/PUBLIC_RELEASE_REPORT.md) for the open-source readiness checklist.

Issues and PRs welcome on GitHub.
