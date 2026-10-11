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
      `Extension config exists (${EXT_CONFIG_PATH}, port ${probe.port}) but nothing is listening — stale bridge after crash or extension host not loaded.`
    );
    steps.push('Cmd+Shift+P → “Cursor Voice: Reload extension”, then “Cursor Voice: Restart Bridge” (modal should show a new port).');
    steps.push('Cmd+Shift+P → “Cursor Voice: Test Send to Agent” to confirm text appears in Agent chat (not a test dialog).');
  } else {
    steps.push('Extension bridge is live — voice sends instructions through in-IDE Composer commands.');
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
