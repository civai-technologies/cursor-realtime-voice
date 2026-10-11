export type BridgeConfig = {
  host?: string;
  port?: number;
  token: string;
  same_origin?: boolean;
};

export async function loadBridgeConfig(): Promise<BridgeConfig> {
  const res = await fetch("/bridge-config");
  if (!res.ok) {
    throw new Error("Bridge not ready — run `npm start` from cursor-voice, then refresh. Keep Cursor open with an Agent chat.");
  }
  return (await res.json()) as BridgeConfig;
}

async function bridgeFetch(
  cfg: BridgeConfig,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${cfg.token}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const url =
    cfg.same_origin || !cfg.host || !cfg.port
      ? path
      : `http://${cfg.host}:${cfg.port}${path}`;
  return fetch(url, { ...init, headers });
}

export async function bridgeGetStatus(cfg: BridgeConfig): Promise<Record<string, unknown>> {
  const res = await bridgeFetch(cfg, "/v1/status");
  if (!res.ok) {
    throw new Error(`status ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export async function bridgeInstruct(
  cfg: BridgeConfig,
  body: { text: string; thread_id?: string; policy?: "send" | "abort_then_send" }
): Promise<Record<string, unknown>> {
  const res = await bridgeFetch(cfg, "/v1/instruct", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    if (data.error === "no_agent_threads") {
      throw new Error(
        "No Cursor Agent thread is open. In Cursor, open Agent (Composer), start or focus a chat, then try again."
      );
    }
    const hint = typeof data.hint === "string" ? ` ${data.hint}` : "";
    throw new Error(String(data.error || res.status) + hint);
  }
  return data;
}

export async function bridgeCancel(cfg: BridgeConfig): Promise<void> {
  const res = await bridgeFetch(cfg, "/v1/cancel", { method: "POST", body: "{}" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(String((data as { error?: string }).error || res.status));
  }
}

export async function openBridgeEventStream(
  cfg: BridgeConfig,
  onEvent: (payload: Record<string, unknown>) => void,
  onError?: (err: Error) => void
): Promise<() => void> {
  // Long-lived SSE — do not use a short AbortSignal.timeout (it kills the stream).
  const res = await bridgeFetch(cfg, "/v1/events/stream");
  if (!res.ok || !res.body) {
    throw new Error(
      `IDE bridge failed (${res.status}). Quit old servers and run only: npm start — then open http://127.0.0.1:8787`
    );
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let cancelled = false;

  const pump = async (): Promise<void> => {
    while (!cancelled) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of block.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              onEvent(JSON.parse(line.slice(6)) as Record<string, unknown>);
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  };

  void pump().catch((e) => onError?.(e instanceof Error ? e : new Error(String(e))));

  return () => {
    cancelled = true;
    void reader.cancel();
  };
}
