import type { HarnessEvent } from "./types";
import {
  activityPayloadFromSlot,
  deriveAgentRunning,
  emptyThreadSlot,
  isVoiceOrServerEcho,
  type ThreadActivitySlot,
} from "./threadActivity";

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
  lastInstructAt: string | null = null;

  private events: HarnessEvent[] = [];
  private sseClients: Set<(event: HarnessEvent) => void> = new Set();
  private lastSpokenThrottleAt = 0;
  private threadSlots = new Map<string, ThreadActivitySlot>();

  private slotFor(composerId: string): ThreadActivitySlot {
    let slot = this.threadSlots.get(composerId);
    if (!slot) {
      slot = emptyThreadSlot();
      this.threadSlots.set(composerId, slot);
    }
    return slot;
  }

  private recordAssistantChunk(event: HarnessEvent, slot?: ThreadActivitySlot): void {
    if (event.kind !== "assistant_chunk" || /instruction sent/i.test(event.summary || "")) {
      return;
    }
    const body =
      (event.detail && event.detail.trim()) ||
      (event.summary && !/^agent responded$/i.test(event.summary) ? event.summary : "");
    if (!body || isVoiceOrServerEcho(body)) {
      return;
    }
    const trimmed = body.slice(0, 12000);
    this.lastAgentMessage = trimmed;
    this.lastAgentMessageAt = event.ts;
    if (slot) {
      slot.lastAgentMessage = trimmed;
      slot.lastAgentMessageAt = event.ts;
    }
  }

  private applyPerThread(event: HarnessEvent): void {
    const composerId = event.composer_id;
    if (!composerId) {
      return;
    }
    const slot = this.slotFor(composerId);
    this.recordAssistantChunk(event, slot);
    if (event.kind === "instruct_sent") {
      slot.running = true;
      slot.lastInstructAt = event.ts;
    }
    if (event.kind === "run_done") {
      slot.lastTurnFinishedAt = event.ts;
      slot.running = false;
    }
    if (event.kind === "run_cancelled" || event.kind === "session_end") {
      slot.running = false;
    }
  }

  pushEvent(event: HarnessEvent): HarnessEvent | null {
    this.lastEventAt = event.ts;
    if (event.composer_id) {
      this.lastThreadId = event.composer_id;
    }
    this.recordAssistantChunk(event);
    this.applyPerThread(event);
    if (event.kind === "instruct_sent") {
      this.running = true;
      this.lastInstructAt = event.ts;
    }
    if (event.kind === "run_done") {
      this.lastTurnFinishedAt = event.ts;
    }
    if (event.kind === "session_start") {
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

  agentActivityFor(composerId?: string | null) {
    if (composerId) {
      const slot = this.threadSlots.get(composerId);
      if (slot && (slot.lastAgentMessage || slot.running || slot.lastTurnFinishedAt)) {
        return activityPayloadFromSlot(
          slot,
          this.running,
          this.lastInstructAt,
          this.lastTurnFinishedAt
        );
      }
    }
    const preview = this.lastAgentMessage
      ? this.lastAgentMessage.split("\n").find((l) => l.trim())?.slice(0, 280) ||
        this.lastAgentMessage.slice(0, 280)
      : null;
    return {
      last_agent_message_preview: preview,
      last_agent_message: this.lastAgentMessage ? this.lastAgentMessage.slice(0, 4000) : null,
      last_agent_message_at: this.lastAgentMessageAt,
      last_turn_finished_at: this.lastTurnFinishedAt,
      last_instruct_at: this.lastInstructAt,
      agent_running: deriveAgentRunning(
        undefined,
        this.running,
        this.lastInstructAt,
        this.lastTurnFinishedAt
      ),
    };
  }

  runningFor(composerId?: string | null): boolean {
    const slot = composerId ? this.threadSlots.get(composerId) : undefined;
    return deriveAgentRunning(slot, this.running, this.lastInstructAt, this.lastTurnFinishedAt);
  }

  snapshot(focusedComposerId?: string | null) {
    const focusId = focusedComposerId ?? this.lastThreadId;
    return {
      running: this.runningFor(focusId),
      active_run_id: this.activeRunId,
      composer_id: focusId,
      thread_title: this.lastThreadTitle,
      last_event_at: this.lastEventAt,
      agent_activity: this.agentActivityFor(focusId),
      activity_composer_id: focusId,
    };
  }

  setThreadMeta(id: string, title?: string) {
    this.lastThreadId = id;
    if (title) {
      this.lastThreadTitle = title;
    }
  }
}
