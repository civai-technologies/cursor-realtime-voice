const fs = require('fs');
const http = require('http');
const path = require('path');

const EXT_CONFIG_PATH = path.join(process.env.HOME || '', '.cursor', 'cursor-voice-extension.json');

function readExtensionConfigRaw() {
  try {
    if (!fs.existsSync(EXT_CONFIG_PATH)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(EXT_CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function readExtensionConfig() {
  const raw = readExtensionConfigRaw();
  if (!raw || typeof raw.port !== 'number' || !raw.token) {
    return null;
  }
  if (raw.bridge_active === false) {
    return null;
  }
  return {
    host: raw.host || '127.0.0.1',
    port: raw.port,
    token: raw.token,
  };
}

function extensionRequest(method, pathname, body, options = {}) {
  const cfg = readExtensionConfig();
  if (!cfg) {
    return Promise.resolve(null);
  }
  const payload = body ? JSON.stringify(body) : null;
  const timeoutMs = options.timeoutMs ?? 15000;
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: cfg.host,
        port: cfg.port,
        path: pathname,
        method,
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 500,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function extensionConfigured() {
  return readExtensionConfig() !== null;
}

async function extensionRequestOnPort(port, method, pathname, body, options = {}) {
  const cfg = readExtensionConfig();
  if (!cfg) {
    return Promise.resolve(null);
  }
  const payload = body ? JSON.stringify(body) : null;
  const timeoutMs = options.timeoutMs ?? 15000;
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method,
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 500,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function tryBootstrapSyncOnPort(port) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/v1/bootstrap',
        method: 'GET',
        timeout: 800,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function discoverExtensionPortAndSync() {
  const probe = (port) =>
    new Promise((resolve) => {
      const req = http.request(
        { hostname: '127.0.0.1', port, path: '/v1/health', method: 'GET', timeout: 400 },
        (res) => {
          let body = '';
          res.on('data', (c) => {
            body += c.toString('utf8');
          });
          res.on('end', () => {
            if (res.statusCode === 200 && body.includes('"ok"')) {
              resolve(port);
            } else {
              resolve(null);
            }
          });
        }
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    });

  for (let port = 52000; port < 56000; port += 1) {
    const hit = await probe(port);
    if (!hit) {
      continue;
    }
    if (await tryBootstrapSyncOnPort(port)) {
      return port;
    }
  }
  return null;
}

async function extensionAvailable() {
  let res = await extensionRequest('GET', '/v1/health');
  if (res && res.status === 200) {
    return true;
  }
  const synced = await discoverExtensionPortAndSync();
  if (!synced) {
    return false;
  }
  res = await extensionRequest('GET', '/v1/health');
  return res && res.status === 200;
}

async function extensionReachable(retries = 5) {
  for (let i = 0; i <= retries; i += 1) {
    if (await extensionAvailable()) {
      return true;
    }
    if (i < retries) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return false;
}

async function extensionProbe() {
  const raw = readExtensionConfigRaw();
  const configured = Boolean(raw && typeof raw.port === 'number' && raw.token);
  const port = configured ? raw.port : null;
  const host = configured ? raw.host || '127.0.0.1' : null;
  const bridge_active = configured ? raw.bridge_active !== false : null;

  if (!configured) {
    return {
      config_path: EXT_CONFIG_PATH,
      configured: false,
      health_ok: false,
      port: null,
      host: null,
      bridge_active: null,
      reason: 'no_config',
      likely_cause:
        'No ~/.cursor/cursor-voice-extension.json — the Cursor Voice extension has not started its HTTP bridge in this Cursor window.',
    };
  }

  if (bridge_active === false) {
    return {
      config_path: EXT_CONFIG_PATH,
      configured: true,
      health_ok: false,
      port,
      host,
      bridge_active: false,
      reason: 'bridge_stopped',
      likely_cause:
        'Extension marked the bridge as stopped (restart in progress or extension deactivated). Reload extension or run Restart Bridge.',
    };
  }

  const health_ok = await extensionAvailable();
  return {
    config_path: EXT_CONFIG_PATH,
    configured: true,
    health_ok,
    port,
    host,
    bridge_active: true,
    reason: health_ok ? 'ok' : 'connection_refused_or_timeout',
    likely_cause: health_ok
      ? null
      : `Nothing is listening on ${host}:${port}. The config file is stale (extension host crashed, was reloaded without restart, or an old port was left behind). Cmd+Shift+P → Cursor Voice: Reload extension, then Restart Bridge.`,
  };
}

async function extensionGetStatus() {
  const res = await extensionRequest('GET', '/v1/status');
  if (!res || res.status !== 200) {
    return null;
  }
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

async function extensionInstruct(body) {
  const attempts = 3;
  for (let i = 0; i < attempts; i += 1) {
    const res = await extensionRequest('POST', '/v1/instruct', body, { timeoutMs: 45000 });
    if (!res) {
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      return null;
    }
    let parsed;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      parsed = { error: res.body };
    }
    return { status: res.status, body: parsed };
  }
  return null;
}

async function extensionRestartBridge() {
  const res = await extensionRequest('POST', '/v1/restart', {}, { timeoutMs: 10000 });
  if (!res || res.status !== 200) {
    return false;
  }
  await new Promise((r) => setTimeout(r, 400));
  return extensionReachable(4);
}

async function extensionFocusThread(body) {
  const payload =
    typeof body === 'string'
      ? { thread_id: body }
      : { thread_id: body?.thread_id, title_contains: body?.title_contains };
  const res = await extensionRequest('POST', '/v1/focus', payload, { timeoutMs: 15000 });
  if (!res) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    parsed = { error: res.body };
  }
  return { status: res.status, body: parsed };
}

async function extensionCancel() {
  const res = await extensionRequest('POST', '/v1/cancel', {});
  if (!res) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    parsed = { error: res.body };
  }
  return { status: res.status, body: parsed };
}

function startExtensionEventRelay(onEvent) {
  let activeReq = null;
  let stopped = false;

  const connect = () => {
    if (stopped) {
      return;
    }
    const cfg = readExtensionConfig();
    if (!cfg) {
      setTimeout(connect, 2000);
      return;
    }
    const req = http.request(
      {
        hostname: cfg.host,
        port: cfg.port,
        path: '/v1/events/stream',
        method: 'GET',
        headers: { Authorization: `Bearer ${cfg.token}` },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          setTimeout(connect, 2000);
          return;
        }
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          let idx;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            for (const line of block.split('\n')) {
              if (line.startsWith('data: ')) {
                try {
                  const ev = JSON.parse(line.slice(6));
                  onEvent(ev);
                } catch {
                  // ignore
                }
              }
            }
          }
        });
        res.on('end', () => {
          setTimeout(connect, 1500);
        });
      }
    );
    req.on('error', () => {
      setTimeout(connect, 2000);
    });
    req.end();
    activeReq = req;
  };

  connect();

  return () => {
    stopped = true;
    if (activeReq) {
      activeReq.destroy();
      activeReq = null;
    }
  };
}

module.exports = {
  readExtensionConfig,
  extensionConfigured,
  extensionAvailable,
  extensionReachable,
  extensionProbe,
  extensionGetStatus,
  extensionInstruct,
  extensionFocusThread,
  extensionRestartBridge,
  extensionCancel,
  startExtensionEventRelay,
  EXT_CONFIG_PATH,
};
