const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  extensionConfigured,
  extensionAvailable,
  extensionReachable,
  extensionGetStatus,
  extensionInstruct,
  extensionFocusThread,
  extensionCancel,
  extensionProbe,
  startExtensionEventRelay,
} = require('./extension-proxy');

const CONFIG_PATH = path.join(process.env.HOME || '', '.cursor', 'cursor-voice-bridge.json');

const state = {
  running: false,
  lastThreadId: null,
  lastThreadTitle: null,
  lastEventAt: null,
  sseClients: new Set(),
  transport: 'extension-composer',
  lastAgentMessage: null,
  lastAgentMessageAt: null,
  lastTurnFinishedAt: null,
  lastInstructAt: null,
};

/** @type {Map<string, { lastAgentMessage: string|null, lastAgentMessageAt: string|null, lastTurnFinishedAt: string|null, lastInstructAt: string|null, running: boolean }>} */
const threadSlots = new Map();

function emptySlot() {
  return {
    lastAgentMessage: null,
    lastAgentMessageAt: null,
    lastTurnFinishedAt: null,
    lastInstructAt: null,
    running: false,
  };
}

function deriveAgentRunning(slot, globalRunning, globalLastInstructAt, globalLastTurnFinishedAt) {
  const raw = Boolean((slot && slot.running) || globalRunning);
  if (!raw) {
    return false;
  }
  const lastInstruct = (slot && slot.lastInstructAt) || globalLastInstructAt;
  if (!lastInstruct) {
    return false;
  }
  const lastDone = (slot && slot.lastTurnFinishedAt) || globalLastTurnFinishedAt;
  if (lastDone && lastInstruct && lastDone >= lastInstruct) {
    return false;
  }
  return true;
}

function slotFor(composerId) {
  let slot = threadSlots.get(composerId);
  if (!slot) {
    slot = emptySlot();
    threadSlots.set(composerId, slot);
  }
  return slot;
}

let bridgeToken = null;
let stopExtensionRelay = null;

function initBridgeToken() {
  if (!bridgeToken) {
    bridgeToken = crypto.randomBytes(32).toString('hex');
  }
  return bridgeToken;
}

function getBridgeToken() {
  return bridgeToken || initBridgeToken();
}

function writeBridgeConfig(host, port) {
  const token = getBridgeToken();
  const cfg = {
    host,
    port,
    token,
    created_at: new Date().toISOString(),
    source: 'cursor-voice-server',
  };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  return cfg;
}

function readBridgeConfigJson() {
  return JSON.stringify({
    host: '127.0.0.1',
    port: null,
    token: getBridgeToken(),
    same_origin: true,
    created_at: new Date().toISOString(),
    source: 'cursor-voice-server',
  });
}

function isLikelyVoiceOrServerEcho(text) {
  const t = String(text || '');
  return (
    /127\.0\.0\.1:8787|cursor-voice-server|Start voice|Open that address in your browser/i.test(t) ||
    /cursor_voice_|voice copilot for Cursor IDE/i.test(t)
  );
}

function recordAssistantText(event, detailText) {
  const trimmed = String(detailText).slice(0, 12000);
  state.lastAgentMessage = trimmed;
  state.lastAgentMessageAt = event.ts;
  if (event.composer_id) {
    const slot = slotFor(event.composer_id);
    slot.lastAgentMessage = trimmed;
    slot.lastAgentMessageAt = event.ts;
  }
}

function recordAgentActivity(event) {
  if (
    event.kind === 'assistant_chunk' &&
    event.detail &&
    !/instruction sent/i.test(event.summary || '') &&
    !isLikelyVoiceOrServerEcho(event.detail)
  ) {
    recordAssistantText(event, event.detail);
  } else if (
    event.kind === 'assistant_chunk' &&
    event.summary &&
    !event.tool_name &&
    !/instruction sent/i.test(event.summary) &&
    !isLikelyVoiceOrServerEcho(event.summary)
  ) {
    recordAssistantText(event, event.summary);
  }
  if (event.composer_id) {
    const slot = slotFor(event.composer_id);
    if (event.kind === 'instruct_sent') {
      slot.running = true;
      slot.lastInstructAt = event.ts;
      state.running = true;
      state.lastInstructAt = event.ts;
    }
    if (event.kind === 'run_done') {
      slot.lastTurnFinishedAt = event.ts;
      slot.running = false;
      state.lastTurnFinishedAt = event.ts;
      state.running = false;
    }
    if (event.kind === 'run_cancelled' || event.kind === 'session_end') {
      slot.running = false;
    }
  }
  if (event.kind === 'instruct_sent') {
    state.running = true;
    state.lastInstructAt = event.ts;
  }
  if (event.kind === 'run_done') {
    state.lastTurnFinishedAt = event.ts;
    state.running = false;
  }
  if (event.kind === 'run_cancelled' || event.kind === 'session_end') {
    state.running = false;
  }
}

function mergeAgentActivity(serverAct, extAct) {
  const pick = (key) => {
    const s = serverAct[key];
    const e = extAct[key];
    if (s == null || s === '') return e ?? s;
    if (e == null || e === '') return s;
    if (key.endsWith('_at')) {
      return String(s) >= String(e) ? s : e;
    }
    return s;
  };
  return {
    last_agent_message_preview: pick('last_agent_message_preview'),
    last_agent_message: pick('last_agent_message'),
    last_agent_message_at: pick('last_agent_message_at'),
    last_turn_finished_at: pick('last_turn_finished_at'),
    agent_running: Boolean(extAct.agent_running ?? serverAct.agent_running),
    last_instruct_at: extAct.last_instruct_at ?? serverAct.last_instruct_at,
  };
}

function activityFromSlot(slot, composerId) {
  const preview = slot.lastAgentMessage
    ? slot.lastAgentMessage.split('\n').find((l) => l.trim())?.slice(0, 280) ||
      slot.lastAgentMessage.slice(0, 280)
    : null;
  const slotRef = composerId ? threadSlots.get(composerId) : slot;
  return {
    last_agent_message_preview: preview,
    last_agent_message: slot.lastAgentMessage ? slot.lastAgentMessage.slice(0, 4000) : null,
    last_agent_message_at: slot.lastAgentMessageAt,
    last_turn_finished_at: slot.lastTurnFinishedAt,
    last_instruct_at: slot.lastInstructAt ?? state.lastInstructAt,
    agent_running: deriveAgentRunning(slotRef, state.running, state.lastInstructAt, state.lastTurnFinishedAt),
  };
}

function agentActivityPayload(composerId) {
  if (composerId && threadSlots.has(composerId)) {
    const slot = threadSlots.get(composerId);
    if (slot && (slot.lastAgentMessage || slot.running || slot.lastTurnFinishedAt)) {
      return activityFromSlot(slot, composerId);
    }
  }
  const preview = state.lastAgentMessage
    ? state.lastAgentMessage.split('\n').find((l) => l.trim())?.slice(0, 280) ||
      state.lastAgentMessage.slice(0, 280)
    : null;
  return {
    last_agent_message_preview: preview,
    last_agent_message: state.lastAgentMessage ? state.lastAgentMessage.slice(0, 4000) : null,
    last_agent_message_at: state.lastAgentMessageAt,
    last_turn_finished_at: state.lastTurnFinishedAt,
    last_instruct_at: state.lastInstructAt,
    agent_running: deriveAgentRunning(undefined, state.running, state.lastInstructAt, state.lastTurnFinishedAt),
  };
}

function pushEvent(event) {
  state.lastEventAt = event.ts;
  if (event.composer_id) state.lastThreadId = event.composer_id;
  recordAgentActivity(event);
  for (const fn of state.sseClients) fn(event);
}

function ensureExtensionRelay() {
  if (stopExtensionRelay) {
    return;
  }
  stopExtensionRelay = startExtensionEventRelay((ev) => {
    if (!ev || !ev.kind) {
      return;
    }
    pushEvent({
      event_id: ev.event_id || crypto.randomUUID(),
      ts: ev.ts || new Date().toISOString(),
      kind: ev.kind,
      summary: ev.summary,
      composer_id: ev.composer_id,
      tool_name: ev.tool_name,
      detail: ev.detail,
    });
  });
}

async function extensionUnreachableResponse() {
  const probe = await extensionProbe();
  return {
    error: 'extension_bridge_unreachable',
    transport: 'extension-composer',
    extension: probe,
    hint:
      'The Cursor Voice extension HTTP server is not running. In Cursor: Cmd+Shift+P → “Cursor Voice: Reload extension”, then “Cursor Voice: Restart Bridge” (you should see a modal with a new port).',
    why:
      probe.configured && !probe.health_ok
        ? `Config file lists port ${probe.port} but nothing is listening (stale after extension host stop/crash). Reload the extension so it writes a fresh port to ~/.cursor/cursor-voice-extension.json.`
        : 'Install or enable the Cursor Voice Bridge extension (./setup.sh), then open Agent in this Cursor window.',
  };
}

async function resolveTransport() {
  ensureExtensionRelay();
  if (!extensionConfigured()) {
    state.transport = 'extension-composer';
    return 'no-extension-config';
  }
  state.transport = 'extension-composer';
  if (await extensionReachable()) {
    return 'extension';
  }
  return 'extension-offline';
}

async function getStatusPayload() {
  const transport = await resolveTransport();
  const probe = await extensionProbe();
  const unreachable = await extensionUnreachableResponse();

  if (transport === 'extension') {
    const ext = await extensionGetStatus();
    if (ext) {
      const focusedId = ext.focused_composer_id ?? ext.composer_id ?? state.lastThreadId;
      const serverAct = agentActivityPayload(focusedId);
      const extAct = ext.agent_activity || {};
      const merged = mergeAgentActivity(serverAct, extAct);
      const focusedRunning = Boolean(merged.agent_running);
      return {
        running: focusedRunning,
        composer_id: focusedId,
        thread_title: ext.thread_title ?? state.lastThreadTitle,
        last_event_at: ext.last_event_at ?? state.lastEventAt,
        threads: ext.threads || [],
        focused_composer_id: ext.focused_composer_id ?? null,
        activity_composer_id: ext.activity_composer_id ?? focusedId,
        transport: 'extension-composer',
        extension_reachable: true,
        extension: probe,
        agent_activity: merged,
      };
    }
  }

  const offlineRunning = deriveAgentRunning(
    state.lastThreadId ? threadSlots.get(state.lastThreadId) : undefined,
    state.running,
    state.lastInstructAt,
    state.lastTurnFinishedAt
  );
  return {
    running: offlineRunning,
    composer_id: state.lastThreadId,
    thread_title: state.lastThreadTitle,
    last_event_at: state.lastEventAt,
    threads: [],
    transport: 'extension-composer',
    extension_reachable: false,
    extension: probe,
    hint: unreachable.hint,
    why: unreachable.why,
    agent_activity: agentActivityPayload(),
  };
}

async function handleIdeBridge(req, res, url, sendJson, readBody) {
  const auth = req.headers.authorization || '';
  const token = getBridgeToken();

  if (req.method === 'GET' && url.pathname === '/v1/health') {
    const ext = await extensionAvailable();
    sendJson(res, 200, {
      ok: true,
      source: 'cursor-voice-server',
      extension_composer: ext,
      transport: 'extension-composer',
      extension: await extensionProbe(),
    });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/v1/events/stream') {
    if (auth !== `Bearer ${token}`) {
      sendJson(res, 401, { error: 'unauthorized' });
      return true;
    }
    ensureExtensionRelay();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    state.sseClients.add(send);
    req.on('close', () => state.sseClients.delete(send));
    return true;
  }

  if (!url.pathname.startsWith('/v1/')) {
    return false;
  }

  if (auth !== `Bearer ${token}`) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/v1/status') {
      sendJson(res, 200, await getStatusPayload());
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/v1/events') {
      const body = JSON.parse((await readBody(req)) || '{}');
      pushEvent({
        event_id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        kind: body.kind,
        summary: body.summary,
        composer_id: body.composer_id,
        tool_name: body.tool_name,
        detail: body.detail,
        voice_relevant: body.voice_relevant,
      });
      sendJson(res, 202, { accepted: true });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/v1/focus') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const threadId = String(body.thread_id || '').trim();
      const titleContains = String(body.title_contains || '').trim();
      if (!threadId && !titleContains) {
        sendJson(res, 400, { error: 'thread_id or title_contains required' });
        return true;
      }
      const transport = await resolveTransport();
      if (transport !== 'extension') {
        sendJson(res, 503, await extensionUnreachableResponse());
        return true;
      }
      const result = await extensionFocusThread({ thread_id: threadId || undefined, title_contains: titleContains || undefined });
      if (!result || result.status < 200 || result.status >= 300) {
        sendJson(res, result?.status || 503, result?.body || { error: 'focus failed' });
        return true;
      }
      sendJson(res, 200, result.body);
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/v1/cancel') {
      const transport = await resolveTransport();
      if (transport !== 'extension') {
        sendJson(res, 503, await extensionUnreachableResponse());
        return true;
      }
      const result = await extensionCancel();
      if (result && result.status === 200) {
        state.running = false;
        sendJson(res, 200, { ...result.body, transport: 'extension-composer' });
        return true;
      }
      sendJson(res, 503, {
        ...(await extensionUnreachableResponse()),
        detail: result?.body || 'extension cancel failed',
      });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/v1/instruct') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const text = String(body.text || '').trim();
      if (!text) {
        sendJson(res, 400, { error: 'text required' });
        return true;
      }

      let transport = await resolveTransport();
      if (transport === 'extension-offline') {
        await new Promise((r) => setTimeout(r, 800));
        transport = await resolveTransport();
      }
      if (transport !== 'extension') {
        sendJson(res, 503, await extensionUnreachableResponse());
        return true;
      }

      const result = await extensionInstruct({
        text,
        thread_id: body.thread_id,
        policy: body.policy,
      });
      if (!result) {
        sendJson(res, 503, await extensionUnreachableResponse());
        return true;
      }
      if (result.status >= 200 && result.status < 300) {
        if (result.body.thread_id) {
          state.lastThreadId = result.body.thread_id;
        }
        state.running = true;
        pushEvent({
          event_id: crypto.randomUUID(),
          ts: new Date().toISOString(),
          kind: 'instruct_sent',
          composer_id: result.body.thread_id || state.lastThreadId,
          summary: `Instruction sent (${result.body.method || 'extension'})`,
        });
      }
      sendJson(res, result.status, result.body);
      return true;
    }

    sendJson(res, 404, { error: 'not_found' });
    return true;
  } catch (e) {
    sendJson(res, 500, { error: e.message || 'error' });
    return true;
  }
}

module.exports = {
  initBridgeToken,
  writeBridgeConfig,
  readBridgeConfigJson,
  handleIdeBridge,
};
