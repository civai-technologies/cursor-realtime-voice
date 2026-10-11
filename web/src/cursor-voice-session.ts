import {
  type BridgeConfig,
  bridgeCancel,
  bridgeGetStatus,
  bridgeInstruct,
  openBridgeEventStream,
} from "./bridge-client";

export type CaptionLine = {
  role: "user" | "assistant" | "system" | "agent" | "tool";
  text: string;
  toolName?: string;
};

export type SessionCallbacks = {
  onStatus: (text: string) => void;
  onCaptions: (lines: CaptionLine[]) => void;
  onError: (message: string) => void;
};

const ECHO_RESTORE_MS = 400;

export class CursorVoiceSession {
  private bridge: BridgeConfig;
  private callbacks: SessionCallbacks;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mediaStream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private captions: CaptionLine[] = [];
  private hasActiveResponse = false;
  private queuedResponseCreate = false;
  private userMuted = false;
  private isMuted = false;
  private stopEvents: (() => void) | null = null;
  private finished = false;
  private assistantPartial = "";
  private lastInstructSubmittedAt: string | null = null;

  constructor(bridge: BridgeConfig, callbacks: SessionCallbacks) {
    this.bridge = bridge;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    this.callbacks.onStatus("Requesting microphone…");
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });

    this.callbacks.onStatus("Fetching Realtime token…");
    const tokenRes = await fetch("/api/realtime/ephemeral-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(30_000),
    });
    const tokenData = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenRes.ok || tokenData.status !== "success") {
      if (tokenData.error === "missing_openai_api_key") {
        throw new Error(
          "OpenAI API key missing — enter it in Settings on this page, then click Start voice again."
        );
      }
      throw new Error(
        typeof tokenData.error === "string"
          ? tokenData.error
          : typeof tokenData.message === "string"
            ? tokenData.message
            : "Token request failed"
      );
    }
    const secret = (tokenData.client_secret as { value?: string })?.value;
    if (!secret) {
      throw new Error("Missing client_secret");
    }

    this.callbacks.onStatus("Connecting voice (WebRTC)…");
    void openBridgeEventStream(
      this.bridge,
      (ev) => {
        const summary = typeof ev.summary === "string" ? ev.summary : "";
        if (!summary) return;
        const kind = typeof ev.kind === "string" ? ev.kind : "";
        const voiceRelevant = ev.voice_relevant === true;
        const isInstructEcho =
          kind === "instruct_sent" ||
          (kind === "assistant_chunk" &&
            typeof ev.summary === "string" &&
            /instruction sent/i.test(ev.summary));
        if (isInstructEcho) {
          this.pushCaption("system", summary);
          return;
        }
        const isAgentReply =
          kind === "assistant_chunk" &&
          typeof ev.detail === "string" &&
          ev.detail.length > 0 &&
          !/instruction sent/i.test(summary);
        const isTurnDone = kind === "run_done" || kind === "run_cancelled";
        if (isTurnDone) {
          this.pushCaption("system", summary);
          void this.onAgentTurnComplete(summary);
          return;
        }
        if (isAgentReply) {
          const detail = String(ev.detail).slice(0, 4000);
          const preview = detail.split("\n").find((l) => l.trim())?.slice(0, 500) || detail.slice(0, 500);
          this.pushCaption("agent", preview);
          this.sendUserText(
            `[AGENT_UPDATE] New agent message (use for user questions): ${detail.slice(0, 1500)}`,
            { skipSpokenResponse: true }
          );
          return;
        }
        if (voiceRelevant) {
          this.pushCaption("system", summary);
        }
      },
      () => {
        /* optional progress stream — voice works without it */
      }
    ).then((stop) => {
      this.stopEvents = stop;
    });
    await this.connectWebRtc(secret);
    try {
      const status = await bridgeGetStatus(this.bridge);
      const transport = (status as { transport?: string }).transport;
      const threads = status.threads;
      if (transport === "extension-composer") {
        this.callbacks.onStatus("Live — extension bridge (speak to control Agent)");
      } else if (Array.isArray(threads) && threads.length === 0) {
        this.callbacks.onStatus(
          "Live — install Cursor Voice extension + open Agent, then speak"
        );
      } else {
        this.callbacks.onStatus("Live — speak to control Cursor Agent");
      }
    } catch {
      this.callbacks.onStatus("Live — speak to control Cursor Agent");
    }
  }

  async stop(): Promise<void> {
    this.finished = true;
    this.stopEvents?.();
    this.stopEvents = null;
    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.audioEl) {
      this.audioEl.srcObject = null;
      this.audioEl = null;
    }
    this.callbacks.onStatus("Ended");
  }

  async cancelAgent(): Promise<void> {
    await bridgeCancel(this.bridge);
    this.pushCaption("system", "Cancel sent to IDE");
  }

  private pushCaption(role: CaptionLine["role"], text: string, toolName?: string): void {
    this.captions = [...this.captions.slice(-60), { role, text, toolName }];
    this.callbacks.onCaptions(this.captions);
  }

  private pushToolCall(name: string, argsSummary: string): void {
    this.pushCaption("tool", argsSummary, name);
  }

  private pushToolResult(name: string, resultSummary: string): void {
    this.pushCaption("tool", `→ ${resultSummary}`, name);
  }

  private formatToolArgs(name: string, args: Record<string, unknown>): string {
    if (name === "cursor_voice_submit_instruction") {
      const t = String(args.text || "").slice(0, 200);
      return t.length > 0 ? `text: ${t}${String(args.text).length > 200 ? "…" : ""}` : "submit";
    }
    if (name === "cursor_voice_wait_for_agent") {
      return `timeout_sec: ${args.timeout_sec ?? 60}`;
    }
    return JSON.stringify(args).slice(0, 180);
  }

  private summarizeToolOutput(name: string, output: Record<string, unknown>): string {
    if (output.success === false) {
      return `error: ${String(output.error || output.spoken_summary || "failed")}`;
    }
    if (name === "cursor_voice_get_status") {
      const st = output.status as Record<string, unknown> | undefined;
      const act = st?.agent_activity as Record<string, unknown> | undefined;
      const preview = act?.last_agent_message_preview;
      const running = act?.agent_running;
      return `running=${running} preview=${preview ? String(preview).slice(0, 120) : "—"}`;
    }
    if (name === "cursor_voice_wait_for_agent") {
      const wait = output.wait as Record<string, unknown> | undefined;
      if (wait?.completed) {
        const p = (wait.activity as Record<string, unknown>)?.last_agent_message_preview;
        return `completed: ${p ? String(p).slice(0, 160) : "turn done"}`;
      }
      return wait?.timed_out ? "timed out waiting" : "waiting…";
    }
    if (name === "cursor_voice_submit_instruction") {
      if (output.success === false) {
        return `error: ${String(output.error || "submit failed")}`;
      }
      const r = output.result as Record<string, unknown> | undefined;
      const transport = r?.transport;
      return transport === "extension-composer"
        ? `ok (${String(r?.method || "extension")})`
        : String(output.spoken_summary || "submitted");
    }
    return JSON.stringify(output).slice(0, 200);
  }

  private async onAgentTurnComplete(fallbackSummary: string): Promise<void> {
    try {
      const status = await bridgeGetStatus(this.bridge);
      const act = status.agent_activity as Record<string, unknown> | undefined;
      const preview =
        (act?.last_agent_message_preview as string) ||
        (act?.last_agent_message as string)?.slice(0, 500) ||
        "";
      if (preview) {
        this.pushCaption("agent", preview);
      }
      const msg = preview || fallbackSummary;
      this.sendUserText(
        `[AGENT_COMPLETE] The IDE Agent finished its turn. Latest output: ${msg.slice(0, 2000)}. ` +
          "Briefly tell the user the result in one or two sentences.",
        { skipSpokenResponse: false }
      );
    } catch {
      this.sendUserText(`[AGENT_COMPLETE] ${fallbackSummary}`, { skipSpokenResponse: false });
    }
  }

  private async waitForAgentTurn(timeoutSec: number): Promise<Record<string, unknown>> {
    const timeoutMs = Math.min(Math.max(timeoutSec, 5), 120) * 1000;
    const since = this.lastInstructSubmittedAt || new Date(0).toISOString();
    const start = Date.now();
    let lastPreview: string | null = null;

    while (Date.now() - start < timeoutMs) {
      const status = await bridgeGetStatus(this.bridge);
      const act = (status.agent_activity || {}) as Record<string, unknown>;
      const finishedAt = act.last_turn_finished_at as string | undefined;
      const messageAt = act.last_agent_message_at as string | undefined;
      const preview = act.last_agent_message_preview as string | undefined;
      const running = act.agent_running === true;

      if (preview) {
        lastPreview = preview;
      }

      const finishedAfterInstruct = Boolean(finishedAt && finishedAt > since);
      const newMessageAfterInstruct = Boolean(messageAt && messageAt > since && preview);

      if ((finishedAfterInstruct && !running) || (newMessageAfterInstruct && !running)) {
        return {
          completed: true,
          activity: act,
          last_agent_message_preview: preview || lastPreview,
        };
      }

      await new Promise((r) => setTimeout(r, 1500));
    }

    return {
      completed: false,
      timed_out: true,
      last_seen_preview: lastPreview,
    };
  }

  private sendEvent(payload: Record<string, unknown>): void {
    if (this.dc?.readyState === "open") {
      this.dc.send(JSON.stringify(payload));
    }
  }

  private sendUserText(text: string, opts?: { skipSpokenResponse?: boolean }): void {
    if (this.finished) return;
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    if (!opts?.skipSpokenResponse) {
      this.enqueueResponseCreate();
    }
  }

  private enqueueResponseCreate(): void {
    if (!this.dc || this.dc.readyState !== "open") return;
    if (!this.hasActiveResponse) {
      this.hasActiveResponse = true;
      this.sendEvent({ type: "response.create" });
    } else {
      this.queuedResponseCreate = true;
    }
  }

  private onResponseDone(): void {
    this.hasActiveResponse = false;
    if (this.queuedResponseCreate) {
      this.queuedResponseCreate = false;
      this.enqueueResponseCreate();
    }
  }

  private setMicEnabled(enabled: boolean): void {
    this.mediaStream?.getAudioTracks().forEach((t) => {
      t.enabled = enabled;
    });
    this.isMuted = !enabled;
  }

  private async connectWebRtc(ephemeralKey: string): Promise<void> {
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    this.audioEl = document.createElement("audio");
    this.audioEl.autoplay = true;
    this.audioEl.setAttribute("playsinline", "true");
    document.body.appendChild(this.audioEl);
    this.pc.ontrack = (e) => {
      if (this.audioEl) {
        this.audioEl.srcObject = e.streams[0];
      }
    };

    this.mediaStream?.getTracks().forEach((track) => {
      this.pc!.addTrack(track, this.mediaStream!);
    });

    this.dc = this.pc.createDataChannel("oai-events");
    this.dc.onmessage = (msg) => {
      void this.onDataChannelMessage(String(msg.data));
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc?.connectionState === "failed") {
        this.callbacks.onError("WebRTC connection failed");
      }
    };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp || "",
    });
    if (!sdpRes.ok) {
      throw new Error(`Realtime call failed: ${sdpRes.status}`);
    }
    const answer = await sdpRes.text();
    await this.pc.setRemoteDescription({ type: "answer", sdp: answer });

    this.sendUserText(
      "Voice session started. The user will speak to control their Cursor IDE Agent. Use cursor_voice_* tools for actions.",
      { skipSpokenResponse: true }
    );
  }

  private normalizeFunctionCall(raw: Record<string, unknown> | undefined): {
    name: string;
    args: string;
    callId: string;
  } | null {
    if (!raw) return null;
    const name = raw.name;
    const callId = raw.call_id ?? raw.id;
    const argsRaw = raw.arguments ?? raw.args ?? "{}";
    if (typeof name !== "string" || !name) return null;
    if (typeof callId !== "string" || !callId) return null;
    const args = typeof argsRaw === "string" ? argsRaw : JSON.stringify(argsRaw);
    return { name, args, callId };
  }

  private async onDataChannelMessage(raw: string): Promise<void> {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = event.type;
    if (type === "response.done") {
      const resp = event.response as Record<string, unknown> | undefined;
      const output = resp?.output as unknown;
      if (Array.isArray(output)) {
        const fc = output.find((o) => (o as { type?: string }).type === "function_call") as
          | Record<string, unknown>
          | undefined;
        const norm = this.normalizeFunctionCall(fc);
        if (norm) {
          await this.handleTool(norm.name, norm.args, norm.callId);
        }
      }
      this.assistantPartial = "";
      this.onResponseDone();
    }
    if (type === "function_call") {
      const norm = this.normalizeFunctionCall(event.function_call as Record<string, unknown>);
      if (norm) {
        await this.handleTool(norm.name, norm.args, norm.callId);
      }
    }
    if (type === "output_audio_buffer.started") {
      if (!this.userMuted) {
        this.setMicEnabled(false);
      }
    }
    if (type === "output_audio_buffer.stopped") {
      setTimeout(() => {
        if (!this.userMuted && !this.finished) {
          this.setMicEnabled(true);
        }
      }, ECHO_RESTORE_MS);
    }
    if (type === "response.audio_transcript.delta" || type === "response.output_audio_transcript.delta") {
      const delta = event.delta;
      if (typeof delta === "string") {
        this.assistantPartial += delta;
        const head =
          this.captions.length > 0 && this.captions[this.captions.length - 1].role === "assistant"
            ? this.captions.slice(0, -1)
            : this.captions;
        this.captions = [...head, { role: "assistant", text: this.assistantPartial }];
        this.callbacks.onCaptions(this.captions);
      }
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcript = (event as { transcript?: string }).transcript;
      if (typeof transcript === "string") {
        this.pushCaption("user", transcript);
      }
    }
  }

  private async handleTool(name: string, argsRaw: unknown, callId: string): Promise<void> {
    let args: Record<string, unknown> = {};
    try {
      args =
        typeof argsRaw === "string"
          ? (JSON.parse(argsRaw) as Record<string, unknown>)
          : (argsRaw as Record<string, unknown>) || {};
    } catch {
      args = {};
    }
    this.pushToolCall(name, this.formatToolArgs(name, args));

    let output: Record<string, unknown> = { success: false, error: "unknown tool" };

    try {
      if (name === "cursor_voice_get_status") {
        const status = await bridgeGetStatus(this.bridge);
        output = { success: true, status, spoken_summary: args.spoken_summary || "Checked IDE status." };
      } else if (name === "cursor_voice_cancel_run") {
        await bridgeCancel(this.bridge);
        output = {
          success: true,
          spoken_summary: args.spoken_summary || "Stopped the agent run.",
        };
      } else if (name === "cursor_voice_submit_instruction") {
        const text = String(args.text || "");
        const policy = args.policy === "abort_then_send" ? "abort_then_send" : "send";
        const result = await bridgeInstruct(this.bridge, {
          text,
          thread_id: typeof args.thread_id === "string" ? args.thread_id : undefined,
          policy,
        });
        this.lastInstructSubmittedAt = new Date().toISOString();
        output = {
          success: true,
          result,
          spoken_summary:
            (typeof args.spoken_summary === "string" && args.spoken_summary) ||
            "Sent your instruction to Cursor.",
        };
      } else if (name === "cursor_voice_wait_for_agent") {
        const timeout = typeof args.timeout_sec === "number" ? args.timeout_sec : 60;
        const wait = await this.waitForAgentTurn(timeout);
        output = {
          success: true,
          wait,
          spoken_summary:
            wait.completed && (wait as { last_agent_message_preview?: string }).last_agent_message_preview
              ? String((wait as { last_agent_message_preview?: string }).last_agent_message_preview).slice(
                  0,
                  200
                )
              : wait.timed_out
                ? "Still working or no hook update yet."
                : "Agent turn completed.",
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      output = {
        success: false,
        error: msg,
        spoken_summary: msg.includes("API key")
          ? msg
          : msg.includes("Agent")
            ? msg
            : `Could not reach Cursor: ${msg}`,
      };
    }

    this.pushToolResult(name, this.summarizeToolOutput(name, output));

    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output),
      },
    });
    this.enqueueResponseCreate();
  }
}
