import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function resolveEnableScriptPath(): string | null {
  const candidates = [
    process.env.CURSOR_VOICE_ENABLE_BRIDGE_SCRIPT,
    path.join(process.env.HOME ?? "", "Documents/civai/cursor-voice/scripts/enable-desktop-bridge.py"),
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

/**
 * Re-write Statsig bootstrap + bridge flags in state.vscdb while Cursor is open.
 * Cursor's in-memory gate may still need Developer: Reload Window before send works.
 */
export async function runtimeRepairDesktopBridgeGate(): Promise<boolean> {
  const script = resolveEnableScriptPath();
  if (!script) {
    return false;
  }
  try {
    await execFileAsync("python3", [script, "--runtime"], {
      timeout: 15000,
      maxBuffer: 256 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}
