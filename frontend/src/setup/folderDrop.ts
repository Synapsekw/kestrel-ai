import { pushLog } from "@/app/diagnostics";
import type { TemplateSlot } from "./api";

export interface FolderDropHandlers {
  /** True while files are dragged over the window; false when they leave or land. */
  onOver: (over: boolean) => void;
  onDrop: (paths: string[]) => void;
}

/**
 * The desktop shell's file drop: Tauri's webview `onDragDropEvent`, which needs `dragDropEnabled`
 * (the default). Outside Tauri it does nothing. Returns the unsubscribe, which is safe to call before
 * the listener is attached. Because the drop is on, HTML5 drag events do not reach the page on
 * Windows, so in-page moves use pointer events (Ruling 1).
 */
export function subscribeFolderDrop(h: FolderDropHandlers): () => void {
  let unlisten: (() => void) | null = null;
  let closed = false;
  void (async () => {
    const { isTauri } = await import("@tauri-apps/api/core");
    if (!isTauri() || closed) return;
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    const off = await getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "enter" || p.type === "over") h.onOver(true);
      else if (p.type === "leave") h.onOver(false);
      else {
        h.onOver(false);
        if (p.paths.length > 0) h.onDrop(p.paths);
      }
    });
    if (closed) off();
    else unlisten = off;
  })().catch((e: unknown) => pushLog(`folder drop unavailable: ${String(e)}`));
  return () => {
    closed = true;
    unlisten?.();
  };
}

const asList = (picked: string | string[] | null): string[] =>
  picked === null ? [] : Array.isArray(picked) ? picked : [picked];

export async function pickFolders(): Promise<string[]> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  return asList(await open({ directory: true, multiple: true }));
}

/** A photo slot picks folders (photos import by folder); any other slot picks files of its `accepts`. */
export async function pickFiles(slot: TemplateSlot): Promise<string[]> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  if (slot.route === "images") return asList(await open({ directory: true, multiple: true }));
  return asList(await open({ multiple: true, filters: [{ name: slot.label, extensions: slot.accepts }] }));
}
