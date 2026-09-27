import { useEffect, useSyncExternalStore } from "react";
import type { Image as ImageRow } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { fetchImageDetails } from "./api";
import { DetailCache, missingBatches } from "./detailCache";

/**
 * One details cache for the open project, shared by the grid, the filmstrip and the map tooltip,
 * so scrolling back or switching views never re-requests a row (spec §7.1). It is cleared when the
 * project changes or the image list changes (`imagesRevision`).
 */
const holder = {
  generation: "",
  cache: new DetailCache(),
  inFlight: new Set<string>(),
  version: 0,
  listeners: new Set<() => void>(),
};

function notify(): void {
  holder.version += 1;
  for (const l of holder.listeners) l();
}

function subscribe(listener: () => void): () => void {
  holder.listeners.add(listener);
  return () => holder.listeners.delete(listener);
}

const snapshot = () => holder.version;

function enter(generation: string): void {
  if (holder.generation === generation) return;
  holder.generation = generation;
  holder.cache.clear();
  holder.inFlight.clear();
}

export function resetDetailsForTests(): void {
  holder.generation = "";
  holder.cache.clear();
  holder.inFlight.clear();
  holder.version = 0;
}

/**
 * Detail rows (file name, capture time) for `ids` — the visible window plus overscan only — fetched
 * by `ids=` in batches of ≤ 200. Returns a new Map each render: never use it as an effect dependency.
 */
export function useImageDetails(projectId: string, ids: readonly string[]): ReadonlyMap<string, ImageRow> {
  const api = useApi();
  const revision = useChangesStore((s) => s.imagesRevision);
  useSyncExternalStore(subscribe, snapshot);
  const idsKey = ids.join(",");

  useEffect(() => {
    const generation = `${projectId}|${revision}`;
    enter(generation);
    const wanted = idsKey ? idsKey.split(",") : [];
    const batches = missingBatches(wanted, (id) => holder.cache.get(id) !== undefined, holder.inFlight);
    for (const batch of batches) {
      for (const id of batch) holder.inFlight.add(id);
      fetchImageDetails(api, projectId, batch).then(
        (rows) => {
          if (holder.generation !== generation) return;
          for (const row of rows) holder.cache.set(row);
          for (const id of batch) holder.inFlight.delete(id);
          notify();
        },
        (e: unknown) => {
          if (holder.generation === generation) for (const id of batch) holder.inFlight.delete(id);
          pushLog(`image details failed: ${messageOf(e, String(e))}`);
        },
      );
    }
  }, [api, projectId, revision, idsKey]);

  const out = new Map<string, ImageRow>();
  for (const id of ids) {
    const row = holder.cache.peek(id);
    if (row) out.set(id, row);
  }
  return out;
}
