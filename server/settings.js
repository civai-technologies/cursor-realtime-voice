const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');

function parseEnvFile(raw) {
  const map = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    map[key] = val;
  }
  return map;
}

function serializeEnv(map, originalRaw) {
  const lines = originalRaw.split('\n');
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      out.push(line);
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq < 0) {
      out.push(line);
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (key in map) {
      out.push(`${key}=${map[key]}`);
      seen.add(key);
    } else {
      out.push(line);
    }
  }
  for (const [key, val] of Object.entries(map)) {
    if (!seen.has(key)) {
      out.push(`${key}=${val}`);
    }
  }
  return out.join('\n').replace(/\n*$/, '\n');
}

function readEnvFromDisk() {
  if (!fs.existsSync(ENV_PATH)) {
    return { raw: '', map: {} };
  }
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  return { raw, map: parseEnvFile(raw) };
}

function getOpenAiKey() {
  const fromProcess = process.env.OPENAI_API_KEY?.trim();
  if (fromProcess) return fromProcess;
  const { map } = readEnvFromDisk();
  return map.OPENAI_API_KEY?.trim() || '';
}

function keyHint(key) {
  if (!key || key.length < 8) return null;
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

function getSettingsPublic() {
  const key = getOpenAiKey();
  return {
    openai_api_key_set: Boolean(key),
    openai_api_key_hint: keyHint(key),
    env_file: ENV_PATH,
  };
}

function setOpenAiApiKey(newKey) {
  const trimmed = String(newKey || '').trim();
  if (!trimmed.startsWith('sk-')) {
    throw Object.assign(new Error('API key should start with sk-'), { statusCode: 400 });
  }
  const { raw, map } = readEnvFromDisk();
  map.OPENAI_API_KEY = trimmed;
  const next = serializeEnv(map, raw || '');
  fs.writeFileSync(ENV_PATH, next, { mode: 0o600 });
  process.env.OPENAI_API_KEY = trimmed;
  return getSettingsPublic();
}

module.exports = {
  getOpenAiKey,
  getSettingsPublic,
  setOpenAiApiKey,
  ENV_PATH,
};
