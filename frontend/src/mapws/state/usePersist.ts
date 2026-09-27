import { useEffect } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { putWorkspaceState } from "../api";
import { useWorkspaceStores } from "../context";
import { STATE_MAX_BYTES, snapshot, type WorkspaceState } from "./workspaceStore";

/** Spec §5.2: debounced by 1 s. */
export const PERSIST_DEBOUNCE_MS = 1000;

const persisted = (s: WorkspaceState) => [
  s.mode,
  s.l,
  s.r,
  s.blend,
  s.swipe,
  s.layerState,
  s.order,
  s.viewInfo,
];

/** `PUT /map-workspace {state}` 1 s after the last change of a persisted field; flushed on unmount. */
export function usePersist(ready: boolean): void {
  const { workspace, projectId } = useWorkspaceStores();
  const api = useApi();
  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = JSON.stringify(snapshot(workspace.getState()));
    const flush = () => {
      timer = null;
      const text = JSON.stringify(snapshot(workspace.getState()));
      if (text === last) return;
      if (new TextEncoder().encode(text).length > STATE_MAX_BYTES) {
        pushLog("map workspace state is over 64 KB; not saved");
        return;
      }
      last = text;
      putWorkspaceState(api, projectId, JSON.parse(text) as Record<string, unknown>).catch((e: unknown) =>
        pushLog(`save map workspace failed: ${messageOf(e, String(e))}`),
      );
    };
    const unsubscribe = workspace.subscribe((s, prev) => {
      const a = persisted(s);
      const b = persisted(prev);
      if (a.every((v, i) => v === b[i])) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, PERSIST_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (timer) {
        clearTimeout(timer);
        flush();
      }
    };
  }, [ready, workspace, api, projectId]);
}
