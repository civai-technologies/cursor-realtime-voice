import * as vscode from "vscode";

export type ComposerThread = {
  id: string;
  title?: string;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** List Agent / Composer thread ids visible to the focused window (no desktop CLI). */
export async function listComposerThreads(): Promise<ComposerThread[]> {
  const ids: string[] = [];
  try {
    const raw = await vscode.commands.executeCommand<unknown>("composer.getOrderedSelectedComposerIds");
    if (Array.isArray(raw)) {
      for (const id of raw) {
        if (typeof id === "string" && id.length > 0) {
          ids.push(id);
        }
      }
    }
  } catch {
    // command missing on older builds
  }

  if (ids.length === 0) {
    // Active chat may still exist; treat focused composer as one logical thread.
    return [{ id: "active-composer", title: "Active Agent chat" }];
  }

  return ids.map((id) => ({ id, title: "Agent" }));
}

export async function focusComposer(): Promise<void> {
  const focusCommands = [
    "composer.focusComposer",
    "workbench.action.chat.open",
    "aichat.view",
  ];
  for (const cmd of focusCommands) {
    try {
      await vscode.commands.executeCommand(cmd);
      return;
    } catch {
      // try next
    }
  }
}

export async function cancelComposerRun(): Promise<void> {
  const cmds = [
    "composer.cancelChat",
    "composer.cancelComposerStep",
    "composer.submitChat.abortChatAndWaitForFinish",
  ];
  for (const cmd of cmds) {
    try {
      await vscode.commands.executeCommand(cmd);
    } catch {
      // optional
    }
  }
}

/**
 * Submit a full user instruction into the focused Agent / Composer chat.
 * Uses Cursor command IDs (in-process), not `cursor desktop` CLI.
 */
export async function submitComposerInstruction(
  text: string,
  options?: { abortFirst?: boolean }
): Promise<{ method: string; threadId?: string }> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Instruction text is empty");
  }

  if (options?.abortFirst) {
    await cancelComposerRun();
    await delay(120);
  }

  await focusComposer();
  await delay(100);

  const attempts: Array<{ cmd: string; args?: unknown }> = [
    { cmd: "workbench.action.chat.testOpenWithPrompt", args: { prompt: trimmed } },
    { cmd: "workbench.action.chat.testOpenWithPrompt", args: trimmed },
    { cmd: "composer.startComposerPrompt2", args: { prompt: trimmed } },
    { cmd: "composer.startComposerPrompt2", args: trimmed },
    { cmd: "composer.startComposerPrompt", args: trimmed },
    { cmd: "aichat.newfollowupaction", args: trimmed },
  ];

  let lastError: unknown;
  for (const { cmd, args } of attempts) {
    try {
      if (args === undefined) {
        await vscode.commands.executeCommand(cmd);
      } else {
        await vscode.commands.executeCommand(cmd, args);
      }
      const threads = await listComposerThreads();
      return { method: cmd, threadId: threads[0]?.id };
    } catch (e) {
      lastError = e;
    }
  }

  await vscode.env.clipboard.writeText(trimmed);
  const pasteAttempts = ["composer.pasteText", "editor.action.clipboardPasteAction"];
  for (const pasteCmd of pasteAttempts) {
    try {
      await vscode.commands.executeCommand(pasteCmd);
      await delay(50);
      await vscode.commands.executeCommand("composer.submit");
      const threads = await listComposerThreads();
      return { method: `${pasteCmd}+composer.submit`, threadId: threads[0]?.id };
    } catch (e) {
      lastError = e;
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Could not submit to Agent chat (${msg})`);
}
