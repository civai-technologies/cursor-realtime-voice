import { execFile } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as path from "path";

const execFileAsync = promisify(execFile);

export type DesktopThread = {
  id: string;
  title?: string;
};

export type DesktopSendResult = {
  status: string;
  threadId?: string;
  windowId?: number;
  threadTitle?: string;
};

function resolveCursorPaths(): { appBinary: string; cliJs: string } {
  const override = process.env.CURSOR_VOICE_CURSOR_APP;
  if (override) {
    const appBinary = override;
    const cliJs = path.join(path.dirname(appBinary), "../Resources/app/out/cli.js");
    return { appBinary, cliJs };
  }
  if (process.platform === "darwin") {
    const appBinary = "/Applications/Cursor.app/Contents/MacOS/Cursor";
    const cliJs = "/Applications/Cursor.app/Contents/Resources/app/out/cli.js";
    return { appBinary, cliJs };
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const appBinary = path.join(local, "Programs", "cursor", "Cursor.exe");
    const cliJs = path.join(local, "Programs", "cursor", "resources", "app", "out", "cli.js");
    return { appBinary, cliJs };
  }
  const appBinary = "cursor";
  const cliJs = path.join(os.homedir(), ".cursor", "resources", "app", "out", "cli.js");
  return { appBinary, cliJs };
}

function parseJsonArray(stdout: string): DesktopThread[] {
  const start = stdout.indexOf("[");
  if (start < 0) {
    throw new Error(`desktop ls: no JSON array in output: ${stdout.slice(0, 200)}`);
  }
  const data = JSON.parse(stdout.slice(start)) as Array<{ id?: string; title?: string }>;
  return data
    .filter((row) => typeof row.id === "string" && row.id.length > 0)
    .map((row) => ({ id: row.id as string, title: row.title }));
}

async function runDesktop(args: string[]): Promise<string> {
  const { appBinary, cliJs } = resolveCursorPaths();
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  const { stdout, stderr } = await execFileAsync(appBinary, [cliJs, "desktop", ...args], {
    env,
    maxBuffer: 4 * 1024 * 1024,
  });
  const combined = `${stdout}\n${stderr}`.trim();
  if (combined.includes("no running Cursor desktop")) {
    throw new Error("Cursor desktop is not running or desktop bridge is disabled");
  }
  return combined;
}

export async function listDesktopThreads(): Promise<DesktopThread[]> {
  const out = await runDesktop(["ls", "--json"]);
  return parseJsonArray(out);
}

export async function sendDesktopMessage(threadId: string, text: string): Promise<DesktopSendResult> {
  const out = await runDesktop(["send", threadId, text, "--json"]);
  const start = out.indexOf("{");
  if (start < 0) {
    throw new Error(`desktop send: no JSON object: ${out.slice(0, 200)}`);
  }
  return JSON.parse(out.slice(start)) as DesktopSendResult;
}
