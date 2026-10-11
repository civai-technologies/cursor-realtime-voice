import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";

const DEFAULT_PORT = parseInt(process.env.CURSOR_VOICE_TOKEN_PORT || "8787", 10);
const HEALTH_PATH = "/v1/health";

function voiceRepoRoot(): string | null {
  const fromEnv = process.env.CURSOR_VOICE_ROOT?.trim();
  if (fromEnv && fs.existsSync(path.join(fromEnv, "server", "index.js"))) {
    return fromEnv;
  }
  for (const dir of ["cursor-realtime-voice", "cursor-voice"]) {
    const candidate = path.join(os.homedir(), "Documents/civai", dir);
    if (fs.existsSync(path.join(candidate, "server", "index.js"))) {
      return candidate;
    }
  }
  return null;
}

function healthCheck(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: HEALTH_PATH, method: "GET", timeout: 2500 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

export class VoiceServerManager {
  private child: ChildProcess | null = null;
  private readonly port = DEFAULT_PORT;

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async ensureRunning(): Promise<{ ok: boolean; message: string }> {
    if (await healthCheck(this.port)) {
      return { ok: true, message: `Voice UI already up at ${this.url}` };
    }

    const repo = voiceRepoRoot();
    if (!repo) {
      return {
        ok: false,
        message:
          "Cursor Voice repo not found. Set CURSOR_VOICE_ROOT to your clone, or clone to ~/Documents/civai/cursor-realtime-voice.",
      };
    }

    const serverDir = path.join(repo, "server");
    const indexJs = path.join(serverDir, "index.js");
    const webDist = path.join(repo, "web", "dist", "index.html");
    if (!fs.existsSync(webDist)) {
      return {
        ok: false,
        message: `Build the web UI once: cd ${repo} && npm run build --prefix web`,
      };
    }

    if (this.child && !this.child.killed) {
      await new Promise((r) => setTimeout(r, 800));
      if (await healthCheck(this.port)) {
        return { ok: true, message: `Voice UI at ${this.url}` };
      }
    }

    const env = { ...process.env };
    const dotEnv = path.join(repo, ".env");
    if (fs.existsSync(dotEnv)) {
      env.CURSOR_VOICE_ROOT = repo;
    }

    this.child = spawn(process.execPath, ["index.js"], {
      cwd: serverDir,
      env: {
        ...env,
        CURSOR_VOICE_HOST: "127.0.0.1",
        CURSOR_VOICE_TOKEN_PORT: String(this.port),
      },
      stdio: "ignore",
      detached: false,
    });

    this.child.on("exit", () => {
      this.child = null;
    });

    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 200));
      if (await healthCheck(this.port)) {
        return { ok: true, message: `Voice UI started at ${this.url}` };
      }
    }

    return {
      ok: false,
      message: `Voice server did not start on port ${this.port}. Check ${path.join(repo, ".cursor-voice-server.log")} or run: cd ${serverDir} && node index.js`,
    };
  }

  async stop(): Promise<void> {
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
      this.child = null;
    }
  }
}
