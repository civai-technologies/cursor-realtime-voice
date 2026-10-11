#!/usr/bin/env node
/**
 * Loopback IDE bridge without the VS Code extension.
 * Writes ~/.cursor/cursor-voice-bridge.json — same contract as the extension.
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { listDesktopThreads, sendDesktopMessage } = require('./desktop-cli');

const repoRoot = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(repoRoot, '.env') });

const HOST = process.env.CURSOR_VOICE_BRIDGE_HOST || '127.0.0.1';
const PORT = parseInt(process.env.CURSOR_VOICE_BRIDGE_PORT || '8790', 10);
const CONFIG_PATH = path.join(process.env.HOME || '', '.cursor', 'cursor-voice-bridge.json');

const state = {
  running: false,
  lastThreadId: null,
  lastThreadTitle: null,
  lastEventAt: null,
  sseClients: new Set(),
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

function isLoopback(req) {
  const addr = req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function pushEvent(event) {
  state.lastEventAt = event.ts;
  if (event.composer_id) state.lastThreadId = event.composer_id;
  for (const fn of state.sseClients) fn(event);
}

function writeConfig(token) {
  const cfg = {
    host: HOST,
    port: PORT,
    token,
    created_at: new Date().toISOString(),
    source: 'local-bridge',
  };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  return cfg;
}

async function pickThread(threadId) {
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

const token = crypto.randomBytes(32).toString('hex');

const server = http.createServer(async (req, res) => {
  if (!isLoopback(req)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (applyCors(req, res)) return;

  const url = new URL(req.url || '/', `http://${HOST}`);
  const auth = req.headers.authorization || '';

  if (req.method === 'GET' && url.pathname === '/v1/health') {
    sendJson(res, 200, { ok: true, source: 'local-bridge' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/events/stream') {
    if (auth !== `Bearer ${token}`) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    state.sseClients.add(send);
    req.on('close', () => state.sseClients.delete(send));
    return;
  }

  if (auth !== `Bearer ${token}`) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/v1/status') {
      let threads = [];
      try {
        threads = await listDesktopThreads();
      } catch {
        threads = [];
      }
      sendJson(res, 200, {
        running: state.running,
        composer_id: state.lastThreadId,
        thread_title: state.lastThreadTitle,
        last_event_at: state.lastEventAt,
        threads,
        source: 'local-bridge',
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/events') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const event = {
        event_id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        kind: body.kind,
        summary: body.summary,
        composer_id: body.composer_id,
      };
      pushEvent(event);
      sendJson(res, 202, { accepted: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/cancel') {
      const picked = await pickThread(state.lastThreadId);
      if (picked.error) {
        sendJson(res, 409, picked);
        return;
      }
      await sendDesktopMessage(picked.threadId, 'Stop the current task.', { force: true });
      state.running = false;
      sendJson(res, 200, { cancelled: true, method: 'desktop_send_force' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/instruct') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const text = String(body.text || '').trim();
      if (!text) {
        sendJson(res, 400, { error: 'text required' });
        return;
      }
      const force = body.policy === 'abort_then_send';
      const picked = await pickThread(body.thread_id);
      if (picked.error) {
        sendJson(res, 409, { error: picked.error, hint: 'Open an Agent chat in Cursor first' });
        return;
      }
      const desktop = await sendDesktopMessage(picked.threadId, text, { force });
      state.lastThreadId = picked.threadId;
      state.lastThreadTitle = picked.thread?.title || desktop.threadTitle;
      state.running = true;
      pushEvent({
        event_id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        kind: 'assistant_chunk',
        composer_id: picked.threadId,
        summary: `Instruction sent: ${state.lastThreadTitle || picked.threadId}`,
      });
      sendJson(res, 200, { submitted: true, thread_id: picked.threadId, desktop });
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  } catch (e) {
    sendJson(res, 500, { error: e.message || 'error' });
  }
});

server.listen(PORT, HOST, () => {
  writeConfig(token);
  console.log(`cursor-voice local-bridge http://${HOST}:${PORT}`);
  console.log(`Wrote ${CONFIG_PATH}`);
});
