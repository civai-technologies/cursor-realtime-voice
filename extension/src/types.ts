export type HarnessEventKind =
  | "session_start"
  | "session_end"
  | "tool_start"
  | "tool_end"
  | "assistant_chunk"
  | "instruct_sent"
  | "run_done"
  | "run_cancelled"
  | "error";

export type HarnessEvent = {
  event_id: string;
  ts: string;
  composer_id?: string;
  kind: HarnessEventKind;
  tool_name?: string;
  summary: string;
  detail?: string;
  voice_relevant?: boolean;
};
