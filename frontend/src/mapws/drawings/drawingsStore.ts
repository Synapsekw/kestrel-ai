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
  set: (key: string, projectId: string, items: Drawing[]) => void;
  upsert: (d: Drawing) => void;
  remove: (id: string) => void;
}

export const useDrawingsStore = create<DrawingsState>((set) => ({
  key: null,
  projectId: null,
  byId: {},
  order: [],
  set: (key, projectId, items) =>
    set({
      key,
      projectId,
      byId: Object.fromEntries(items.map((d) => [d.id, d])),
      order: items.map((d) => d.id),
    }),
  upsert: (d) =>
    set((s) => ({
      byId: { ...s.byId, [d.id]: d },
      order: s.order.includes(d.id) ? s.order : [...s.order, d.id],
    })),
  remove: (id) =>
    set((s) => {
      const byId = { ...s.byId };
      delete byId[id];
      return { byId, order: s.order.filter((x) => x !== id) };
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
    listDrawings(api, projectId)
      .then((items) => useDrawingsStore.getState().set(key, projectId, items))
      .catch((e: unknown) => pushLog(`drawings: ${messageOf(e, "could not list drawings")}`))
      .finally(() => inflight.delete(key));
  }, [api, projectId, key]);
  return ready ? order.map((id) => byId[id]).filter((d): d is Drawing => d !== undefined) : null;
}

export function useDrawing(projectId: string, id: string): Drawing | null {
  useDrawingList(projectId);
  return useDrawingsStore((s) => (s.projectId === projectId ? (s.byId[id] ?? null) : null));
}
