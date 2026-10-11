const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { listDesktopThreads } = require('./desktop-cli');
const {
  extensionAvailable,
  extensionGetStatus,
  EXT_CONFIG_PATH,
} = require('./extension-proxy');

const execFileAsync = promisify(execFile);

async function readBridgeEnabledFromState() {
  const db = path.join(
    process.env.HOME || '',
    'Library/Application Support/Cursor/User/globalStorage/state.vscdb'
  );
  if (!fs.existsSync(db)) return { enabled: null, user_enabled: null };
  try {
    const { stdout } = await execFileAsync('sqlite3', [
      db,
      "SELECT key, value FROM ItemTable WHERE key IN ('cursor.desktopBridge.enabled','cursor/desktopBridgeUserEnabled');",
    ]);
    const map = {};
    for (const line of stdout.trim().split('\n')) {
      const [k, v] = line.split('|');
      if (k) map[k] = v;
    }
    return {
      enabled: map['cursor.desktopBridge.enabled'] === 'true',
      user_enabled: map['cursor/desktopBridgeUserEnabled'] === 'true',
    };
  } catch {
    return { enabled: null, user_enabled: null };
  }
}

async function getDiagnostics() {
  const bridgeDir = path.join(process.env.HOME || '', '.cursor', 'desktop-bridge');
  const discovery_files = fs.existsSync(bridgeDir)
    ? fs.readdirSync(bridgeDir).filter((f) => f.endsWith('.json'))
    : [];
  const flags = await readBridgeEnabledFromState();
  const extension_config_present = fs.existsSync(EXT_CONFIG_PATH);
  const extension_ok = await extensionAvailable();

  let threads = [];
  let list_error = null;
  let transport = 'none';

  if (extension_ok) {
    transport = 'extension-composer';
    const ext = await extensionGetStatus();
    threads = ext?.threads || [];
  } else {
    transport = 'desktop-cli';
    try {
      threads = await listDesktopThreads();
    } catch (e) {
      list_error = e.message || String(e);
    }
  }

  const bridge_disabled =
    transport === 'desktop-cli' &&
    (flags.enabled === false || /disabled/i.test(list_error || ''));
  const ready =
    extension_ok || (!extension_config_present && threads.length > 0 && !bridge_disabled);

  const steps = [];
  if (!extension_ok && extension_config_present) {
    steps.push(
      'Extension config exists but the bridge is not responding — reload the Cursor window (Developer: Reload Window).'
    );
  } else if (!extension_ok) {
    steps.push(
      'Install the Cursor Voice Bridge extension in Cursor (Run Extension from folder: cursor-voice/extension, then reload). Command: Cursor Voice: Test Send to Agent.'
    );
  }
  if (extension_ok) {
    steps.push('Extension bridge is live — voice uses in-IDE Composer commands (no desktop_bridge flag needed).');
  }
  if (!extension_ok && bridge_disabled) {
    steps.push(
      'Desktop CLI bridge is off for your account. Prefer the extension path above instead of enable-after-quit scripts.'
    );
  }
  if (!extension_ok && !bridge_disabled && threads.length === 0) {
    steps.push('Open Agent (Composer) in Cursor, or install the extension bridge.');
  }
  if (!ready && steps.length === 0) {
    steps.push('Run npm start and open http://127.0.0.1:8787');
  }

  return {
    ready,
    threads,
    thread_count: threads.length,
    transport,
    extension: {
      config_file: EXT_CONFIG_PATH,
      config_present: extension_config_present,
      health_ok: extension_ok,
    },
    desktop_bridge: {
      discovery_files: discovery_files.length,
      cursor_desktopBridge_enabled: flags.enabled,
      cursor_desktopBridgeUserEnabled: flags.user_enabled,
      list_error,
    },
    fix_steps: steps,
  };
}

module.exports = { getDiagnostics };
