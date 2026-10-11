import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { BridgeState } from "./bridgeState";
import {
  cancelComposerRun,
  focusComposerThread,
  getFocusedComposerId,
  listComposerThreads,
  submitComposerInstruction,
} from "./composerInstruct";
import { listComposerThreadsDetailed } from "./composerThreadMeta";
import type { HarnessEvent } from "./types";

export type BridgeConfig = {
  host: string;
  port: number;
  token: string;
  created_at: string;
  source?: string;
  bridge_active?: boolean;
};

/** Written for the voice server to discover this extension (not overwritten by npm start). */
const CONFIG_PATH = path.join(os.homedir(), ".cursor", "cursor-voice-extension.json");

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function unauthorized(res: http.ServerResponse) {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "unauthorized" }));
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function isLoopback(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) {
    return false;
  }
  return remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
}

function applyDevCors(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const origin = req.headers.origin;
  if (
    origin &&
    /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

function newEvent(partial: Omit<HarnessEvent, "event_id" | "ts">): HarnessEvent {
  return {
    event_id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    ...partial,
  };
}

export class BridgeServer {
  private server: http.Server | null = null;
  private config: BridgeConfig | null = null;

  constructor(private readonly state: BridgeState) {}

  getConfig(): BridgeConfig | null {
    return this.config;
  }

  /** Keep ~/.cursor/cursor-voice-extension.json aligned with the in-memory bridge (fixes stale port after reload). */
  private persistConfigToDisk(): void {
    if (!this.config) {
      return;
    }
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), { mode: 0o600 });
  }

  async start(): Promise<BridgeConfig> {
    if (this.server) {
      await this.stop();
    }
    const token = crypto.randomBytes(32).toString("hex");
    const server = http.createServer((req, res) => {
      void this.handle(req, res, token);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("bridge listen failed");
    }
    this.config = {
      host: "127.0.0.1",
      port: addr.port,
      token,
      created_at: new Date().toISOString(),
      source: "cursor-voice-extension",
      bridge_active: true,
    };
    this.server = server;
    this.persistConfigToDisk();
    return this.config;
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
    const prev = this.config;
    this.config = null;
    try {
      if (prev) {
        fs.writeFileSync(
          CONFIG_PATH,
          JSON.stringify(
            {
              ...prev,
              bridge_active: false,
              stopped_at: new Date().toISOString(),
            },
            null,
            2
          ),
          { mode: 0o600 }
        );
      } else if (fs.existsSync(CONFIG_PATH)) {
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
        fs.writeFileSync(
          CONFIG_PATH,
          JSON.stringify(
            {
              ...raw,
              bridge_active: false,
              stopped_at: new Date().toISOString(),
            },
            null,
            2
          ),
          { mode: 0o600 }
        );
      }
    } catch {
      // ignore
    }
  }

  private checkAuth(req: http.IncomingMessage, token: string): boolean {
    if (!isLoopback(req.socket.remoteAddress)) {
      return false;
    }
    const auth = req.headers.authorization || "";
    if (auth === `Bearer ${token}`) {
      return true;
    }
    return false;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse, token: string): Promise<void> {
    try {
      if (!isLoopback(req.socket.remoteAddress)) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (applyDevCors(req, res)) {
        return;
      }
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const method = req.method || "GET";

      if (method === "GET" && url.pathname === "/v1/health") {
        this.persistConfigToDisk();
        json(res, 200, { ok: true, port: this.config?.port ?? null });
        return;
      }

      if (method === "GET" && url.pathname === "/v1/bootstrap") {
        this.persistConfigToDisk();
        json(res, 200, {
          ok: true,
          port: this.config?.port ?? null,
          config_path: CONFIG_PATH,
        });
        return;
      }

      if (method === "POST" && url.pathname === "/v1/restart") {
        if (!this.checkAuth(req, token)) {
          unauthorized(res);
          return;
        }
        const prevPort = this.config?.port;
        await this.stop();
        const cfg = await this.start();
        json(res, 200, {
          restarted: true,
          previous_port: prevPort ?? null,
          port: cfg.port,
        });
        return;
      }

      if (method === "GET" && url.pathname === "/v1/events/stream") {
        if (!this.checkAuth(req, token)) {
          unauthorized(res);
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        const send = (event: HarnessEvent) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        const unsub = this.state.subscribe(send);
        req.on("close", () => unsub());
        return;
      }

      if (!this.checkAuth(req, token)) {
        unauthorized(res);
        return;
      }

      if (method === "GET" && url.pathname === "/v1/status") {
        let threads: unknown[] = [];
        try {
          threads = await listComposerThreadsDetailed();
        } catch {
          try {
            threads = await listComposerThreads();
          } catch {
            threads = [];
          }
        }
        const focusedComposerId = await getFocusedComposerId();
        json(res, 200, {
          ...this.state.snapshot(),
          threads,
          focused_composer_id: focusedComposerId,
          transport: "extension-composer",
        });
        return;
      }

      if (method === "POST" && url.pathname === "/v1/focus") {
        const body = (await readJsonBody(req)) as { thread_id?: string };
        const threadId = body.thread_id?.trim();
        if (!threadId) {
          json(res, 400, { error: "thread_id required" });
          return;
        }
        const resolved = await focusComposerThread(threadId);
        json(res, 200, { focused: true, thread_id: resolved });
        return;
      }

      if (method === "POST" && url.pathname === "/v1/events") {
        const body = (await readJsonBody(req)) as Partial<HarnessEvent>;
        if (!body.kind || !body.summary) {
          json(res, 400, { error: "kind and summary required" });
          return;
        }
        const event = newEvent({
          kind: body.kind as HarnessEvent["kind"],
          summary: String(body.summary),
          composer_id: body.composer_id,
          tool_name: body.tool_name,
          detail: typeof body.detail === "string" ? body.detail : undefined,
          voice_relevant: body.voice_relevant === true,
        });
        this.state.pushEvent(event);
        json(res, 202, { accepted: true, event_id: event.event_id });
        return;
      }

      if (method === "POST" && url.pathname === "/v1/cancel") {
        await cancelComposerRun();
        const event = newEvent({
          kind: "run_cancelled",
          summary: "Agent run cancel requested from voice bridge",
        });
        this.state.pushEvent(event);
        json(res, 200, { cancelled: true, transport: "extension-composer" });
        return;
      }

      if (method === "POST" && url.pathname === "/v1/instruct") {
        const body = (await readJsonBody(req)) as {
          text?: string;
          thread_id?: string;
          policy?: "send" | "abort_then_send";
        };
        const text = body.text?.trim();
        if (!text) {
          json(res, 400, { error: "text required" });
          return;
        }
        const threads = await listComposerThreads();
        const submit = await submitComposerInstruction(text, {
          abortFirst: body.policy === "abort_then_send",
          threadId: body.thread_id,
        });
        const threadId = submit.threadId || body.thread_id || threads[0]?.id || "active-composer";
        const thread = threads.find((t) => t.id === threadId);
        this.state.setThreadMeta(threadId, thread?.title || "Agent");
        const event = newEvent({
          kind: "instruct_sent",
          composer_id: threadId,
          summary: `Instruction sent to Agent (${submit.method})`,
        });
        this.state.pushEvent(event);
        json(res, 200, {
          submitted: true,
          thread_id: threadId,
          transport: "extension-composer",
          method: submit.method,
          hint:
            "Check the Agent (Composer) panel in Cursor — voice posts a user message there, not a separate chat app.",
        });
        return;
      }

      json(res, 404, { error: "not_found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const event = newEvent({ kind: "error", summary: message });
      this.state.pushEvent(event);
      json(res, 500, { error: message });
    }
  }
}
