import { execFile } from "child_process";
import * as vscode from "vscode";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const ACCESSIBILITY_SETTINGS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Quick probe: osascript may send keystrokes only if Cursor is allowed under Accessibility. */
async function macAccessibilityAllowsKeystrokes(): Promise<boolean> {
  const probe = `
tell application "System Events"
  tell process "Cursor"
    set frontmost to true
  end tell
end tell
`;
  try {
    await execFileAsync("osascript", ["-e", probe], { timeout: 8000, maxBuffer: 32 * 1024 });
    return true;
  } catch {
    return false;
  }
}

export function openMacAccessibilitySettings(): void {
  void vscode.env.openExternal(vscode.Uri.parse(ACCESSIBILITY_SETTINGS));
}

/**
 * Paste into whatever Agent input is already focused; press Return via macOS Accessibility.
 * Does not switch Agent tabs — click the chat and input first.
 */
export async function submitViaMacAccessibility(text: string): Promise<{ method: string }> {
  if (process.platform !== "darwin") {
    throw new Error("macOS accessibility submit is only available on macOS.");
  }

  const allowed = await macAccessibilityAllowsKeystrokes();
  if (!allowed) {
    openMacAccessibilitySettings();
    throw new Error(
      "macOS blocked simulated keys (error 1002). System Settings → Privacy & Security → Accessibility → turn ON for Cursor, then retry. Settings should have opened."
    );
  }

  await vscode.env.clipboard.writeText(text);

  const script = `
tell application "Cursor" to activate
delay 0.3
tell application "System Events"
  tell process "Cursor"
    keystroke "v" using command down
    delay 0.15
    keystroke return
  end tell
end tell
`;

  try {
    await execFileAsync("osascript", ["-e", script], { timeout: 15000, maxBuffer: 64 * 1024 });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (detail.includes("1002") || detail.toLowerCase().includes("not allowed to send keystrokes")) {
      openMacAccessibilitySettings();
      throw new Error(
        "macOS blocked simulated keys. Enable Cursor under Accessibility in System Settings, then retry."
      );
    }
    throw new Error(`macOS paste+Return failed (${detail}).`);
  }

  await delay(200);
  return { method: "macos-accessibility-paste+Return" };
}
