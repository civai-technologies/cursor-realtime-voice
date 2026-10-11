import * as http from "http";
import * as vscode from "vscode";
import { BridgeServer } from "./bridgeServer";
import { BridgeState } from "./bridgeState";
import { submitComposerInstruction } from "./composerInstruct";
import { openMacAccessibilitySettings } from "./composerSubmitMac";
import { VoiceServerManager } from "./voiceServerManager";

const state = new BridgeState();
let bridge: BridgeServer | null = null;
let voiceServer: VoiceServerManager | null = null;
const BRIDGE_WATCH_MS = 20000;
const VOICE_WATCH_MS = 30000;

async function verifyBridgeHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: "/v1/health", method: "GET", timeout: 3000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

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

/** If the HTTP server died but the extension host is still alive, bring the bridge back without a modal. */
async function reviveBridgeIfDead(): Promise<void> {
  if (!bridge) {
    return;
  }
  const cfg = bridge.getConfig();
  if (!cfg) {
    return;
  }
  const ok = await verifyBridgeHealth(cfg.port);
  if (ok) {
    return;
  }
  try {
    await bridge.stop();
    bridge = new BridgeServer(state);
    const newCfg = await bridge.start();
    await verifyBridgeHealth(newCfg.port);
  } catch {
    // next watchdog tick will retry
  }
}

async function ensureVoiceServer(): Promise<VoiceServerManager> {
  if (!voiceServer) {
    voiceServer = new VoiceServerManager();
  }
  const result = await voiceServer.ensureRunning();
  if (result.ok) {
    vscode.window.setStatusBarMessage(result.message, 6000);
  }
  return voiceServer;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await ensureBridge();
  void ensureVoiceServer().then((vs) => {
    voiceServer = vs;
  });

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

  const extVersion = context.extension.packageJSON.version ?? "?";

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorVoiceBridge.testSubmit", async () => {
      const text =
        "CURSOR-VOICE-TEST: If you see a new user bubble in the thread below (not only text in the input box), submit works.";
      try {
        const result = await submitComposerInstruction(text);
        void vscode.window.showInformationMessage(
          `Cursor Voice v${extVersion}: sent via ${result.method}. Confirm a new user bubble appears below (not only text left in the input).`,
          { modal: true }
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const accessibility =
          msg.includes("1002") ||
          msg.toLowerCase().includes("accessibility") ||
          msg.toLowerCase().includes("simulated keys");
        if (accessibility) {
          void vscode.window
            .showErrorMessage(`Cursor Voice v${extVersion}: ${msg}`, { modal: true }, "Open Accessibility Settings")
            .then((choice) => {
              if (choice === "Open Accessibility Settings") {
                openMacAccessibilitySettings();
              }
            });
        } else {
          void vscode.window.showErrorMessage(`Cursor Voice v${extVersion} submit failed: ${msg}`, { modal: true });
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorVoiceBridge.restart", async () => {
      try {
        if (bridge) {
          await bridge.stop();
        }
        bridge = new BridgeServer(state);
        const cfg = await bridge.start();
        const ok = await verifyBridgeHealth(cfg.port);
        if (!ok) {
          void vscode.window.showErrorMessage(
            `Cursor Voice: bridge wrote port ${cfg.port} but health check failed. Try “Cursor Voice: Reload extension”.`
          );
          return;
        }
        void vscode.window.showInformationMessage(
          `Cursor Voice bridge is live on 127.0.0.1:${cfg.port} (config updated).`,
          { modal: true }
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        void vscode.window.showErrorMessage(`Cursor Voice restart failed: ${msg}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorVoiceBridge.reloadExtensionHost", async () => {
      await vscode.commands.executeCommand("workbench.action.restartExtensionHost");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("cursorVoiceBridge.openVoiceUi", async () => {
      const vs = await ensureVoiceServer();
      const result = await vs.ensureRunning();
      if (!result.ok) {
        void vscode.window.showErrorMessage(`Cursor Voice: ${result.message}`, { modal: true });
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(vs.url));
    })
  );

  const watch = setInterval(() => {
    void reviveBridgeIfDead();
  }, BRIDGE_WATCH_MS);
  const voiceWatch = setInterval(() => {
    void ensureVoiceServer();
  }, VOICE_WATCH_MS);
  context.subscriptions.push({
    dispose: () => {
      clearInterval(watch);
      clearInterval(voiceWatch);
      void bridge?.stop();
      void voiceServer?.stop();
    },
  });
}

export function deactivate(): void {
  void bridge?.stop();
  void voiceServer?.stop();
}
