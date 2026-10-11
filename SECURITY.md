# Security policy

## Scope

Cursor Voice is a **local developer tool**. It binds to `127.0.0.1` by default and is not intended to be exposed on a network.

## Reporting a vulnerability

Email **hello@civai.co** with:

- Description and impact
- Steps to reproduce
- Your environment (OS, Cursor version, cursor-voice version)

We will acknowledge within a few business days.

## Safe defaults

- Keep `CURSOR_VOICE_HOST=127.0.0.1`.
- Do not commit `.env` or paste API keys into issues.
- Protect `~/.cursor/cursor-voice-bridge.json` and `~/.cursor/cursor-voice-extension.json` (Bearer tokens).

## Out of scope

- Compromise of your OpenAI account or API key outside this repo
- Cursor IDE or OpenAI platform bugs (report to those vendors)
