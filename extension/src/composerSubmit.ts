import * as vscode from "vscode";
import { runtimeRepairDesktopBridgeGate } from "./bridgeGateRepair";
import { readBridgeInvocationToken } from "./bridgeSendAuth";
import { submitViaMacAccessibility } from "./composerSubmitMac";

type SendOutcome = {
  outcome?: string;
  message?: string;
};

type ListThreadRow = { id: string; windowId?: number };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitViaBridgeCommand(
  trimmed: string,
  threadId: string,
  bridgeInvocationToken: string
): Promise<{ method: string } | null> {
  let windowId = 1;
  for (const candidate of [1, 2, 3]) {
    try {
      const rows = await vscode.commands.executeCommand<ListThreadRow[] | undefined>(
        "composer.desktopBridge.listThreads",
        { windowId: candidate, bridgeInvocationToken }
      );
      if (Array.isArray(rows) && rows.length > 0) {
        windowId = rows.find((r) => typeof r.windowId === "number")?.windowId ?? candidate;
        break;
      }
    } catch {
      // try next window id
    }
  }

  const result = await vscode.commands.executeCommand<SendOutcome | undefined>(
    "composer.desktopBridge.sendMessage",
    {
      windowId,
      bridgeInvocationToken,
      threadId,
      text: trimmed,
      force: true,
    }
  );

  const outcome = result?.outcome;
  if (outcome === "submitted" || outcome === "queued") {
    return { method: "composer.desktopBridge.sendMessage" };
  }

  const msg = result?.message ?? "";
  if (msg.toLowerCase().includes("disabled") || outcome === "error") {
    return null;
  }

  const detail = msg ? ` ${msg}` : "";
  throw new Error(`Agent send failed (${outcome ?? "no response"})${detail}`);
}

/**
 * Submit to the focused Agent thread via Cursor's in-IDE `composer.desktopBridge.sendMessage`
 * (same path as the Send button; not the terminal `cursor desktop` CLI).
 */
export async function submitAgentMessage(text: string, threadId: string): Promise<{ method: string }> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Instruction text is empty");
  }

  const bridgeInvocationToken = await readBridgeInvocationToken();
  if (!bridgeInvocationToken) {
    throw new Error(
      "Missing bridge token in Cursor storage. Reload the window, focus Agent chat, then retry."
    );
  }

  let bridged = await submitViaBridgeCommand(trimmed, threadId, bridgeInvocationToken);
  if (bridged) {
    return bridged;
  }

  await runtimeRepairDesktopBridgeGate();
  await delay(400);
  bridged = await submitViaBridgeCommand(trimmed, threadId, bridgeInvocationToken);
  if (bridged) {
    return bridged;
  }

  if (process.platform === "darwin") {
    return submitViaMacAccessibility(trimmed);
  }

  throw new Error(
    "Agent send is blocked (Cursor desktop_bridge experiment is off). " +
      "On macOS, enable Accessibility for Cursor and retry, or Cmd+Q Cursor and run " +
      "python3 scripts/enable-desktop-bridge.py from the cursor-voice repo, then reopen."
  );
}
