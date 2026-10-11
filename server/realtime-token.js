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
      "Send a new instruction to the user's Cursor IDE Agent chat. " +
      'Call cursor_voice_get_status first when unsure if a run is active. ' +
      'Keep spoken_summary short (one sentence).',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Full instruction for the IDE agent.' },
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
          description: 'One short line to say after submit succeeds.',
        },
      },
      required: ['text', 'spoken_summary'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'cursor_voice_cancel_run',
    description: 'Stop the in-flight Cursor Agent run. Use when the user interrupts.',
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
      'After submit_instruction, poll until the IDE Agent turn finishes (hooks) or timeout. ' +
      'Use when the user says they are waiting or wants the result — do not guess still running.',
    parameters: {
      type: 'object',
      properties: {
        timeout_sec: {
          type: 'number',
          description: 'Max seconds to wait (5–120, default 60).',
        },
        spoken_summary: { type: 'string', description: 'Short line while waiting.' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'cursor_voice_get_status',
    description:
      'Read bridge status, agent_activity (last agent reply preview from hooks), and thread list. ' +
      'When the user asks what the agent said or what finished, read agent_activity first — do not claim connection failure if status succeeds.',
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
    'You are a voice copilot for Cursor IDE. You control the IDE by calling tools only — you cannot see the screen.',
    'To send work: cursor_voice_get_status, then cursor_voice_submit_instruction with the full instruction text.',
    'When the user asks what the Agent did, said, or whether a turn finished: call cursor_voice_get_status and read agent_activity. If user is waiting after you submitted work, call cursor_voice_wait_for_agent (60s) then summarize last_agent_message_preview.',
    'When [AGENT_COMPLETE] arrives, speak the agent result to the user — do not say still working.',
    'Lines tagged [AGENT_UPDATE] are hook-fed agent text — ground truth for recent output.',
    'Do not say "connection issue" when get_status or submit returns success:true.',
    'Never tell the user an instruction was sent until cursor_voice_submit_instruction returns success:true. If success:false, say the send failed (read error) and suggest reloading the Cursor window — do not say you are waiting for the agent.',
    'Extension bridge (transport extension-composer) is normal — no desktop CLI required.',
    'Keep spoken replies under two sentences. Never invent thread_id.',
    'Voice submit posts into the Cursor Agent (Composer) panel — not email or a hidden thread. After submit, tell the user to look at Agent in Cursor. Use get_status.threads and focused_composer_id to explain which composer id was targeted.',
    'Never claim a message was delivered to a "thread" the user cannot see. If submit method was a dev test command or user disputes delivery, say to check the Agent panel and offer to resubmit with an explicit thread_id from get_status.',
  ].join('\n\n');
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
    const err = new Error('OPENAI_API_KEY not set — copy .env.example to .env');
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
