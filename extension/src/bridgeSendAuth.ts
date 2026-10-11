import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const TOKEN_KEY = "cursor.desktopBridge.rendererInvocationToken";

function stateVscdbPath(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  }
  if (process.platform === "win32") {
    return path.join(home, "AppData", "Roaming", "Cursor", "User", "globalStorage", "state.vscdb");
  }
  return path.join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb");
}

/** Renderer token Cursor checks for in-IDE `composer.desktopBridge.sendMessage` (not the terminal CLI). */
export async function readBridgeInvocationToken(): Promise<string | null> {
  const db = stateVscdbPath();
  if (!fs.existsSync(db)) {
    return null;
  }
  const sql = `SELECT value FROM ItemTable WHERE key = '${TOKEN_KEY.replace(/'/g, "''")}';`;
  for (const bin of ["/usr/bin/sqlite3", "/opt/homebrew/bin/sqlite3", "sqlite3"]) {
    try {
      const { stdout } = await execFileAsync(bin, [db, sql], { timeout: 8000, maxBuffer: 64 * 1024 });
      const v = stdout.trim();
      if (v.length > 0) {
        return v;
      }
    } catch {
      // try next
    }
  }
  return null;
}
