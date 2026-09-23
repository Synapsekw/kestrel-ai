import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { GeoMap } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchMap } from "@/api/maps";
import { pushLog } from "@/app/diagnostics";
import { useProgress } from "@/app/useProjectProgress";
import { MoveMapDialog } from "@/maps/MoveMapDialog";
import { Alert, Button, Segmented } from "@/ui";
import { MapsScreen } from "./MapsScreen";
import { QueryScreen } from "./QueryScreen";

type View = "runs" | "maps";

/**
 * A training project's detections from before training and detection were split: its detection
 * runs and its maps, both read-only. Export stays; new detections belong in a detection project.
 */
export function PastDetectionsScreen() {
  const { projectId = "", mapId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const progress = useProgress(projectId);
  const openMap = useOpenMap(projectId, mapId);
  const [moving, setMoving] = useState(false);
  const asked = params.get("view");
  const view: View = mapId
    ? "maps"
    : asked === "maps" || asked === "runs"
      ? asked
      : progress && progress.queryRuns === 0 && progress.maps > 0
        ? "maps"
        : "runs";

  const show = (next: View) => {
    if (next !== view) void navigate(`/p/${projectId}/past?view=${next}`);
  };

  return (
    <section className="flex min-h-0 flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Past detections</h1>
        <Alert tone="info" role="status" className="max-w-3xl">
          Detections made before training and detection were split. New detections belong in a detection
          project.
        </Alert>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Past detections"
            value={view}
            onChange={show}
            options={[
              {
                value: "runs",
                label: progress ? `Detection runs (${progress.queryRuns})` : "Detection runs",
                icon: "detect",
              },
              { value: "maps", label: progress ? `Maps (${progress.maps})` : "Maps", icon: "map" },
            ]}
          />
          {view === "maps" && openMap && (
            <Button size="sm" icon="arrow-right" onClick={() => setMoving(true)}>
              Move to a detection project
            </Button>
          )}
        </div>
      </div>
      {view === "runs" ? (
        <QueryScreen readOnly />
      ) : (
        <div className="flex h-[calc(100vh-15rem)] min-h-[28rem] overflow-hidden rounded-lg border border-line">
          <MapsScreen readOnly />
        </div>
      )}
      {moving && openMap && (
        <MoveMapDialog projectId={projectId} geoMap={openMap} onClose={() => setMoving(false)} />
      )}
    </section>
  );
}

/** The open past map once it is ready to copy; null without one, while loading, or when not ready. */
function useOpenMap(projectId: string, mapId: string | undefined): GeoMap | null {
  const api = useApi();
  const [map, setMap] = useState<GeoMap | null>(null);
  useEffect(() => {
    setMap(null);
    if (!mapId) return;
    let cancelled = false;
    fetchMap(api, projectId, mapId)
      .then((m) => {
        if (!cancelled && m.status === "ready") setMap(m);
      })
      .catch((e: unknown) => pushLog(`load past map failed: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, mapId]);
  return map;
}
