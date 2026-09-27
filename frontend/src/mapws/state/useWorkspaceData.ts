import { useCallback, useEffect, useState } from "react";
import { listPointClouds, type PointCloud } from "@/api/clouds";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { fetchWorkspace, listWorkspaceLayers, listWorkspaceSurveys, type MapWorkspace } from "../api";
import type { SiteFrame, Survey, WorkspaceLayer } from "../types";
import { parsePersisted, type PersistedState } from "./workspaceStore";

export interface WorkspaceData {
  frame: SiteFrame;
  persisted: Partial<PersistedState>;
  layers: WorkspaceLayer[];
  surveys: Survey[];
  clouds: PointCloud[];
  /** Maps and surfaces each frame can show (the frame switch, M-W2). */
  frameItems: MapWorkspace["frame_items"];
}

/**
 * Four bounded reads (frame + state, layers, surveys, clouds), again on a data, surface or workspace
 * event. The last good data stays up while a re-read runs; an error shows only when there is none.
 */
export function useWorkspaceData(projectId: string): {
  data: WorkspaceData | null;
  error: string | null;
  retry: () => void;
  loading: boolean;
} {
  const api = useApi();
  const revision = useChangesStore(
    (s) => `${s.dataRevision}|${s.surfacesRevision}|${s.mapWorkspaceRevision}`,
  );
  const [attempt, setAttempt] = useState(0);
  const key = `${projectId}|${revision}|${attempt}`;
  const [state, setState] = useState<{
    projectId: string;
    key: string | null;
    data: WorkspaceData | null;
    error: string | null;
  }>({
    projectId,
    key: null,
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchWorkspace(api, projectId),
      listWorkspaceLayers(api, projectId),
      listWorkspaceSurveys(api, projectId),
      listPointClouds(api, projectId).catch(() => [] as PointCloud[]),
    ])
      .then(([ws, layers, surveys, clouds]) => {
        if (cancelled) return;
        setState({
          projectId,
          key,
          error: null,
          data: {
            frame: ws.frame,
            persisted: parsePersisted(ws.state),
            layers,
            surveys,
            clouds,
            frameItems: ws.frame_items,
          },
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load map workspace failed: ${messageOf(e, String(e))}`);
        setState((s) => ({
          projectId,
          key,
          data: s.projectId === projectId ? s.data : null,
          error: messageOf(e, "Could not load the map workspace."),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, key]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const current = state.projectId === projectId ? state : { data: null, error: null };
  return {
    data: current.data,
    error: current.data ? null : current.error,
    retry,
    loading: state.key !== key,
  };
}
