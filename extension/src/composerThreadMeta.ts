import * as vscode from "vscode";
import { readBridgeInvocationToken } from "./bridgeSendAuth";
async function getFocusedComposerId(): Promise<string | null> {
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
  return null;
}

export type ComposerThreadRow = {
  id: string;
  title: string;
  focused: boolean;
  status?: string;
};

type BridgeListRow = {
  id: string;
  title?: string;
  status?: string;
  windowId?: number;
};

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function titleFromHandle(handle: unknown): string | null {
  if (!handle || typeof handle !== "object") {
    return null;
  }
  const h = handle as Record<string, unknown>;
  const data = h.data as Record<string, unknown> | undefined;
  const candidates = [data?.name, data?.title, h.name, h.title];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) {
      return c.trim();
    }
  }
  return null;
}

async function titlesFromDesktopBridge(): Promise<Map<string, { title: string; status?: string }>> {
  const out = new Map<string, { title: string; status?: string }>();
  const token = await readBridgeInvocationToken();
  if (!token) {
    return out;
  }
  for (const windowId of [1, 2, 3]) {
    try {
      const rows = await vscode.commands.executeCommand<BridgeListRow[] | undefined>(
        "composer.desktopBridge.listThreads",
        { windowId, bridgeInvocationToken: token }
      );
      if (!Array.isArray(rows)) {
        continue;
      }
      for (const row of rows) {
        if (typeof row.id !== "string") {
          continue;
        }
        const title =
          typeof row.title === "string" && row.title.trim() ? row.title.trim() : `Agent (${shortId(row.id)})`;
        out.set(row.id, { title, status: row.status });
      }
      if (out.size > 0) {
        break;
      }
    } catch {
      // try next window
    }
  }
  return out;
}

async function titleForId(id: string, bridgeTitles: Map<string, { title: string; status?: string }>): Promise<{
  title: string;
  status?: string;
}> {
  const bridged = bridgeTitles.get(id);
  if (bridged) {
    return bridged;
  }
  try {
    const handle = await vscode.commands.executeCommand<unknown>("composer.getComposerHandleById", id);
    const fromHandle = titleFromHandle(handle);
    if (fromHandle) {
      return { title: fromHandle };
    }
  } catch {
    // command unavailable
  }
  return { title: `Agent chat (${shortId(id)})` };
}

/** Agent tabs in this window with human-readable titles when Cursor exposes them. */
export async function listComposerThreadsDetailed(): Promise<ComposerThreadRow[]> {
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
    // missing on older builds
  }

  const focusedId = await getFocusedComposerId();
  const bridgeTitles = await titlesFromDesktopBridge();

  if (ids.length === 0) {
    return [
      {
        id: focusedId || "active-composer",
        title: "Active Agent chat",
        focused: true,
      },
    ];
  }

  const rows: ComposerThreadRow[] = [];
  for (const id of ids) {
    const { title, status } = await titleForId(id, bridgeTitles);
    rows.push({
      id,
      title,
      focused: focusedId === id,
      status,
    });
  }
  return rows;
}
