import { useEffect } from "react";
import { create } from "zustand";
import { useApi } from "@/api/client";
import { listDrawings, type Drawing } from "@/api/drawings";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";

interface DrawingsState {
  /** `${projectId}:${mapWorkspaceRevision}` of the loaded list. */
  key: string | null;
  projectId: string | null;
  byId: Record<string, Drawing>;
  order: string[];
  /** Bumped by every `upsert`/`remove`; `touched[id]` is the `writes` of that drawing's last one. */
  writes: number;
  touched: Record<string, number>;
  /**
   * Replaces the list. With `since` (the `writes` when its request started), a drawing upserted or
   * removed after that keeps the store's copy (or stays gone): the list is older than that write.
   */
  set: (key: string, projectId: string, items: Drawing[], since?: number) => void;
  upsert: (d: Drawing) => void;
  remove: (id: string) => void;
}

export const useDrawingsStore = create<DrawingsState>((set) => ({
  key: null,
  projectId: null,
  byId: {},
  order: [],
  writes: 0,
  touched: {},
  set: (key, projectId, items, since) =>
    set((s) => {
      const newer = (id: string) =>
        since !== undefined && s.projectId === projectId && (s.touched[id] ?? -1) >= since;
      const byId: Record<string, Drawing> = {};
      const order: string[] = [];
      const put = (d: Drawing | undefined) => {
        if (d && !(d.id in byId)) {
          byId[d.id] = d;
          order.push(d.id);
        }
      };
      for (const d of items) put(newer(d.id) ? s.byId[d.id] : d);
      // Upserted after the request started (a Save, an import) but missing from the older list.
      for (const id of s.order) if (newer(id)) put(s.byId[id]);
      return { key, projectId, byId, order };
    }),
  upsert: (d) =>
    set((s) => ({
      byId: { ...s.byId, [d.id]: d },
      order: s.order.includes(d.id) ? s.order : [...s.order, d.id],
      writes: s.writes + 1,
      touched: { ...s.touched, [d.id]: s.writes },
    })),
  remove: (id) =>
    set((s) => {
      const byId = { ...s.byId };
      delete byId[id];
      return {
        byId,
        order: s.order.filter((x) => x !== id),
        writes: s.writes + 1,
        touched: { ...s.touched, [id]: s.writes },
      };
    }),
}));

const inflight = new Set<string>();

/** Every drawing of the project; one request per `drawings.changed` (W1's mapWorkspaceRevision). */
export function useDrawingList(projectId: string): Drawing[] | null {
  const api = useApi();
  const revision = useChangesStore((s) => s.mapWorkspaceRevision);
  const key = `${projectId}:${revision}`;
  const ready = useDrawingsStore((s) => s.projectId === projectId);
  const order = useDrawingsStore((s) => s.order);
  const byId = useDrawingsStore((s) => s.byId);
  useEffect(() => {
    if (useDrawingsStore.getState().key === key || inflight.has(key)) return;
    inflight.add(key);
    const since = useDrawingsStore.getState().writes;
    listDrawings(api, projectId)
      .then((items) => {
        // Final review #3: a list for a revision that has moved on (an out-of-order answer) is stale.
        if (key !== `${projectId}:${useChangesStore.getState().mapWorkspaceRevision}`) return;
        useDrawingsStore.getState().set(key, projectId, items, since);
      })
      .catch((e: unknown) => pushLog(`drawings: ${messageOf(e, "could not list drawings")}`))
      .finally(() => inflight.delete(key));
  }, [api, projectId, key]);
  return ready ? order.map((id) => byId[id]).filter((d): d is Drawing => d !== undefined) : null;
}

export function useDrawing(projectId: string, id: string): Drawing | null {
  useDrawingList(projectId);
  return useDrawingsStore((s) => (s.projectId === projectId ? (s.byId[id] ?? null) : null));
}
