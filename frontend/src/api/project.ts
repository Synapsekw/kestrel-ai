import { useCallback, useEffect, useState } from "react";
import type { ApiClient, Project, Source, components } from "@contract/client";
import { useApi } from "./client";
import { messageOf, unwrap } from "./errors";
import { pushLog } from "@/app/diagnostics";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";

export type ProjectUpdate = components["schemas"]["ProjectUpdate"];

export function fetchProject(api: ApiClient, projectId: string): Promise<Project> {
  return unwrap(api.GET("/api/v1/projects/{projectId}", { params: { path: { projectId } } }));
}

export function patchProject(api: ApiClient, projectId: string, patch: ProjectUpdate): Promise<Project> {
  return unwrap(api.PATCH("/api/v1/projects/{projectId}", { params: { path: { projectId } }, body: patch }));
}

/** May reject with 501 until S1 lands. */
export async function fetchSources(api: ApiClient, projectId: string): Promise<Source[]> {
  const r = await unwrap(
    api.GET("/api/v1/projects/{projectId}/sources", { params: { path: { projectId } } }),
  );
  return r.items;
}

const projectListeners = new Set<(project: Project) => void>();

/** Every `useProject` for this id picks up the project a write just saved (a type added while marking). */
export function publishProject(project: Project): void {
  for (const listener of projectListeners) listener(project);
}

export function useProject(projectId: string): {
  project: Project | null;
  error: string | null;
  reload: () => void;
  setProject: (p: Project) => void;
} {
  const api = useApi();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetchProject(api, projectId)
      .then((p) => {
        if (!cancelled) setProject(p);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load project failed: ${messageOf(e, String(e))}`);
        setError(messageOf(e, "could not load the project"));
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, attempt]);
  useEffect(() => {
    const hear = (p: Project) => {
      if (p.id === projectId) setProject(p);
    };
    projectListeners.add(hear);
    return () => {
      projectListeners.delete(hear);
    };
  }, [projectId]);
  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  return { project, error, reload, setProject };
}

/** Source id -> site name for the Data Manager's source column; empty when sources are unavailable. */
export function useSourceNames(projectId: string): Record<string, string> {
  const api = useApi();
  const [names, setNames] = useState<Record<string, string>>({});
  // An import creates or extends a source: fetch the names again when one ends.
  const [revision, setRevision] = useState(0);
  useOnJobsFinished("import", () => setRevision((r) => r + 1));
  useEffect(() => {
    let cancelled = false;
    fetchSources(api, projectId)
      .then((items) => {
        if (!cancelled) setNames(Object.fromEntries(items.map((s) => [s.id, s.site])));
      })
      .catch((e: unknown) => {
        pushLog(`sources unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled) setNames({});
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, revision]);
  return names;
}

export type ProjectStats = components["schemas"]["Stats"];

export function fetchProjectStats(api: ApiClient, projectId: string): Promise<ProjectStats> {
  return unwrap(api.GET("/api/v1/projects/{projectId}/stats", { params: { path: { projectId } } }));
}

/** The project's groups (flights) with their image counts; empty while loading or when unavailable. */
export function useGroups(projectId: string): ProjectStats["groups"] {
  const api = useApi();
  const [groups, setGroups] = useState<ProjectStats["groups"]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchProjectStats(api, projectId)
      .then((stats) => {
        if (!cancelled) setGroups(stats.groups);
      })
      .catch((e: unknown) => {
        pushLog(`project stats unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled) setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);
  return groups;
}
