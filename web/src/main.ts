import { loadBridgeConfig } from "./bridge-client";
import { CursorVoiceSession, type CaptionLine, type MicUiState } from "./cursor-voice-session";

const statusBarEl = document.querySelector(".status-bar") as HTMLElement;
const statusEl = document.getElementById("status")!;
const captionsEl = document.getElementById("captions")!;
const voiceOrbBtn = document.getElementById("voiceOrbBtn") as HTMLButtonElement;
const voiceOrbCaption = document.getElementById("voiceOrbCaption")!;
const voiceOrbHint = document.getElementById("voiceOrbHint")!;
const voiceSecondary = document.getElementById("voiceSecondary")!;
const stopAgentBtn = document.getElementById("stopAgentBtn") as HTMLButtonElement;
const endSessionBtn = document.getElementById("endSessionBtn") as HTMLButtonElement;
const keyHintEl = document.getElementById("keyHint")!;
const apiKeyInput = document.getElementById("apiKeyInput") as HTMLInputElement;
const saveKeyBtn = document.getElementById("saveKeyBtn") as HTMLButtonElement;
const settingsModal = document.getElementById("settingsModal") as HTMLDialogElement;
const openSettingsBtn = document.getElementById("openSettingsBtn") as HTMLButtonElement;
const closeSettingsBtn = document.getElementById("closeSettingsBtn") as HTMLButtonElement;
const keyPillEl = document.getElementById("keyPill") as HTMLElement;

const LONG_PRESS_MS = 700;

let session: CursorVoiceSession | null = null;
let openaiKeySet = false;
let transcriptLines: CaptionLine[] = [];

function formatTranscriptPlain(lines: CaptionLine[]): string {
  return lines
    .map((l) => {
      if (l.role === "tool" && l.toolName) {
        return `[tool ${l.toolName}] ${l.text}`;
      }
      return `${l.role}: ${l.text}`;
    })
    .join("\n\n");
}

const copyTranscriptBtn = document.getElementById("copyTranscriptBtn") as HTMLButtonElement;
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressTriggered = false;

function renderCaptions(lines: CaptionLine[]): void {
  transcriptLines = lines;
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

type StatusState = "idle" | "ready" | "live" | "error";

function inferStatusState(text: string): StatusState {
  const lower = text.toLowerCase();
  if (lower.startsWith("error:") || lower.includes("not ready") || lower.includes("cannot reach")) {
    return "error";
  }
  if (
    lower.includes("listening") ||
    lower.includes("connected") ||
    lower.includes("speaking") ||
    lower.startsWith("live")
  ) {
    return "live";
  }
  if (lower.includes("ready") || lower.includes("saved") || lower.includes("tap")) {
    return "ready";
  }
  return "idle";
}

function setStatus(text: string, state?: StatusState): void {
  statusEl.textContent = text;
  statusBarEl.dataset.state = state ?? inferStatusState(text);
}

type OrbVisual = "idle" | "connecting" | "live" | "muted";

function setOrbVisual(mode: OrbVisual): void {
  voiceOrbBtn.classList.remove("voice-orb--idle", "voice-orb--connecting", "voice-orb--live", "voice-orb--muted");
  voiceOrbBtn.classList.add(`voice-orb--${mode}`);
}

function resetVoiceUi(): void {
  session = null;
  setOrbVisual("idle");
  voiceOrbBtn.disabled = false;
  voiceOrbBtn.setAttribute("aria-pressed", "false");
  voiceOrbBtn.setAttribute("aria-label", "Start voice session");
  voiceOrbCaption.textContent = "Tap to start voice";
  voiceOrbHint.hidden = true;
  voiceSecondary.hidden = true;
  stopAgentBtn.disabled = true;
  endSessionBtn.disabled = true;
}

function updateMicUi(state: MicUiState): void {
  if (!session) {
    return;
  }
  const { userMuted, micEnabled, agentSpeaking } = state;
  const effectivelyMuted = userMuted || !micEnabled;

  if (effectivelyMuted) {
    setOrbVisual("muted");
    voiceOrbBtn.setAttribute("aria-pressed", "true");
    voiceOrbBtn.setAttribute("aria-label", "Unmute microphone");
    if (userMuted) {
      voiceOrbCaption.textContent = "Mic muted";
      voiceOrbHint.hidden = false;
      voiceOrbHint.textContent = "Tap to unmute. Hold the button to end session.";
    } else if (agentSpeaking) {
      voiceOrbCaption.textContent = "Assistant speaking";
      voiceOrbHint.hidden = false;
      voiceOrbHint.textContent = "Tap to interrupt and talk. Hold to end session.";
    } else {
      voiceOrbCaption.textContent = "Mic off";
      voiceOrbHint.hidden = false;
      voiceOrbHint.textContent = "Tap to turn the mic on. Hold to end session.";
    }
  } else {
    setOrbVisual("live");
    voiceOrbBtn.setAttribute("aria-pressed", "false");
    voiceOrbBtn.setAttribute("aria-label", "Mute microphone");
    voiceOrbCaption.textContent = "Listening";
    voiceOrbHint.hidden = false;
    voiceOrbHint.textContent = "Tap to mute. Hold to end session.";
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
    keyPillEl.hidden = !openaiKeySet;
    if (openaiKeySet && d.openai_api_key_hint) {
      keyHintEl.textContent = `Key saved (${d.openai_api_key_hint}). Enter a new key below to replace it.`;
    } else if (openaiKeySet) {
      keyHintEl.textContent = "Key saved. Enter a new key below to replace it.";
    } else {
      keyHintEl.textContent = "Required for voice. Paste your OpenAI API key and click Save key.";
    }
  } catch {
    keyHintEl.textContent = "Could not load settings. Is npm start running?";
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
      keyPillEl.hidden = false;
      keyHintEl.textContent = `Key saved (${data.openai_api_key_hint || "sk-…"}).`;
      setStatus("API key saved. Tap the voice button to start.");
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
      setStatus("Add your OpenAI API key in Settings, then tap the voice button.");
      return;
    }
    if (d.ready) {
      const via = d.transport === "extension-composer" ? "extension" : "bridge";
      setStatus(`Ready (${via}): ${d.thread_count ?? 0} Agent thread(s). Tap the voice button.`);
      return;
    }
    const step = d.fix_steps?.[0] || "Install Cursor Voice Bridge extension in Cursor.";
    setStatus(`Not ready: ${step}`);
  } catch {
    setStatus("Cannot reach cursor-voice server. Run ./setup.sh or npm start.");
  }
}

function openSettingsModal(): void {
  settingsModal.showModal();
  apiKeyInput.focus();
}

function closeSettingsModal(): void {
  if (settingsModal.open) {
    settingsModal.close();
  }
}

openSettingsBtn.addEventListener("click", () => openSettingsModal());
closeSettingsBtn.addEventListener("click", () => closeSettingsModal());
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) {
    closeSettingsModal();
  }
});
settingsModal.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeSettingsModal();
});

async function startVoiceSession(): Promise<void> {
  if (!openaiKeySet) {
    const settingsRes = await fetch("/api/settings");
    const s = (await settingsRes.json()) as { openai_api_key_set?: boolean };
    if (!s.openai_api_key_set) {
      setStatus("Save your OpenAI API key in Settings first.");
      openSettingsModal();
      return;
    }
    openaiKeySet = true;
  }

  setOrbVisual("connecting");
  voiceOrbBtn.disabled = true;
  voiceOrbCaption.textContent = "Connecting…";

  try {
    const bridge = await loadBridgeConfig();
    session = new CursorVoiceSession(bridge, {
      onStatus: setStatus,
      onCaptions: renderCaptions,
      onError: (m) => setStatus(`Error: ${m}`),
      onMicState: updateMicUi,
    });
    await session.start();
    voiceOrbBtn.disabled = false;
    voiceSecondary.hidden = false;
    stopAgentBtn.disabled = false;
    endSessionBtn.disabled = false;
    setStatus("Voice connected. Speak when the mic is on.", "live");
    updateMicUi(session.getMicUiState());
  } catch (e) {
    resetVoiceUi();
    setStatus(e instanceof Error ? e.message : String(e), "error");
  }
}

async function endVoiceSession(): Promise<void> {
  await session?.stop();
  resetVoiceUi();
  void refreshDiagnosticsBanner();
}

function clearLongPressTimer(): void {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

voiceOrbBtn.addEventListener("pointerdown", () => {
  if (!session) {
    return;
  }
  longPressTriggered = false;
  clearLongPressTimer();
  longPressTimer = setTimeout(() => {
    longPressTriggered = true;
    void endVoiceSession();
  }, LONG_PRESS_MS);
});

voiceOrbBtn.addEventListener("pointerup", () => {
  clearLongPressTimer();
});

voiceOrbBtn.addEventListener("pointerleave", () => {
  clearLongPressTimer();
});

voiceOrbBtn.addEventListener("pointercancel", () => {
  clearLongPressTimer();
});

voiceOrbBtn.addEventListener("click", () => {
  if (longPressTriggered) {
    longPressTriggered = false;
    return;
  }
  if (!session) {
    void startVoiceSession();
    return;
  }
  session.toggleUserMute();
});

endSessionBtn.addEventListener("click", () => {
  void endVoiceSession();
});

stopAgentBtn.addEventListener("click", () => {
  void session?.cancelAgent();
});

copyTranscriptBtn.addEventListener("click", () => {
  void (async () => {
    const text = formatTranscriptPlain(transcriptLines);
    if (!text.trim()) {
      setStatus("Nothing to copy yet. Start voice or wait for messages.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      const prev = copyTranscriptBtn.textContent;
      copyTranscriptBtn.textContent = "Copied";
      setTimeout(() => {
        copyTranscriptBtn.textContent = prev;
      }, 1600);
    } catch {
      setStatus("Could not copy. Allow clipboard access for this page.");
    }
  })();
});

void loadSettings();
void refreshDiagnosticsBanner();
