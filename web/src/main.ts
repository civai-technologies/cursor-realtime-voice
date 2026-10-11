import { loadBridgeConfig } from "./bridge-client";
import { CursorVoiceSession, type CaptionLine, type MicUiState } from "./cursor-voice-session";

const statusEl = document.getElementById("status")!;
const captionsEl = document.getElementById("captions")!;
const startBtn = document.getElementById("startBtn") as HTMLButtonElement;
const endBtn = document.getElementById("endBtn") as HTMLButtonElement;
const stopAgentBtn = document.getElementById("stopAgentBtn") as HTMLButtonElement;
const muteMicBtn = document.getElementById("muteMicBtn") as HTMLButtonElement;
const micHintEl = document.getElementById("micHint")!;
const keyHintEl = document.getElementById("keyHint")!;
const apiKeyInput = document.getElementById("apiKeyInput") as HTMLInputElement;
const saveKeyBtn = document.getElementById("saveKeyBtn") as HTMLButtonElement;

let session: CursorVoiceSession | null = null;
let openaiKeySet = false;

function renderCaptions(lines: CaptionLine[]): void {
  captionsEl.innerHTML = lines
    .map((l) => {
      if (l.role === "tool" && l.toolName) {
        const label = l.text.startsWith("→") ? "result" : "call";
        return `<p class="cap tool tool-${label}"><span class="tool-badge">${escapeHtml(l.toolName)}</span> <span class="tool-${label}-tag">${label}</span> ${escapeHtml(l.text)}</p>`;
      }
      return `<p class="cap ${l.role}"><strong>${l.role}:</strong> ${escapeHtml(l.text)}</p>`;
    })
    .join("");
  captionsEl.scrollTop = captionsEl.scrollHeight;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function updateMicUi(state: MicUiState): void {
  const { userMuted, micEnabled, agentSpeaking } = state;
  muteMicBtn.setAttribute("aria-pressed", userMuted ? "true" : "false");
  if (!session) {
    muteMicBtn.disabled = true;
    muteMicBtn.textContent = "Mute mic";
    micHintEl.hidden = true;
    return;
  }
  muteMicBtn.disabled = false;
  if (userMuted) {
    muteMicBtn.textContent = "Unmute mic";
    micHintEl.hidden = false;
    micHintEl.textContent = "Mic is muted. Unmute to talk (interrupts assistant speech if playing).";
  } else if (agentSpeaking && !micEnabled) {
    muteMicBtn.textContent = "Unmute mic";
    micHintEl.hidden = false;
    micHintEl.textContent = "Assistant speaking — mic auto-muted. Unmute to interrupt.";
  } else {
    muteMicBtn.textContent = "Mute mic";
    micHintEl.hidden = !agentSpeaking;
    if (agentSpeaking) {
      micHintEl.textContent = "Mic auto-muted while the assistant speaks.";
    }
  }
}

async function loadSettings(): Promise<void> {
  try {
    const res = await fetch("/api/settings");
    const d = (await res.json()) as {
      openai_api_key_set?: boolean;
      openai_api_key_hint?: string | null;
    };
    openaiKeySet = Boolean(d.openai_api_key_set);
    if (openaiKeySet && d.openai_api_key_hint) {
      keyHintEl.textContent = `Key saved (${d.openai_api_key_hint}). Enter a new key below to replace it.`;
    } else if (openaiKeySet) {
      keyHintEl.textContent = "Key saved. Enter a new key below to replace it.";
    } else {
      keyHintEl.textContent = "Required for voice. Paste your OpenAI API key and click Save key.";
    }
  } catch {
    keyHintEl.textContent = "Could not load settings — is npm start running?";
  }
}

saveKeyBtn.addEventListener("click", () => {
  void (async () => {
    const api_key = apiKeyInput.value.trim();
    if (!api_key) {
      setStatus("Paste an API key first.");
      return;
    }
    saveKeyBtn.disabled = true;
    try {
      const res = await fetch("/api/settings/openai-api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key }),
      });
      const data = (await res.json()) as { error?: string; openai_api_key_hint?: string };
      if (!res.ok) {
        setStatus(data.error || "Could not save key");
        return;
      }
      apiKeyInput.value = "";
      openaiKeySet = true;
      keyHintEl.textContent = `Key saved (${data.openai_api_key_hint || "sk-…"}).`;
      setStatus("API key saved. Click Start voice.");
      void refreshDiagnosticsBanner();
    } finally {
      saveKeyBtn.disabled = false;
    }
  })();
});

async function refreshDiagnosticsBanner(): Promise<void> {
  try {
    const res = await fetch("/api/diagnostics");
    const d = (await res.json()) as {
      ready?: boolean;
      thread_count?: number;
      transport?: string;
      openai_api_key_set?: boolean;
      fix_steps?: string[];
    };
    if (d.openai_api_key_set === false) {
      setStatus("Add your OpenAI API key in Settings above, then click Start voice.");
      return;
    }
    if (d.ready) {
      const via = d.transport === "extension-composer" ? "extension" : "bridge";
      setStatus(`Ready (${via}) — ${d.thread_count ?? 0} Agent thread(s). Click Start voice.`);
      return;
    }
    const step = d.fix_steps?.[0] || "Install Cursor Voice Bridge extension in Cursor.";
    setStatus(`Not ready: ${step}`);
  } catch {
    setStatus("Cannot reach cursor-voice server — run ./setup.sh or npm start");
  }
}

void loadSettings();
void refreshDiagnosticsBanner();

startBtn.addEventListener("click", () => {
  void (async () => {
    if (!openaiKeySet) {
      const settingsRes = await fetch("/api/settings");
      const s = (await settingsRes.json()) as { openai_api_key_set?: boolean };
      if (!s.openai_api_key_set) {
        setStatus("Save your OpenAI API key in Settings first.");
        return;
      }
      openaiKeySet = true;
    }
    startBtn.disabled = true;
    try {
      const bridge = await loadBridgeConfig();
      session = new CursorVoiceSession(bridge, {
        onStatus: setStatus,
        onCaptions: renderCaptions,
        onError: (m) => setStatus(`Error: ${m}`),
        onMicState: updateMicUi,
      });
      await session.start();
      endBtn.disabled = false;
      stopAgentBtn.disabled = false;
      muteMicBtn.disabled = false;
      updateMicUi(session.getMicUiState());
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
      startBtn.disabled = false;
    }
  })();
});

endBtn.addEventListener("click", () => {
  void (async () => {
    await session?.stop();
    session = null;
    endBtn.disabled = true;
    stopAgentBtn.disabled = true;
    muteMicBtn.disabled = true;
    updateMicUi({ userMuted: false, micEnabled: false, agentSpeaking: false });
    startBtn.disabled = false;
  })();
});

muteMicBtn.addEventListener("click", () => {
  session?.toggleUserMute();
});

stopAgentBtn.addEventListener("click", () => {
  void session?.cancelAgent();
});
