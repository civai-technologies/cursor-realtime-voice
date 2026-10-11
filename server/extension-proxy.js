const fs = require('fs');
const http = require('http');
const path = require('path');

const EXT_CONFIG_PATH = path.join(process.env.HOME || '', '.cursor', 'cursor-voice-extension.json');

function readExtensionConfig() {
  try {
    if (!fs.existsSync(EXT_CONFIG_PATH)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(EXT_CONFIG_PATH, 'utf8'));
    if (!raw || typeof raw.port !== 'number' || !raw.token) {
      return null;
    }
    return {
      host: raw.host || '127.0.0.1',
      port: raw.port,
      token: raw.token,
    };
  } catch {
    return null;
  }
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

async function extensionAvailable() {
  const res = await extensionRequest('GET', '/v1/health');
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
  extensionGetStatus,
  extensionInstruct,
  extensionRestartBridge,
  extensionCancel,
  startExtensionEventRelay,
  EXT_CONFIG_PATH,
};
