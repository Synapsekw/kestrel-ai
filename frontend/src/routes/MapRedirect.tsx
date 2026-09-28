import { Navigate, useLocation, useParams } from "react-router-dom";

/**
 * `/p/:projectId/maps/:mapId` (the retired pixel viewer, spec 2026-09-26-map-workspace sections 5
 * and 11) opens the map workspace on that map. The old query is kept (`at`, `fp`, a toast's `job`),
 * except the two meanings the workspace spells differently: review of a run is a selection
 * (`sel=run:<id>`; the workspace's `mode` is its compare mode), and the site-area outline tool is
 * the zone tool (`tool=zone`).
 */
export function MapRedirect() {
  const { projectId = "", mapId = "" } = useParams();
  const { search, hash } = useLocation();
  const q = new URLSearchParams(search);
  let sel: string | null = null;
  let tool: string | null = null;
  if (q.get("mode") === "review") {
    const run = q.get("run");
    if (run) sel = `run:${run}`;
    q.delete("mode");
    q.delete("run");
  }
  if (q.get("draw") === "site-area") {
    tool = "zone";
    q.delete("draw");
  }
  q.set("map", mapId);
  if (sel) q.set("sel", sel);
  if (tool) q.set("tool", tool);
  return <Navigate to={`/p/${projectId}/maps?${q.toString()}${hash}`} replace />;
}
