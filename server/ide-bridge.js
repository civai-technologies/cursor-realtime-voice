const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { listDesktopThreads, sendDesktopMessage } = require('./desktop-cli');
const {
  extensionConfigured,
  extensionAvailable,
  extensionReachable,
  extensionGetStatus,
  extensionInstruct,
  extensionRestartBridge,
  extensionCancel,
  startExtensionEventRelay,
} = require('./extension-proxy');

const CONFIG_PATH = path.join(process.env.HOME || '', '.cursor', 'cursor-voice-bridge.json');

const state = {
  running: false,
  lastThreadId: null,
  lastThreadTitle: null,
  lastEventAt: null,
  sseClients: new Set(),
  transport: 'unknown',
  lastAgentMessage: null,
  lastAgentMessageAt: null,
  lastTurnFinishedAt: null,
};

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

function recordAgentActivity(event) {
  if (event.kind === 'assistant_chunk' && event.detail) {
    state.lastAgentMessage = String(event.detail).slice(0, 12000);
    state.lastAgentMessageAt = event.ts;
  } else if (event.kind === 'assistant_chunk' && event.summary && !event.tool_name) {
    state.lastAgentMessage = String(event.summary).slice(0, 12000);
    state.lastAgentMessageAt = event.ts;
  }
  if (event.kind === 'run_done') {
    state.lastTurnFinishedAt = event.ts;
    state.running = false;
  }
  if (event.kind === 'session_start' || event.kind === 'tool_end') {
    state.running = true;
  }
  if (event.kind === 'run_cancelled') {
    state.running = false;
  }
  if (event.kind === 'session_start') {
    state.running = true;
  }
}

function agentActivityPayload() {
  const preview = state.lastAgentMessage
    ? state.lastAgentMessage.split('\n').find((l) => l.trim())?.slice(0, 280) ||
      state.lastAgentMessage.slice(0, 280)
    : null;
  return {
    last_agent_message_preview: preview,
    last_agent_message: state.lastAgentMessage
      ? state.lastAgentMessage.slice(0, 4000)
      : null,
    last_agent_message_at: state.lastAgentMessageAt,
    last_turn_finished_at: state.lastTurnFinishedAt,
    agent_running: state.running,
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

async function resolveTransport() {
  if (extensionConfigured()) {
    state.transport = 'extension-composer';
    ensureExtensionRelay();
    if (await extensionReachable()) {
      return 'extension';
    }
    return 'extension-offline';
  }
  if (await extensionAvailable()) {
    state.transport = 'extension-composer';
    ensureExtensionRelay();
    return 'extension';
  }
  state.transport = 'desktop-cli';
  return 'desktop';
}

async function getStatusPayload() {
  const transport = await resolveTransport();
  if (transport === 'extension' || transport === 'extension-offline') {
    const ext = transport === 'extension' ? await extensionGetStatus() : null;
    if (ext) {
      return {
        running: ext.running ?? state.running,
        composer_id: ext.composer_id ?? state.lastThreadId,
        thread_title: ext.thread_title ?? state.lastThreadTitle,
        last_event_at: ext.last_event_at ?? state.lastEventAt,
        threads: ext.threads || [],
        transport: 'extension-composer',
        extension_reachable: true,
        agent_activity: { ...agentActivityPayload(), ...(ext.agent_activity || {}) },
      };
    }
    if (transport === 'extension-offline') {
      let threads = [];
      let desktopFallback = false;
      try {
        threads = await listDesktopThreads();
        desktopFallback = threads.length > 0;
      } catch {
        threads = [];
      }
      return {
        running: state.running,
        composer_id: state.lastThreadId,
        thread_title: state.lastThreadTitle,
        last_event_at: state.lastEventAt,
        threads,
        transport: desktopFallback ? 'desktop-cli-fallback' : 'extension-composer',
        extension_reachable: false,
        extension_config_stale: true,
        hint: desktopFallback
          ? 'Extension HTTP server is not running (stale port in ~/.cursor/cursor-voice-extension.json). Voice can still send via desktop bridge. Fix: Cmd+Shift+P → Cursor Voice: Reload extension.'
          : 'Extension HTTP server is not running. Cmd+Shift+P → Cursor Voice: Reload extension, or open Agent and run ./setup.sh.',
        agent_activity: agentActivityPayload(),
      };
    }
  }
  let threads = [];
  try {
    threads = await listDesktopThreads();
  } catch {
    threads = [];
  }
  return {
    running: state.running,
    composer_id: state.lastThreadId,
    thread_title: state.lastThreadTitle,
    last_event_at: state.lastEventAt,
    threads,
    transport: 'desktop-cli',
    agent_activity: agentActivityPayload(),
  };
}

async function pickThread(threadId) {
  const transport = await resolveTransport();
  if (transport === 'extension') {
    const ext = await extensionGetStatus();
    const threads = ext?.threads || [{ id: 'active-composer', title: 'Active Agent chat' }];
    let id = threadId || state.lastThreadId || threads[0]?.id;
    const thread = threads.find((t) => t.id === id) || threads[0];
    return { threadId: thread?.id || 'active-composer', thread, threads };
  }
  const threads = await listDesktopThreads();
  if (!threads.length) return { error: 'no_agent_threads', threads };
  let id = threadId;
  if (!id || !threads.some((t) => t.id === id)) {
    if (state.lastThreadId && threads.some((t) => t.id === state.lastThreadId)) {
      id = state.lastThreadId;
    } else {
      id = threads[0].id;
    }
  }
  const thread = threads.find((t) => t.id === id);
  return { threadId: id, thread, threads };
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
      transport: ext ? 'extension-composer' : 'desktop-cli',
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

    if (req.method === 'POST' && url.pathname === '/v1/cancel') {
      const transport = await resolveTransport();
      if (transport === 'extension-offline') {
        sendJson(res, 503, {
          error: 'extension_bridge_unreachable',
          hint: 'Reload the Cursor window (Cursor Voice Bridge extension).',
        });
        return true;
      }
      if (transport === 'extension') {
        const result = await extensionCancel();
        if (result && result.status === 200) {
          state.running = false;
          sendJson(res, 200, { ...result.body, transport: 'extension-composer' });
          return true;
        }
      }
      const picked = await pickThread(state.lastThreadId);
      if (picked.error) {
        sendJson(res, 409, picked);
        return true;
      }
      await sendDesktopMessage(picked.threadId, 'Stop the current task.', { force: true });
      state.running = false;
      sendJson(res, 200, { cancelled: true, transport: 'desktop-cli' });
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
        await extensionRestartBridge();
        transport = await resolveTransport();
      }
      if (transport === 'extension') {
        const result = await extensionInstruct({
          text,
          thread_id: body.thread_id,
          policy: body.policy,
        });
        if (result && result.status >= 200 && result.status < 300) {
          if (result.body.thread_id) {
            state.lastThreadId = result.body.thread_id;
          }
          pushEvent({
            event_id: crypto.randomUUID(),
            ts: new Date().toISOString(),
            kind: 'instruct_sent',
            composer_id: result.body.thread_id || state.lastThreadId,
            summary: `Instruction sent (${result.body.method || 'extension'})`,
          });
          sendJson(res, result.status, result.body);
          return true;
        }
      }
      const force = body.policy === 'abort_then_send';
      const picked = await pickThread(body.thread_id);
      if (picked.error) {
        sendJson(res, 409, {
          error: picked.error,
          hint: 'Install the Cursor Voice Bridge extension in Cursor, or enable desktop_bridge for CLI',
        });
        return true;
      }
      const desktop = await sendDesktopMessage(picked.threadId, text, { force });
      state.lastThreadId = picked.threadId;
      state.lastThreadTitle = picked.thread?.title || desktop.threadTitle;
      const usedFallback = extensionConfigured() && transport === 'extension-offline';
      pushEvent({
        event_id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        kind: 'instruct_sent',
        composer_id: picked.threadId,
        summary: `Instruction sent (${usedFallback ? 'desktop-cli-fallback' : 'desktop-cli'})`,
      });
      sendJson(res, 200, {
        submitted: true,
        thread_id: picked.threadId,
        desktop,
        transport: usedFallback ? 'desktop-cli-fallback' : 'desktop-cli',
        warning: usedFallback
          ? 'Extension HTTP bridge was down; message sent via desktop bridge. Reload extension: Cmd+Shift+P → Cursor Voice: Reload extension.'
          : undefined,
      });
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
