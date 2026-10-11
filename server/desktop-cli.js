const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const path = require('path');

const execFileAsync = promisify(execFile);

function resolveCursorPaths() {
  const override = process.env.CURSOR_VOICE_CURSOR_APP;
  if (override) {
    const appBinary = override;
    const cliJs = path.join(path.dirname(appBinary), '../Resources/app/out/cli.js');
    return { appBinary, cliJs };
  }
  if (process.platform === 'darwin') {
    return {
      appBinary: '/Applications/Cursor.app/Contents/MacOS/Cursor',
      cliJs: '/Applications/Cursor.app/Contents/Resources/app/out/cli.js',
    };
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return {
      appBinary: path.join(local, 'Programs', 'cursor', 'Cursor.exe'),
      cliJs: path.join(local, 'Programs', 'cursor', 'resources', 'app', 'out', 'cli.js'),
    };
  }
  return {
    appBinary: 'cursor',
    cliJs: path.join(os.homedir(), '.cursor', 'resources', 'app', 'out', 'cli.js'),
  };
}

async function runDesktop(args) {
  const { appBinary, cliJs } = resolveCursorPaths();
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  const { stdout, stderr } = await execFileAsync(appBinary, [cliJs, 'desktop', ...args], {
    env,
    maxBuffer: 4 * 1024 * 1024,
  });
  const combined = `${stdout}\n${stderr}`.trim();
  if (combined.includes('Desktop bridge is disabled') || combined.includes('"status": "error"')) {
    if (/disabled/i.test(combined)) {
      throw new Error('Desktop bridge is disabled — quit Cursor and run ./scripts/enable-after-quit-and-test.sh');
    }
  }
  if (combined.includes('no running Cursor desktop')) {
    throw new Error('Cursor desktop is not running');
  }
  return combined;
}

async function listDesktopThreads() {
  const out = await runDesktop(['ls', '--json']);
  const start = out.indexOf('[');
  if (start < 0) throw new Error(`desktop ls: no JSON: ${out.slice(0, 200)}`);
  const data = JSON.parse(out.slice(start));
  return data.filter((r) => r && r.id).map((r) => ({ id: r.id, title: r.title }));
}

async function sendDesktopMessage(threadId, text, { force = false } = {}) {
  const args = ['send', threadId, text, '--json'];
  if (force) args.push('--force');
  const out = await runDesktop(args);
  const start = out.indexOf('{');
  if (start < 0) throw new Error(`desktop send: no JSON: ${out.slice(0, 200)}`);
  return JSON.parse(out.slice(start));
}

module.exports = { listDesktopThreads, sendDesktopMessage };
