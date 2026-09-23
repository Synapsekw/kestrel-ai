import { useEffect, useState } from "react";
import { create } from "zustand";
import type { ApiClient, Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchProject } from "@/api/project";
import { pushLog } from "@/app/diagnostics";

/** `train` or `detect`, fixed when the project is created. */
export type ProjectKind = Project["kind"];

/** A project's kind once known, or "failed" when it could not be loaded. */
type KindEntry = ProjectKind | "failed";

interface KindState {
  byProject: Record<string, KindEntry>;
  set: (projectId: string, kind: KindEntry) => void;
}

/**
 * Project kinds by id. A kind is fixed when the project is created and never changes, so one load
 * per project and app session is enough; the sidebar, the header and the kind routes share it.
 */
export const useProjectKindStore = create<KindState>((set) => ({
  byProject: {},
  set: (projectId, kind) => set((s) => ({ byProject: { ...s.byProject, [projectId]: kind } })),
}));

const inFlight = new Map<string, Promise<void>>();
/** Failed loads in a row per project; sets the retry backoff. */
const failures = new Map<string, number>();

/** 1 s after the first failure, doubling up to 30 s. */
function retryDelay(projectId: string): number {
  const n = failures.get(projectId) ?? 1;
  return Math.min(1000 * 2 ** (n - 1), 30_000);
}

function loadKind(api: ApiClient, projectId: string): Promise<void> {
  const running = inFlight.get(projectId);
  if (running) return running;
  const promise = fetchProject(api, projectId)
    .then((p) => {
      failures.delete(projectId);
      useProjectKindStore.getState().set(projectId, p.kind);
    })
    .catch((e: unknown) => {
      failures.set(projectId, (failures.get(projectId) ?? 0) + 1);
      pushLog(`load project kind failed: ${messageOf(e, String(e))}`);
      useProjectKindStore.getState().set(projectId, "failed");
    })
    .finally(() => inFlight.delete(projectId));
  inFlight.set(projectId, promise);
  return promise;
}

/**
 * The kind and whether loading it failed; `kind` is null while loading and after a failure. A
 * failed load (say the sidecar was not up yet) is retried with a backoff while the entry stays
 * "failed", so screens that render on a failure are not swapped for a placeholder meanwhile.
 */
export function useProjectKindState(projectId: string | undefined): {
  kind: ProjectKind | null;
  failed: boolean;
} {
  const api = useApi();
  const entry = useProjectKindStore((s) => (projectId ? s.byProject[projectId] : undefined));
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!projectId) return;
    if (entry === undefined) {
      void loadKind(api, projectId);
      return;
    }
    if (entry !== "failed") return;
    let alive = true;
    const timer = setTimeout(() => {
      // A failure stores "failed" again, which does not change `entry`; the tick re-arms the timer.
      void loadKind(api, projectId).then(() => {
        if (alive) setRetry((r) => r + 1);
      });
    }, retryDelay(projectId));
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [api, projectId, entry, retry]);
  if (entry === undefined || entry === "failed") return { kind: null, failed: entry === "failed" };
  return { kind: entry, failed: false };
}

/** The open project's kind (`train` or `detect`); null while it loads or without a project. */
export function useProjectKind(projectId: string | undefined): ProjectKind | null {
  return useProjectKindState(projectId).kind;
}
