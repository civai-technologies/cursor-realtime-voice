export type ThreadActivitySlot = {
  lastAgentMessage: string | null;
  lastAgentMessageAt: string | null;
  lastTurnFinishedAt: string | null;
  lastInstructAt: string | null;
  running: boolean;
};

export function emptyThreadSlot(): ThreadActivitySlot {
  return {
    lastAgentMessage: null,
    lastAgentMessageAt: null,
    lastTurnFinishedAt: null,
    lastInstructAt: null,
    running: false,
  };
}

/** Hooks can miss run_done; if a turn finished after the last instruct, do not report running. */
export function deriveAgentRunning(
  slot: ThreadActivitySlot | undefined,
  globalRunning: boolean,
  globalLastInstructAt: string | null,
  globalLastTurnFinishedAt: string | null
): boolean {
  const raw = Boolean(slot?.running || globalRunning);
  if (!raw) {
    return false;
  }
  const lastInstruct = slot?.lastInstructAt ?? globalLastInstructAt;
  if (!lastInstruct) {
    return false;
  }
  const lastDone = slot?.lastTurnFinishedAt ?? globalLastTurnFinishedAt;
  if (lastDone && lastInstruct && lastDone >= lastInstruct) {
    return false;
  }
  return true;
}

export function isVoiceOrServerEcho(text: string): boolean {
  return /127\.0\.0\.1:8787|cursor-voice-server|Start voice|cursor_voice_/i.test(text);
}

export function formatActivityPreview(message: string | null): string | null {
  if (!message) {
    return null;
  }
  return (
    message.split("\n").find((l) => l.trim())?.slice(0, 280) || message.slice(0, 280)
  );
}

export function activityPayloadFromSlot(
  slot: ThreadActivitySlot,
  globalRunning: boolean,
  globalLastInstructAt: string | null,
  globalLastTurnFinishedAt: string | null
) {
  return {
    last_agent_message_preview: formatActivityPreview(slot.lastAgentMessage),
    last_agent_message: slot.lastAgentMessage ? slot.lastAgentMessage.slice(0, 4000) : null,
    last_agent_message_at: slot.lastAgentMessageAt,
    last_turn_finished_at: slot.lastTurnFinishedAt,
    last_instruct_at: slot.lastInstructAt ?? globalLastInstructAt,
    agent_running: deriveAgentRunning(
      slot,
      globalRunning,
      globalLastInstructAt,
      globalLastTurnFinishedAt
    ),
  };
}
