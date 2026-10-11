import * as vscode from "vscode";
import { BridgeServer } from "./bridgeServer";
import { BridgeState } from "./bridgeState";
import { submitComposerInstruction } from "./composerInstruct";

const state = new BridgeState();
let bridge: BridgeServer | null = null;

async function ensureBridge(): Promise<BridgeServer> {
  if (!bridge) {
    bridge = new BridgeServer(state);
  }
  if (!bridge.getConfig()) {
    const cfg = await bridge.start();
    vscode.window.setStatusBarMessage(`Cursor Voice bridge on 127.0.0.1:${cfg.port}`, 8000);
  }
  return bridge;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await ensureBridge();

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorVoiceBridge.showStatus", async () => {
      const b = await ensureBridge();
      const cfg = b.getConfig();
      const snap = state.snapshot();
      void vscode.window.showInformationMessage(
        `Cursor Voice bridge port ${cfg?.port ?? "?"} · running=${snap.running} · thread=${snap.composer_id ?? "none"}`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorVoiceBridge.testSubmit", async () => {
      const text =
        (await vscode.window.showInputBox({
          prompt: "Test instruction to send to Agent (extension path, no desktop CLI)",
          value: "Reply with exactly: EXTENSION-BRIDGE-OK",
        })) || "";
      if (!text.trim()) {
        return;
      }
      try {
        const result = await submitComposerInstruction(text.trim());
        void vscode.window.showInformationMessage(
          `Cursor Voice: submitted via ${result.method}${result.threadId ? ` (${result.threadId})` : ""}`
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        void vscode.window.showErrorMessage(`Cursor Voice submit failed: ${msg}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorVoiceBridge.restart", async () => {
      if (bridge) {
        await bridge.stop();
      }
      bridge = new BridgeServer(state);
      const cfg = await bridge.start();
      void vscode.window.showInformationMessage(`Cursor Voice bridge restarted on port ${cfg.port}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorVoiceBridge.reloadExtensionHost", async () => {
      await vscode.commands.executeCommand("workbench.action.restartExtensionHost");
    })
  );

  context.subscriptions.push({
    dispose: () => {
      void bridge?.stop();
    },
  });
}

export function deactivate(): void {
  void bridge?.stop();
}
