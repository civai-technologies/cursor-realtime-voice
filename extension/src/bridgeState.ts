import type { HarnessEvent } from "./types";

const MAX_EVENTS = 200;
const THROTTLE_MS = 4000;

export class BridgeState {
  running = false;
  activeRunId: string | null = null;
  lastThreadId: string | null = null;
  lastThreadTitle: string | null = null;
  lastEventAt: string | null = null;
  lastAgentMessage: string | null = null;
  lastAgentMessageAt: string | null = null;
  lastTurnFinishedAt: string | null = null;

  private events: HarnessEvent[] = [];
  private sseClients: Set<(event: HarnessEvent) => void> = new Set();
  private lastSpokenThrottleAt = 0;

  pushEvent(event: HarnessEvent): HarnessEvent | null {
    this.lastEventAt = event.ts;
    if (event.composer_id) {
      this.lastThreadId = event.composer_id;
    }
    if (
      event.kind === "assistant_chunk" &&
      !/instruction sent/i.test(event.summary || "")
    ) {
      const body =
        (event.detail && event.detail.trim()) ||
        (event.summary && !/^agent responded$/i.test(event.summary) ? event.summary : "");
      const echo =
        /127\.0\.0\.1:8787|cursor-voice-server|Start voice|cursor_voice_/i.test(body);
      if (body && !echo) {
        this.lastAgentMessage = body.slice(0, 12000);
        this.lastAgentMessageAt = event.ts;
      }
    }
    if (event.kind === "instruct_sent") {
      this.running = true;
    }
    if (event.kind === "run_done") {
      this.lastTurnFinishedAt = event.ts;
    }
    if (event.kind === "session_start") {
      this.running = true;
      this.activeRunId = event.event_id;
    }
    if (event.kind === "run_done" || event.kind === "run_cancelled" || event.kind === "session_end") {
      this.running = false;
      this.activeRunId = null;
    }
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.shift();
    }
    for (const client of this.sseClients) {
      client(event);
    }
    return this.shouldThrottleForVoice(event) ? null : event;
  }

  private shouldThrottleForVoice(event: HarnessEvent): boolean {
    if (event.kind === "run_done" || event.kind === "error" || event.kind === "run_cancelled") {
      return false;
    }
    const now = Date.now();
    if (now - this.lastSpokenThrottleAt < THROTTLE_MS) {
      return true;
    }
    this.lastSpokenThrottleAt = now;
    return false;
  }

  subscribe(listener: (event: HarnessEvent) => void): () => void {
    this.sseClients.add(listener);
    return () => this.sseClients.delete(listener);
  }

  agentActivity() {
    const preview = this.lastAgentMessage
      ? this.lastAgentMessage.split("\n").find((l) => l.trim())?.slice(0, 280) ||
        this.lastAgentMessage.slice(0, 280)
      : null;
    return {
      last_agent_message_preview: preview,
      last_agent_message: this.lastAgentMessage ? this.lastAgentMessage.slice(0, 4000) : null,
      last_agent_message_at: this.lastAgentMessageAt,
      last_turn_finished_at: this.lastTurnFinishedAt,
      agent_running: this.running,
    };
  }

  snapshot() {
    return {
      running: this.running,
      active_run_id: this.activeRunId,
      composer_id: this.lastThreadId,
      thread_title: this.lastThreadTitle,
      last_event_at: this.lastEventAt,
      agent_activity: this.agentActivity(),
    };
  }

  setThreadMeta(id: string, title?: string) {
    this.lastThreadId = id;
    if (title) {
      this.lastThreadTitle = title;
    }
  }
}
