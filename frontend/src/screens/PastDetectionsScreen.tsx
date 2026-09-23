import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useProgress } from "@/app/useProjectProgress";
import { Alert, Segmented } from "@/ui";
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
        <Segmented
          label="Past detections"
          value={view}
          onChange={show}
          className="self-start"
          options={[
            {
              value: "runs",
              label: progress ? `Detection runs (${progress.queryRuns})` : "Detection runs",
              icon: "detect",
            },
            { value: "maps", label: progress ? `Maps (${progress.maps})` : "Maps", icon: "map" },
          ]}
        />
      </div>
      {view === "runs" ? (
        <QueryScreen readOnly />
      ) : (
        <div className="flex h-[calc(100vh-15rem)] min-h-[28rem] overflow-hidden rounded-lg border border-line">
          <MapsScreen readOnly />
        </div>
      )}
    </section>
  );
}
