import * as vscode from "vscode";
import { listComposerThreadsDetailed } from "./composerThreadMeta";
import { submitAgentMessage } from "./composerSubmit";

export type ComposerThread = {
  id: string;
  title?: string;
  focused?: boolean;
  status?: string;
};

const FORBIDDEN_FOCUS_COMMANDS = new Set([
  "workbench.action.chat.open",
  "workbench.action.chat.testOpenWithPrompt",
]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** List Agent / Composer thread ids visible to the focused window. */
export async function listComposerThreads(): Promise<ComposerThread[]> {
  const detailed = await listComposerThreadsDetailed();
  return detailed.map((t) => ({ id: t.id, title: t.title, focused: t.focused, status: t.status }));
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

async function runComposerCommand(cmd: string, args?: unknown): Promise<void> {
  if (FORBIDDEN_FOCUS_COMMANDS.has(cmd)) {
    throw new Error(`Forbidden command: ${cmd}`);
  }
  if (args === undefined) {
    await vscode.commands.executeCommand(cmd);
  } else {
    await vscode.commands.executeCommand(cmd, args);
  }
}

async function focusComposerSurface(): Promise<void> {
  const focusCommands = [
    "composer.open_chat_sidebar",
    "composer.focusComposer",
    "aichat.view",
  ];
  for (const cmd of focusCommands) {
    try {
      await runComposerCommand(cmd);
      return;
    } catch {
      // try next
    }
  }
}

function threadFocusMatches(focused: string | null, threadId: string): boolean {
  if (!focused) {
    return false;
  }
  if (threadId === "active-composer") {
    return true;
  }
  return focused === threadId;
}

export async function focusComposerThread(threadId?: string): Promise<string> {
  const target = threadId && threadId !== "active-composer" ? threadId : (await getFocusedComposerId()) || threadId;

  if (target && target !== "active-composer") {
    const alreadyFocused = await getFocusedComposerId();
    if (threadFocusMatches(alreadyFocused, target)) {
      return target;
    }
    const openAttempts: Array<{ cmd: string; args?: unknown }> = [
      { cmd: "composer.focusComposer", args: target },
      { cmd: "composer.openComposer", args: { composerId: target } },
      { cmd: "composer.openComposer", args: target },
    ];
    for (const { cmd, args } of openAttempts) {
      try {
        await runComposerCommand(cmd, args);
        await delay(280);
        const focused = await getFocusedComposerId();
        if (threadFocusMatches(focused, target)) {
          return target;
        }
      } catch {
        // try next
      }
    }
  }

  await delay(120);
  const focused = await getFocusedComposerId();
  if (target && target !== "active-composer" && !threadFocusMatches(focused, target)) {
    throw new Error(
      `Could not focus Agent thread ${target}. Click the Agent (Composer) panel on the right, then try again.`
    );
  }
  return focused || target || "active-composer";
}

export async function focusComposer(): Promise<void> {
  await focusComposerSurface();
}

export async function cancelComposerRun(): Promise<void> {
  const cmds = [
    "composer.cancelChat",
    "composer.cancelComposerStep",
    "composer.submitChat.abortChatAndWaitForFinish",
  ];
  for (const cmd of cmds) {
    try {
      await runComposerCommand(cmd);
    } catch {
      // optional
    }
  }
}

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
  const focusedId = await getFocusedComposerId();
  let targetId = options?.threadId ?? focusedId ?? undefined;
  if (targetId && !threads.some((t) => t.id === targetId)) {
    targetId = focusedId ?? undefined;
  }
  if (!targetId || targetId === "active-composer") {
    throw new Error(
      "Click the Agent chat you want on the right (focus the message box), then run Voice send again. Voice will not switch tabs for you."
    );
  }

  let resolvedThread = targetId;
  if (!threadFocusMatches(focusedId, targetId)) {
    resolvedThread = await focusComposerThread(targetId);
  }
  if (resolvedThread === "active-composer") {
    throw new Error("No Agent thread id — focus the Agent chat you want, then retry.");
  }

  await delay(80);
  const sent = await submitAgentMessage(trimmed, resolvedThread);
  return { method: sent.method, threadId: resolvedThread };
}
