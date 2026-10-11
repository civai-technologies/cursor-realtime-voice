# Public release report — Cursor Voice

**Date:** 2026-10-11  
**Version:** 0.1.0  
**License:** MIT (CIVAI Technologies)  
**Target repo:** https://github.com/civai-technologies/cursor-realtime-voice

## Summary

Cursor Voice is ready for public GitHub release as a self-hosted voice front-end for Cursor Agent. One-command `setup.sh` installs the extension, hooks, and local server. No CivAI cloud dependency.

## Readiness checklist

| Area | Status | Notes |
|------|--------|--------|
| License | Done | `LICENSE` (MIT) |
| README | Done | Quick start, architecture, security, troubleshooting |
| Secrets | Done | `.env` gitignored; key via UI or `.env` only |
| Install path | Done | `./setup.sh` → VSIX + hooks + server |
| Extension path | Done | Primary instruct path; no desktop CLI when extension config exists |
| Hooks | Done | `./scripts/install-hooks.sh` |
| Loopback security | Done | Extension + server reject non-loopback |
| OpenAI | Done | Ephemeral Realtime tokens; key on server only |
| Diagnostics | Done | `GET /api/diagnostics` |
| Restart ops | Done | `./scripts/restart-voice-server.sh` |
| Bridge reliability | Done | Instruct HTTP timeout 45s, retries, auto `/v1/restart` on stale bridge |

## Deploy steps for a new user

1. Clone repo, run `./setup.sh`.
2. Open http://127.0.0.1:8787, save OpenAI key, start voice.
3. **⌘⇧P** → **Cursor Voice: Restart Bridge** if needed.
4. Open Agent chat in Cursor; speak instructions.

## Known limitations

- Cross-platform `setup.sh` (macOS/Linux/Git Bash) and `setup.ps1` (Windows PowerShell); shared `scripts/lib/platform.sh`.
- Extension update path documented in `docs/EXTENSION_UPDATE_AND_DEPLOY.md` (`sync-extension-to-cursor.sh`, Reload extension, Restart Bridge, maintainer version bump).
- Voice sees agent output via hooks, not full Composer scrollback.
- Browser MCP tool noise filtered from hook stream.
- Requires OpenAI Realtime-capable API access.

## Post-publish

- [x] Public repo: https://github.com/civai-technologies/cursor-realtime-voice (`main` @ initial release commit)
- [ ] Tag `v0.1.0` (optional)
- [ ] Enable GitHub Discussions or Issues template (optional)
- [ ] Announce with demo GIF (optional)
