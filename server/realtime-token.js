/**
 * OpenAI Realtime ephemeral token for cursor-voice (WebRTC).
 * Pattern matches SecOps teach-mode realtime_token.js — local OPENAI_API_KEY only.
 */

const REALTIME_VOICE_MODEL = process.env.OPENAI_REALTIME_VOICE_MODEL || 'gpt-realtime-mini';
const REALTIME_SESSION_TTL_SEC = parseInt(process.env.OPENAI_REALTIME_SESSION_TTL_SEC || '900', 10);

const CURSOR_VOICE_TOOLS = [
  {
    type: 'function',
    name: 'cursor_voice_submit_instruction',
    description:
      "Post the user's message into their Cursor IDE Agent (Composer) chat, as if they typed it and pressed Send. " +
      'Call cursor_voice_get_status first when unsure which thread is focused or whether a run is active.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description:
            'Exact user message for Agent chat. First person or direct imperative, same tone as typing in the panel. ' +
            'Never wrap in meta instructions (no "tell the agent", "ask it to", "say hello to the agent"). ' +
            'Bad: "Tell the agent to run tests." Good: "Run the test suite and summarize any failures."',
        },
        thread_id: {
          type: 'string',
          description:
            'Composer thread id from get_status.threads or focused_composer_id. Omit to use the focused Agent chat.',
        },
        policy: {
          type: 'string',
          enum: ['send', 'abort_then_send'],
          description: 'abort_then_send cancels the current run before sending.',
        },
        spoken_summary: {
          type: 'string',
          description:
            'One short spoken line right after submit succeeds (e.g. "Sent." or "Okay, I sent that."). Do not summarize the agent result here; wait for [AGENT_COMPLETE].',
        },
      },
      required: ['text', 'spoken_summary'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'cursor_voice_cancel_run',
    description: 'Stop the in-flight Cursor Agent run. Use when the user interrupts or says stop.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why cancel was requested.' },
        spoken_summary: { type: 'string', description: 'One short line after cancel.' },
      },
      required: ['spoken_summary'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'cursor_voice_wait_for_agent',
    description:
      'Poll until the IDE Agent turn finishes (hooks) or timeout. Use only if hooks may be missing, or the user explicitly asked to wait in the same utterance. ' +
      'Normally rely on [AGENT_COMPLETE] instead of polling.',
    parameters: {
      type: 'object',
      properties: {
        timeout_sec: {
          type: 'number',
          description: 'Max seconds to wait (5-120, default 60).',
        },
        spoken_summary: { type: 'string', description: 'Short line while waiting.' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'cursor_voice_focus_thread',
    description:
      'Focus an Agent chat tab in Cursor by thread id or partial title from get_status.threads. Use when the user names a chat (e.g. "browser GPT") or wants to switch before sending.',
    parameters: {
      type: 'object',
      properties: {
        thread_id: { type: 'string', description: 'Composer id from get_status.threads[].id' },
        title_contains: {
          type: 'string',
          description: 'Case-insensitive substring of threads[].title (e.g. "browser", "GPT"). Use when user describes the chat by name.',
        },
        spoken_summary: { type: 'string', description: 'Short line to say after focus succeeds.' },
      },
      required: ['spoken_summary'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'cursor_voice_get_status',
    description:
      'Read bridge status, agent_activity for the focused Agent tab, and thread list. Use when the user asks what Agent is doing, what it last said, or which chat is focused.',
    parameters: {
      type: 'object',
      properties: {
        spoken_summary: { type: 'string', description: 'Optional short line while checking.' },
      },
      additionalProperties: false,
    },
  },
];

function buildInstructions() {
  return [
    '## Role',
    'You are the user\'s voice link to the same Cursor Agent (Composer) they already use by typing in the IDE. You are not a separate chatbot, therapist, or narrator. Your job is mouth and ears: turn speech into Agent messages, and turn Agent results into short spoken updates.',
    '',
    '## Sending work (text parity)',
    'When the user gives a directive, call cursor_voice_submit_instruction with text written exactly as they would type it in Agent chat. Do not add "tell the agent" or "ask it to".',
    'Example: user says "run tests and tell me what fails" → text: "Run the test suite and summarize any failures."',
    'After submit succeeds: say only spoken_summary (brief ack). Do not guess the agent outcome yet.',
    '',
    '## Real-time results (do not make the user ask)',
    'Hook messages from the IDE arrive as user-role lines you must treat as ground truth:',
    '- [AGENT_UPDATE]: partial or full Agent reply text while or after it is written. Use for accuracy if the user asks mid-run; do not read the whole thing aloud unless they ask.',
    '- [AGENT_COMPLETE]: Agent finished its turn. You MUST speak next: summarize the latest output in plain language (1 to 3 sentences). Do not ask "would you like a summary". Do not say the agent is still working.',
    'If [AGENT_COMPLETE] has body text, base your spoken summary on that. If the user already heard you ack the send, the completion line is the main deliverable.',
    '',
    '## Status and threads',
    'cursor_voice_get_status: trust agent_activity.agent_running (not guesses). agent_running=false means idle even if the user asked recently; use last_agent_message_preview as the last report. preview=none means hooks have no text for the focused tab (wrong tab, hooks off, or no reply yet). Wrong chat? focus_thread then get_status again.',
    'cursor_voice_wait_for_agent: only when hooks seem absent or user explicitly said wait until done. Otherwise wait for [AGENT_COMPLETE].',
    '',
    '## Style and guardrails',
    'Spoken replies: short, conversational, under ~3 sentences unless summarizing a large [AGENT_COMPLETE].',
    'Never claim an instruction was sent until cursor_voice_submit_instruction returns success:true. On failure, say send failed and read the error.',
    'Do not invent thread_id or agent output. Extension bridge (transport extension-composer) is normal.',
    'Route coding and agent work through tools. No generic support small talk unless the user wants that.',
  ].join('\n');
}

function buildSessionConfig() {
  return {
    type: 'realtime',
    model: REALTIME_VOICE_MODEL,
    instructions: buildInstructions(),
    tools: CURSOR_VOICE_TOOLS,
    audio: {
      input: {
        transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.6,
          prefix_padding_ms: 300,
          silence_duration_ms: 1000,
          create_response: true,
        },
      },
      output: {
        voice: process.env.OPENAI_REALTIME_VOICE || 'alloy',
      },
    },
  };
}

async function createEphemeralRealtimeToken() {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    const err = new Error('OPENAI_API_KEY not set: copy .env.example to .env');
    err.statusCode = 503;
    throw err;
  }

  const ttl = Math.min(
    Number.isFinite(REALTIME_SESSION_TTL_SEC) && REALTIME_SESSION_TTL_SEC > 60
      ? REALTIME_SESSION_TTL_SEC
      : 900,
    900
  );

  const payload = {
    expires_after: { anchor: 'created_at', seconds: ttl },
    session: buildSessionConfig(),
  };

  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();
  let data;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    const err = new Error('Invalid response from OpenAI Realtime API');
    err.statusCode = 502;
    throw err;
  }

  if (!response.ok) {
    const err = new Error(data.error?.message || data.detail || rawText || 'OpenAI Realtime token failed');
    err.statusCode = response.status >= 400 && response.status < 600 ? response.status : 502;
    throw err;
  }

  if (!data.value || !data.expires_at || !data.session?.id) {
    const err = new Error('Unexpected OpenAI Realtime token response shape');
    err.statusCode = 502;
    throw err;
  }

  return {
    status: 'success',
    id: data.session.id,
    model: REALTIME_VOICE_MODEL,
    client_secret: {
      value: data.value,
      expires_at: data.expires_at,
    },
    max_session_ms: ttl * 1000,
    tools: CURSOR_VOICE_TOOLS.map((t) => t.name),
  };
}

module.exports = {
  CURSOR_VOICE_TOOLS,
  buildInstructions,
  buildSessionConfig,
  createEphemeralRealtimeToken,
  REALTIME_VOICE_MODEL,
};
