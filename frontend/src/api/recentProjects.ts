import { useEffect, useState } from "react";
import type { ApiClient, Project } from "@contract/client";
import { pushLog } from "@/app/diagnostics";
import { useApi } from "./client";
import { messageOf, unwrap } from "./errors";
import { collectPages } from "./paging";

/** The recent projects (the backend caps the list at `MAX_RECENT = 20`). */
export function fetchRecentProjects(api: ApiClient): Promise<Project[]> {
  return collectPages((cursor) =>
    unwrap(api.GET("/api/v1/projects", { params: { query: cursor ? { cursor } : {} } })),
  );
}

export function useRecentProjects(): { projects: Project[]; loading: boolean; error: string | null } {
  const api = useApi();
  const [state, setState] = useState<{ done: boolean; projects: Project[]; error: string | null }>({
    done: false,
    projects: [],
    error: null,
  });
  useEffect(() => {
    let cancelled = false;
    fetchRecentProjects(api)
      .then((projects) => {
        if (!cancelled) setState({ done: true, projects, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`list recent projects failed: ${messageOf(e, String(e))}`);
        setState({ done: true, projects: [], error: messageOf(e, "could not list the projects") });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);
  return { projects: state.projects, loading: !state.done, error: state.error };
}
