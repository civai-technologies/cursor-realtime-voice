const fs = require('fs');
const {
  extensionAvailable,
  extensionGetStatus,
  extensionProbe,
  EXT_CONFIG_PATH,
} = require('./extension-proxy');

async function getDiagnostics() {
  const probe = await extensionProbe();
  const extension_ok = probe.health_ok;

  let threads = [];
  let transport = 'extension-composer';

  if (extension_ok) {
    const ext = await extensionGetStatus();
    threads = ext?.threads || [];
  }

  const ready = extension_ok;

  const steps = [];
  if (!probe.configured) {
    steps.push(
      'Install the Cursor Voice Bridge extension: run ./setup.sh from the repo, then in Cursor use Cmd+Shift+P → “Cursor Voice: Reload extension”.'
    );
  } else if (!extension_ok) {
    steps.push(
      'The voice link inside Cursor is offline (often after Reload Window or a crash). Restart it from Cursor — see steps below.'
    );
    steps.push(
      'Command Palette (Cmd+Shift+P on Mac, Ctrl+Shift+P on Windows/Linux) → “Cursor Voice: Reload extension”, then “Cursor Voice: Restart Bridge”.'
    );
    steps.push(
      'Optional check: “Cursor Voice: Send test line to Agent chat” — a new message should appear in Agent, not a popup at the top.'
    );
  } else {
    steps.push('Extension bridge is live — voice sends instructions through in-IDE Composer commands.');
  }
  if (!ready && steps.length === 0) {
    steps.push('Run npm start and open http://127.0.0.1:8787');
  }

  const status_user_message = ready
    ? null
    : steps[0] || 'Voice is not ready yet. Follow the steps in Menu or reload the Cursor extension.';

  return {
    ready,
    status_user_message,
    threads,
    thread_count: threads.length,
    transport,
    extension: {
      config_file: EXT_CONFIG_PATH,
      config_present: probe.configured,
      health_ok: extension_ok,
      port: probe.port,
      bridge_active: probe.bridge_active,
      reason: probe.reason,
      likely_cause: probe.likely_cause,
    },
    fix_steps: steps,
  };
}

module.exports = { getDiagnostics };
