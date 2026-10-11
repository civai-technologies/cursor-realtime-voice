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
    return [{ id: "active-composer", title: "Active Agent chat" }];
  }

  return ids.map((id) => ({ id, title: "Agent" }));
}

export async function getFocusedComposerId(): Promise<string | null> {
  const cmds = ["composer.getFocusedComposerId", "composer.getActiveComposerId"];
  for (const cmd of cmds) {
    try {
      const raw = await vscode.commands.executeCommand<unknown>(cmd);
      if (typeof raw === "string" && raw.length > 0) {
        return raw;
      }
    } catch {
      // try next
    }
  }
  const threads = await listComposerThreads();
  return threads[0]?.id ?? null;
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

/** Focus a specific Composer thread when Cursor exposes an open-by-id command. */
export async function focusComposerThread(threadId?: string): Promise<string> {
  if (threadId && threadId !== "active-composer") {
    const openAttempts: Array<{ cmd: string; args?: unknown }> = [
      { cmd: "composer.openComposer", args: { composerId: threadId } },
      { cmd: "composer.openComposer", args: threadId },
      { cmd: "composer.focusComposer", args: threadId },
    ];
    for (const { cmd, args } of openAttempts) {
      try {
        await vscode.commands.executeCommand(cmd, args);
        await delay(200);
        return threadId;
      } catch {
        // try next
      }
    }
  }
  await focusComposer();
  await delay(120);
  return (await getFocusedComposerId()) || threadId || "active-composer";
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

async function submitViaPaste(trimmed: string): Promise<{ method: string; threadId?: string }> {
  await vscode.env.clipboard.writeText(trimmed);
  const pasteAttempts = ["composer.pasteText", "editor.action.clipboardPasteAction"];
  for (const pasteCmd of pasteAttempts) {
    try {
      await vscode.commands.executeCommand(pasteCmd);
      await delay(80);
      await vscode.commands.executeCommand("composer.submit");
      const threads = await listComposerThreads();
      return { method: `${pasteCmd}+composer.submit`, threadId: threads[0]?.id };
    } catch {
      // try next paste command
    }
  }
  throw new Error("paste+submit failed");
}

/**
 * Submit a user instruction into the focused (or selected) Agent / Composer chat.
 * Never uses dev-only testOpenWithPrompt (that opens a test dialog, not the real thread).
 */
export async function submitComposerInstruction(
  text: string,
  options?: { abortFirst?: boolean; threadId?: string }
): Promise<{ method: string; threadId: string; warning?: string }> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Instruction text is empty");
  }

  if (options?.abortFirst) {
    await cancelComposerRun();
    await delay(120);
  }

  const threads = await listComposerThreads();
  let targetId = options?.threadId;
  if (targetId && !threads.some((t) => t.id === targetId)) {
    targetId = undefined;
  }
  if (!targetId) {
    targetId = (await getFocusedComposerId()) || threads[0]?.id || "active-composer";
  }

  const resolvedThread = await focusComposerThread(targetId);
  await delay(100);

  const attempts: Array<{ cmd: string; args?: unknown }> = [
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
      return { method: cmd, threadId: resolvedThread };
    } catch (e) {
      lastError = e;
    }
  }

  try {
    const pasted = await submitViaPaste(trimmed);
    return { method: pasted.method, threadId: resolvedThread };
  } catch (e) {
    lastError = e;
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Could not submit to Agent chat (${msg})`);
}
