import { useShallow } from "zustand/react/shallow";
import { useWorkspace } from "../context";
import type { WorkspaceLayer } from "../types";

/**
 * The workspace's layer list (listWorkspaceLayers), read once per revision by MapWorkspace and shared by
 * every plugin (W2's base map and elevation kinds, W3's annotation rows); plugins never read it themselves.
 */
export function useWorkspaceLayers(): {
  layers: WorkspaceLayer[];
  loading: boolean;
} {
  return useWorkspace(useShallow((s) => ({ layers: s.layers, loading: s.layersLoading })));
}
