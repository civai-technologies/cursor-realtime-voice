#!/usr/bin/env node
/**
 * Single cursor-voice process: web UI + OpenAI Realtime token + IDE bridge (one port).
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { createEphemeralRealtimeToken } = require('./realtime-token');
const { initBridgeToken, writeBridgeConfig, handleIdeBridge } = require('./ide-bridge');
const { getDiagnostics } = require('./diagnostics');
const { getSettingsPublic, setOpenAiApiKey, getOpenAiKey } = require('./settings');

const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(repoRoot, '.env') });

const HOST = process.env.CURSOR_VOICE_HOST || '127.0.0.1';
const PORT = parseInt(process.env.CURSOR_VOICE_TOKEN_PORT || '8787', 10);
const STATIC_DIR = path.join(repoRoot, 'web', 'dist');

function ensureWebDist() {
  if (process.env.CURSOR_VOICE_SKIP_WEB_BUILD === '1') {
    return;
  }
  const webDir = path.join(repoRoot, 'web');
  const pkg = path.join(webDir, 'package.json');
  if (!fs.existsSync(pkg)) {
    console.warn('[cursor-voice] web/ missing; cannot build UI.');
    return;
  }
  console.log('[cursor-voice] Building web UI (serves from web/dist)…');
  const result = spawnSync('npm', ['run', 'build', '--prefix', webDir], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.warn('[cursor-voice] Web build failed; using existing web/dist if any.');
  }
}

ensureWebDist();

initBridgeToken();

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function isLoopback(req) {
  const addr = req.socket.remoteAddress;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  let filePath = path.join(STATIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(STATIC_DIR)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  if (!fs.existsSync(filePath) && !urlPath.includes('.')) {
    filePath = path.join(STATIC_DIR, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
  };
  const headers = { 'Content-Type': types[ext] || 'application/octet-stream' };
  if (ext === '.html' || ext === '.svg') {
    headers['Cache-Control'] = 'no-cache';
  } else if (urlPath.includes('/assets/')) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  } else if (ext === '.css' || ext === '.js') {
    headers['Cache-Control'] = 'no-cache';
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (!isLoopback(req)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${HOST}`);

  try {
    if (await handleIdeBridge(req, res, url, sendJson, readBody)) {
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, model: process.env.OPENAI_REALTIME_VOICE_MODEL || 'gpt-realtime-mini' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/diagnostics') {
      const diag = await getDiagnostics();
      sendJson(res, 200, {
        ...diag,
        openai_api_key_set: Boolean(getOpenAiKey()),
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/settings') {
      sendJson(res, 200, getSettingsPublic());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/settings/openai-api-key') {
      const body = JSON.parse((await readBody(req)) || '{}');
      try {
        const settings = setOpenAiApiKey(body.api_key || body.openai_api_key);
        sendJson(res, 200, { ok: true, ...settings });
      } catch (e) {
        const status = e.statusCode && Number.isInteger(e.statusCode) ? e.statusCode : 400;
        sendJson(res, status, { error: e.message || 'invalid key' });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/bridge-config') {
      const cfg = writeBridgeConfig(HOST, PORT);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...cfg, same_origin: true }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/realtime/ephemeral-token') {
      await readBody(req);
      if (!getOpenAiKey()) {
        sendJson(res, 400, {
          error: 'missing_openai_api_key',
          message: 'Add your OpenAI API key in the settings panel below, then try again.',
        });
        return;
      }
      const token = await createEphemeralRealtimeToken();
      sendJson(res, 200, token);
      return;
    }

    if (req.method === 'GET' && fs.existsSync(STATIC_DIR)) {
      serveStatic(req, res, decodeURIComponent(url.pathname));
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  } catch (e) {
    const status = e.statusCode && Number.isInteger(e.statusCode) ? e.statusCode : 500;
    sendJson(res, status, { error: e.message || 'server_error' });
  }
});

server.listen(PORT, HOST, () => {
  writeBridgeConfig(HOST, PORT);
  console.log('');
  console.log('  Cursor Voice');
  console.log(`  Open in your browser:  http://${HOST}:${PORT}`);
  console.log('');
  if (!process.env.OPENAI_API_KEY) {
    console.warn('  Warning: set OPENAI_API_KEY in .env');
  }
  if (!fs.existsSync(STATIC_DIR)) {
    console.warn('  Run `npm start` from repo root (builds the UI first).');
  }
});
